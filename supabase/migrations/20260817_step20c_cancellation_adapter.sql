-- Delai Step 20C
-- Adds non-sensitive cancellation adapter checkpoints and queues existing
-- Season Ticket cancellation cases for the dedicated adapter.

alter table public.claims
  add column if not exists cancellation_adapter_key text,
  add column if not exists cancellation_policy_version text,
  add column if not exists cancellation_case_prepared_at timestamptz,
  add column if not exists cancellation_submission_channel text;

create index if not exists claims_cancellation_adapter_idx
  on public.claims (
    claim_type,
    compensation_route,
    submission_status
  );

comment on column public.claims.cancellation_adapter_key is
  'Operator-specific adapter used to prepare a cancelled-journey compensation case.';

comment on column public.claims.cancellation_policy_version is
  'Versioned operator policy used when the cancellation case was prepared.';

comment on column public.claims.cancellation_case_prepared_at is
  'Time Delai completed the dedicated cancellation adapter mapping.';

comment on column public.claims.cancellation_submission_channel is
  'Non-sensitive external channel selected for the cancellation case.';

insert into public.automation_jobs (
  user_id,
  claim_id,
  job_type,
  status,
  run_after
)
select
  c.user_id,
  c.id,
  'claim_submit',
  'queued',
  now()
from public.claims c
where c.claim_type = 'cancellation_compensation'
  and c.compensation_route = 'season_ticket_cancelled_journey'
  and c.status in ('prepared', 'ready_to_submit')
  and not exists (
    select 1
    from public.automation_jobs aj
    where aj.claim_id = c.id
      and aj.job_type = 'claim_submit'
  );
