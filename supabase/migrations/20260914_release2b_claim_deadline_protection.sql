begin;

alter table public.claims
  add column if not exists submission_deadline_date date,
  add column if not exists submission_deadline_checked_at timestamptz,
  add column if not exists submission_deadline_expired_at timestamptz;

create index if not exists claims_submission_deadline_idx
  on public.claims (submission_deadline_date, status)
  where status in ('prepared', 'ready_to_submit');

update public.claims claim
set
  submission_deadline_date = delay.service_date + 28,
  submission_deadline_checked_at = now(),
  submission_deadline_expired_at = case
    when delay.service_date + 28 < current_date
      then coalesce(claim.submission_deadline_expired_at, now())
    else null
  end,
  submission_status = case
    when delay.service_date + 28 < current_date
      and claim.status in ('prepared', 'ready_to_submit')
      then 'claim_deadline_expired'
    else claim.submission_status
  end,
  submission_error = case
    when delay.service_date + 28 < current_date
      and claim.status in ('prepared', 'ready_to_submit')
      then 'Greater Anglia requires Delay Repay claims within 28 days of the delayed journey.'
    else claim.submission_error
  end
from public.detected_delays delay
where delay.id = claim.detected_delay_id
  and delay.user_id = claim.user_id
  and lower(trim(delay.operator)) in ('greater anglia', 'greater_anglia')
  and coalesce(claim.claim_type, 'delay_repay') = 'delay_repay'
  and delay.service_date is not null;

comment on column public.claims.submission_deadline_date is
  'Last eligible calendar date for submitting this claim under the routed operator policy.';
comment on column public.claims.submission_deadline_checked_at is
  'Most recent time Delai evaluated the operator claim deadline.';
comment on column public.claims.submission_deadline_expired_at is
  'Time Delai first blocked this claim because its submission window had expired.';

commit;
