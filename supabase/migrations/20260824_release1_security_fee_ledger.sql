-- Delai Release 1: secure job leasing, user-data RLS and accumulated fee collection.
-- Apply after the Step 20, 20B, 20C and 20D migrations.

create extension if not exists pgcrypto;

alter table public.automation_jobs
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists automation_jobs_ready_lease_idx
  on public.automation_jobs (status, run_after, lease_expires_at, created_at);

update public.automation_jobs
set
  status = 'retry',
  run_after = now(),
  last_error = 'Recovered pre-Release 1 processing job without a lease.',
  updated_at = now()
where status = 'processing'
  and lease_expires_at is null;

with ranked_active_jobs as (
  select
    id,
    row_number() over (
      partition by user_id, claim_id, job_type
      order by created_at, id
    ) as duplicate_rank
  from public.automation_jobs
  where status in ('queued', 'retry')
)
update public.automation_jobs job
set
  status = 'blocked',
  last_error = 'Superseded duplicate job during Release 1 migration.',
  locked_at = null,
  locked_by = null,
  lease_expires_at = null,
  updated_at = now()
from ranked_active_jobs ranked
where job.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index if not exists automation_jobs_one_active_claim_job_idx
  on public.automation_jobs (
    user_id,
    coalesce(claim_id, '00000000-0000-0000-0000-000000000000'::uuid),
    job_type
  )
  where status in ('queued', 'retry');

create or replace function public.lease_automation_jobs(
  p_limit integer default 20,
  p_worker_id text default null,
  p_lease_seconds integer default 300
)
returns setof public.automation_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate_jobs as (
    select aj.id
    from public.automation_jobs aj
    where (
      aj.status in ('queued', 'retry')
      and coalesce(aj.run_after, now()) <= now()
    ) or (
      aj.status = 'processing'
      and aj.lease_expires_at is not null
      and aj.lease_expires_at <= now()
    )
    order by coalesce(aj.run_after, aj.created_at), aj.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  )
  update public.automation_jobs aj
  set
    status = 'processing',
    attempts = coalesce(aj.attempts, 0) + 1,
    last_error = null,
    locked_at = now(),
    locked_by = coalesce(nullif(trim(p_worker_id), ''), 'delai-worker'),
    lease_expires_at = now() + make_interval(
      secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 1800)
    ),
    updated_at = now()
  from candidate_jobs candidate
  where aj.id = candidate.id
  returning aj.*;
end;
$$;

revoke all on function public.lease_automation_jobs(integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.lease_automation_jobs(integer, text, integer)
  to service_role;

alter table public.payment_provider_events
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.payment_provider_events
set
  status = 'retry',
  next_attempt_at = now(),
  last_error = 'Recovered pre-Release 1 provider event without a lease.',
  updated_at = now()
where status = 'processing'
  and lease_expires_at is null;

create or replace function public.lease_payment_provider_events(
  p_limit integer default 20,
  p_worker_id text default null,
  p_lease_seconds integer default 300
)
returns setof public.payment_provider_events
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate_events as (
    select event.id
    from public.payment_provider_events event
    where (
      event.status in ('received', 'retry')
      and coalesce(event.next_attempt_at, now()) <= now()
    ) or (
      event.status = 'processing'
      and event.lease_expires_at is not null
      and event.lease_expires_at <= now()
    )
    order by coalesce(event.next_attempt_at, event.created_at), event.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  )
  update public.payment_provider_events event
  set
    status = 'processing',
    attempts = coalesce(event.attempts, 0) + 1,
    last_error = null,
    locked_at = now(),
    locked_by = coalesce(nullif(trim(p_worker_id), ''), 'delai-worker'),
    lease_expires_at = now() + make_interval(
      secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 1800)
    ),
    updated_at = now()
  from candidate_events candidate
  where event.id = candidate.id
  returning event.*;
end;
$$;

revoke all on function public.lease_payment_provider_events(integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.lease_payment_provider_events(integer, text, integer)
  to service_role;

create table if not exists public.fee_collection_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null default 'GBP',
  amount_pence integer not null,
  entry_count integer not null,
  trigger_reason text not null,
  status text not null default 'scheduled',
  provider text not null default 'gocardless',
  provider_payment_id text unique,
  idempotency_key text unique,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_collection_batches_amount_check check (amount_pence > 0),
  constraint fee_collection_batches_entry_count_check check (entry_count > 0),
  constraint fee_collection_batches_currency_check check (currency = 'GBP'),
  constraint fee_collection_batches_trigger_check check (
    trigger_reason in ('threshold', 'annual_residual', 'account_closure', 'manual')
  ),
  constraint fee_collection_batches_status_check check (
    status in (
      'scheduled',
      'pending_submission',
      'submitted',
      'confirmed',
      'paid_out',
      'failed',
      'cancelled',
      'charged_back'
    )
  )
);

