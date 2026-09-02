begin;

create table if not exists public.claim_submission_approvals (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null unique references public.claims(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'approved',
  generation integer not null default 1,
  submission_hash text not null,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_job_id text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint claim_submission_approvals_status_check check (
    status in ('approved', 'consumed', 'revoked', 'expired')
  ),
  constraint claim_submission_approvals_expiry_check check (expires_at > approved_at),
  constraint claim_submission_approvals_hash_check check (
    submission_hash ~ '^[0-9a-f]{64}$'
  )
);

create index if not exists claim_submission_approvals_user_status_idx
  on public.claim_submission_approvals (user_id, status, expires_at);

alter table public.claim_submission_approvals enable row level security;
revoke all on table public.claim_submission_approvals from anon, authenticated;
grant all on table public.claim_submission_approvals to service_role;

create or replace function public.approve_claim_final_submission(
  p_user_id uuid,
  p_claim_id uuid,
  p_submission_hash text,
  p_expires_in_minutes integer default 15
)
returns setof public.claim_submission_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.claims%rowtype;
begin
  if p_expires_in_minutes < 5 or p_expires_in_minutes > 30 then
    raise exception 'Approval duration must be between 5 and 30 minutes.';
  end if;

  if p_submission_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid submission snapshot hash is required.';
  end if;

  select * into v_claim
  from public.claims
  where id = p_claim_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Claim not found.';
  end if;

  if v_claim.status <> 'ready_to_submit' then
    raise exception 'Claim must be ready to submit before approval.';
  end if;

  if coalesce(v_claim.claim_type, 'delay_repay') <> 'delay_repay' then
    raise exception 'Only ordinary Delay Repay claims can use this approval route.';
  end if;

  if not exists (
    select 1
    from public.detected_delays delay
    where delay.id = v_claim.detected_delay_id
      and delay.user_id = p_user_id
      and lower(trim(delay.operator)) in ('greater anglia', 'greater_anglia')
      and delay.passenger_confirmation_status = 'confirmed'
  ) then
    raise exception 'A confirmed Greater Anglia journey is required for approval.';
  end if;

  insert into public.claim_submission_approvals (
    claim_id,
    user_id,
    status,
    generation,
    submission_hash,
    approved_at,
    expires_at,
    consumed_at,
    consumed_by_job_id,
    revoked_at,
    updated_at
  ) values (
    p_claim_id,
    p_user_id,
    'approved',
    1,
    p_submission_hash,
    now(),
    now() + make_interval(mins => p_expires_in_minutes),
    null,
    null,
    null,
    now()
  )
  on conflict (claim_id) do update set
    user_id = excluded.user_id,
    status = 'approved',
    generation = public.claim_submission_approvals.generation + 1,
    submission_hash = excluded.submission_hash,
    approved_at = excluded.approved_at,
    expires_at = excluded.expires_at,
    consumed_at = null,
    consumed_by_job_id = null,
    revoked_at = null,
    updated_at = now();

  return query
  select * from public.claim_submission_approvals where claim_id = p_claim_id;
end;
$$;

create or replace function public.consume_claim_final_submission_approval(
  p_user_id uuid,
  p_claim_id uuid,
  p_job_id text,
  p_submission_hash text
)
returns setof public.claim_submission_approvals
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.claim_submission_approvals
  set
    status = 'expired',
    updated_at = now()
  where claim_id = p_claim_id
    and user_id = p_user_id
    and status = 'approved'
    and expires_at <= now();

  return query
  update public.claim_submission_approvals
  set
    status = 'consumed',
    consumed_at = now(),
    consumed_by_job_id = left(coalesce(p_job_id, 'unknown-submission-job'), 200),
    updated_at = now()
  where claim_id = p_claim_id
    and user_id = p_user_id
    and status = 'approved'
    and expires_at > now()
    and submission_hash = p_submission_hash
  returning *;
end;
$$;

create or replace function public.revoke_claim_final_submission_approval(
  p_user_id uuid,
  p_claim_id uuid
)
returns setof public.claim_submission_approvals
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.claim_submission_approvals
  set
    status = 'revoked',
    revoked_at = now(),
    updated_at = now()
  where claim_id = p_claim_id
    and user_id = p_user_id
    and status = 'approved'
  returning *;
end;
$$;

revoke all on function public.approve_claim_final_submission(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.consume_claim_final_submission_approval(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.revoke_claim_final_submission_approval(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.approve_claim_final_submission(uuid, uuid, text, integer)
  to service_role;
grant execute on function public.consume_claim_final_submission_approval(uuid, uuid, text, text)
  to service_role;
grant execute on function public.revoke_claim_final_submission_approval(uuid, uuid)
  to service_role;

comment on table public.claim_submission_approvals is
  'Backend-only audit record for short-lived, single-use final claim submission approvals.';

commit;
