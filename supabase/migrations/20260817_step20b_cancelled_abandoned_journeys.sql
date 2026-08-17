-- Delai Step 20B
-- Safely separates cancelled/abandoned journeys from ordinary Delay Repay.

alter table public.detected_delays
  add column if not exists service_status text not null default 'delayed',
  add column if not exists journey_outcome text,
  add column if not exists journey_outcome_confirmed_at timestamptz,
  add column if not exists compensation_route text,
  add column if not exists disruption_reason text;

alter table public.claims
  add column if not exists claim_type text not null default 'delay_repay',
  add column if not exists compensation_route text,
  add column if not exists journey_outcome text;

alter table public.detected_delays
  drop constraint if exists detected_delays_service_status_check;

alter table public.detected_delays
  add constraint detected_delays_service_status_check
  check (service_status in ('delayed', 'cancelled', 'part_cancelled'));

alter table public.detected_delays
  drop constraint if exists detected_delays_journey_outcome_check;

alter table public.detected_delays
  add constraint detected_delays_journey_outcome_check
  check (
    journey_outcome is null
    or journey_outcome in ('travelled', 'abandoned', 'not_travelled')
  );

alter table public.detected_delays
  drop constraint if exists detected_delays_compensation_route_check;

alter table public.detected_delays
  add constraint detected_delays_compensation_route_check
  check (
    compensation_route is null
    or compensation_route in (
      'delay_repay',
      'season_ticket_cancelled_journey',
      'unused_ticket_refund',
      'manual_review'
    )
  );

alter table public.claims
  drop constraint if exists claims_claim_type_check;

alter table public.claims
  add constraint claims_claim_type_check
  check (
    claim_type in (
      'delay_repay',
      'cancellation_compensation',
      'cancellation_refund'
    )
  );

alter table public.claims
  drop constraint if exists claims_compensation_route_check;

alter table public.claims
  add constraint claims_compensation_route_check
  check (
    compensation_route is null
    or compensation_route in (
      'delay_repay',
      'season_ticket_cancelled_journey',
      'unused_ticket_refund',
      'manual_review'
    )
  );

alter table public.claims
  drop constraint if exists claims_journey_outcome_check;

alter table public.claims
  add constraint claims_journey_outcome_check
  check (
    journey_outcome is null
    or journey_outcome in ('travelled', 'abandoned', 'not_travelled')
  );

create index if not exists detected_delays_service_status_idx
  on public.detected_delays (service_status, service_date);

create index if not exists claims_claim_type_idx
  on public.claims (claim_type, submission_status);

comment on column public.detected_delays.service_status is
  'Exact service outcome from the live service feed: delayed, cancelled or part_cancelled.';

comment on column public.detected_delays.journey_outcome is
  'Passenger-confirmed journey outcome. Abandoned means the passenger did not travel.';

comment on column public.claims.claim_type is
  'Separates normal Delay Repay claims from cancellation compensation/refund cases.';