alter table public.fee_transactions
  add column if not exists fee_amount_pence integer,
  add column if not exists collection_batch_id uuid
    references public.fee_collection_batches(id) on delete set null,
  add column if not exists accrued_at timestamptz,
  add column if not exists reserved_at timestamptz;

update public.fee_transactions
set
  fee_amount_pence = coalesce(
    fee_amount_pence,
    round(fee_amount * 100)::integer
  ),
  accrued_at = coalesce(accrued_at, created_at),
  status = case
    when status = 'pending' and provider_payment_id is null then 'outstanding'
    else status
  end
where fee_amount_pence is null
   or accrued_at is null
   or (status = 'pending' and provider_payment_id is null);

alter table public.fee_transactions
  alter column fee_amount_pence set not null,
  alter column accrued_at set not null;

create index if not exists fee_transactions_outstanding_ledger_idx
  on public.fee_transactions (user_id, status, accrued_at)
  where collection_batch_id is null;

create index if not exists fee_transactions_batch_idx
  on public.fee_transactions (collection_batch_id);

create index if not exists fee_collection_batches_user_status_idx
  on public.fee_collection_batches (user_id, status, created_at);

create or replace function public.prepare_fee_collection_batch(
  p_user_id uuid,
  p_threshold_pence integer default 500,
  p_annual_residual_days integer default 365,
  p_minimum_annual_pence integer default 100,
  p_force_reason text default null
)
returns setof public.fee_collection_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_pence integer;
  v_entry_count integer;
  v_oldest_accrued_at timestamptz;
  v_trigger_reason text;
  v_batch_id uuid;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  return query
  select batch.*
  from public.fee_collection_batches batch
  where batch.user_id = p_user_id
    and batch.status in ('scheduled', 'pending_submission', 'submitted')
  order by batch.created_at
  limit 1;

  if found then
    return;
  end if;

  perform 1
  from public.fee_transactions entry
  where entry.user_id = p_user_id
    and entry.collection_batch_id is null
    and entry.status in ('outstanding', 'pending')
  for update;

  select
    coalesce(sum(entry.fee_amount_pence), 0)::integer,
    count(*)::integer,
    min(entry.accrued_at)
  into v_total_pence, v_entry_count, v_oldest_accrued_at
  from public.fee_transactions entry
  where entry.user_id = p_user_id
    and entry.collection_batch_id is null
    and entry.status in ('outstanding', 'pending');

  if v_entry_count = 0 then
    return;
  end if;

  if p_force_reason in ('account_closure', 'manual') then
    v_trigger_reason := p_force_reason;
  elsif v_total_pence >= greatest(coalesce(p_threshold_pence, 500), 1) then
    v_trigger_reason := 'threshold';
  elsif v_total_pence >= greatest(coalesce(p_minimum_annual_pence, 100), 1)
    and v_oldest_accrued_at <= now() - make_interval(
      days => greatest(coalesce(p_annual_residual_days, 365), 1)
    ) then
    v_trigger_reason := 'annual_residual';
  else
    return;
  end if;

  insert into public.fee_collection_batches (
    user_id,
    amount_pence,
    entry_count,
    trigger_reason,
    status
  ) values (
    p_user_id,
    v_total_pence,
    v_entry_count,
    v_trigger_reason,
    'scheduled'
  )
  returning id into v_batch_id;

  update public.fee_transactions entry
  set
    status = 'batched',
    collection_batch_id = v_batch_id,
    reserved_at = now(),
    updated_at = now()
  where entry.user_id = p_user_id
    and entry.collection_batch_id is null
    and entry.status in ('outstanding', 'pending');

  return query
  select batch.*
  from public.fee_collection_batches batch
  where batch.id = v_batch_id;
end;
$$;

revoke all on function public.prepare_fee_collection_batch(
  uuid, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.prepare_fee_collection_batch(
  uuid, integer, integer, integer, text
) to service_role;

create or replace function public.get_fee_ledger_totals(p_user_id uuid)
returns table (
  outstanding_pence bigint,
  in_collection_pence bigint,
  collected_pence bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(entry.fee_amount_pence) filter (
      where entry.status in ('outstanding', 'pending', 'failed', 'cancelled', 'charged_back')
    ), 0)::bigint as outstanding_pence,
    coalesce(sum(entry.fee_amount_pence) filter (
      where entry.status in ('batched', 'pending_submission', 'submitted')
    ), 0)::bigint as in_collection_pence,
    coalesce(sum(entry.fee_amount_pence) filter (
      where entry.status in ('confirmed', 'paid_out')
    ), 0)::bigint as collected_pence
  from public.fee_transactions entry
  where entry.user_id = p_user_id;
$$;

revoke all on function public.get_fee_ledger_totals(uuid)
  from public, anon, authenticated;
grant execute on function public.get_fee_ledger_totals(uuid)
  to service_role;

alter table public.fee_collection_batches enable row level security;
revoke all on table public.fee_collection_batches from anon, authenticated;

-- Browser clients may only reach their own operational records. Payment,
-- provider-event, job and audit tables remain backend-only.
do $$
declare
  table_name text;
  policy_name text;
  existing_policy record;
begin
  foreach table_name in array array[
    'commutes',
    'season_tickets'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      policy_name := table_name || '_owner_access';
      execute format('alter table public.%I enable row level security', table_name);
      for existing_policy in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = table_name
      loop
        execute format(
          'drop policy if exists %I on public.%I',
          existing_policy.policyname,
          table_name
        );
      end loop;
      execute format(
        'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
        policy_name,
        table_name
      );
      execute format('revoke all on table public.%I from anon, authenticated', table_name);
      execute format(
        'grant select, insert, update, delete on table public.%I to authenticated',
        table_name
      );
    end if;
  end loop;
end;
$$;

do $$
declare
  table_name text;
  policy_name text;
  existing_policy record;
begin
  foreach table_name in array array['claims', 'detected_delays']
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      policy_name := table_name || '_owner_read';
      execute format('alter table public.%I enable row level security', table_name);
      for existing_policy in
        select policyname from pg_policies
        where schemaname = 'public' and tablename = table_name
      loop
        execute format(
          'drop policy if exists %I on public.%I',
          existing_policy.policyname,
          table_name
        );
      end loop;
      execute format(
        'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
        policy_name,
        table_name
      );
      execute format('revoke all on table public.%I from anon, authenticated', table_name);
      execute format('grant select on table public.%I to authenticated', table_name);
    end if;
  end loop;
end;
$$;

do $$
declare
  existing_policy record;
begin
  if to_regclass('public.notifications') is not null then
    alter table public.notifications enable row level security;
    for existing_policy in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = 'notifications'
    loop
      execute format(
        'drop policy if exists %I on public.notifications',
        existing_policy.policyname
      );
    end loop;

    create policy notifications_owner_read
      on public.notifications for select to authenticated
      using ((select auth.uid()) = user_id);
    create policy notifications_owner_mark_read
      on public.notifications for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
    revoke all on table public.notifications from anon, authenticated;
    grant select on table public.notifications to authenticated;
    grant update ("read") on table public.notifications to authenticated;
  end if;
end;
$$;

do $$
declare
  owner_column text;
  existing_policy record;
begin
  if to_regclass('public.profiles') is not null then
    select case
      when exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'user_id'
      ) then 'user_id'
      else 'id'
    end into owner_column;

    alter table public.profiles enable row level security;
    for existing_policy in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = 'profiles'
    loop
      execute format(
        'drop policy if exists %I on public.profiles',
        existing_policy.policyname
      );
    end loop;

    execute format(
      'create policy profiles_owner_access on public.profiles for all to authenticated using ((select auth.uid()) = %I) with check ((select auth.uid()) = %I)',
      owner_column,
      owner_column
    );
    revoke all on table public.profiles from anon, authenticated;
    grant select, insert, update, delete on table public.profiles to authenticated;
  end if;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'automation_jobs',
    'operator_submission_attempts',
    'payment_profiles',
    'fee_transactions',
    'fee_collection_batches',
    'payment_provider_events',
    'early_access_signups'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from anon, authenticated', table_name);
    end if;
  end loop;
end;
$$;

comment on function public.lease_automation_jobs(integer, text, integer) is
  'Atomically leases ready jobs with row locks so concurrent workers cannot process the same job.';
comment on function public.lease_payment_provider_events(integer, text, integer) is
  'Atomically leases signed provider events for idempotent reconciliation.';
comment on table public.fee_collection_batches is
  'One Direct Debit can collect several accrued 10% success-fee ledger entries.';
comment on function public.prepare_fee_collection_batch(
  uuid, integer, integer, integer, text
) is
  'Atomically reserves outstanding fees when the threshold or annual residual rule is met.';
comment on function public.get_fee_ledger_totals(uuid) is
  'Returns complete fee-ledger totals for one user without exposing payment tables to clients.';
