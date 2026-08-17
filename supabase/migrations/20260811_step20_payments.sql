-- Delai Step 20: customer payout details and 10% success-fee collection.
-- Run once in the Supabase SQL editor before deploying the Step 20 backend.

create extension if not exists pgcrypto;

create table if not exists public.payment_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payout_method text not null default 'BACS',
  bank_account_name_encrypted text,
  sort_code_encrypted text,
  account_number_encrypted text,
  sort_code_last2 text,
  account_number_last4 text,
  bank_details_updated_at timestamptz,
  fee_terms_version text,
  fee_terms_accepted_at timestamptz,
  direct_debit_provider text not null default 'gocardless',
  gocardless_billing_request_id text unique,
  gocardless_billing_request_flow_id text,
  gocardless_customer_id text,
  gocardless_mandate_id text unique,
  mandate_status text not null default 'not_started',
  mandate_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_profiles_payout_method_check
    check (payout_method in ('BACS')),
  constraint payment_profiles_sort_code_last2_check
    check (sort_code_last2 is null or sort_code_last2 ~ '^[0-9]{2}$'),
  constraint payment_profiles_account_last4_check
    check (account_number_last4 is null or account_number_last4 ~ '^[0-9]{4}$')
);

create table if not exists public.fee_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  claim_id uuid not null references public.claims(id) on delete cascade,
  compensation_amount numeric(12,2) not null,
  fee_percentage numeric(5,2) not null default 10.00,
  fee_amount numeric(12,2) not null,
  currency text not null default 'GBP',
  status text not null default 'pending',
  provider text not null default 'gocardless',
  provider_payment_id text,
  idempotency_key text,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  failure_code text,
  failure_message text,
  collected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_transactions_claim_unique unique (claim_id),
  constraint fee_transactions_provider_payment_unique unique (provider_payment_id),
  constraint fee_transactions_idempotency_unique unique (idempotency_key),
  constraint fee_transactions_amount_check check (fee_amount > 0),
  constraint fee_transactions_percentage_check
    check (fee_percentage >= 0 and fee_percentage <= 100)
);

create table if not exists public.payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  resource_type text not null,
  action text not null,
  payload jsonb not null,
  status text not null default 'received',
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payment_provider_events_unique
    unique (provider, provider_event_id)
);

create index if not exists fee_transactions_user_created_idx
  on public.fee_transactions (user_id, created_at desc);

create index if not exists fee_transactions_status_idx
  on public.fee_transactions (status, updated_at);

create index if not exists payment_provider_events_pending_idx
  on public.payment_provider_events (status, next_attempt_at);

alter table public.claims
  add column if not exists fee_provider text,
  add column if not exists fee_provider_payment_id text,
  add column if not exists fee_collection_error text,
  add column if not exists fee_collected_at timestamptz;

alter table public.payment_profiles enable row level security;
alter table public.fee_transactions enable row level security;
alter table public.payment_provider_events enable row level security;

-- These tables are intentionally server-only. The service-role backend bypasses
-- RLS; authenticated browser clients receive no direct table access.
revoke all on table public.payment_profiles from anon, authenticated;
revoke all on table public.fee_transactions from anon, authenticated;
revoke all on table public.payment_provider_events from anon, authenticated;

comment on table public.payment_profiles is
  'Server-only encrypted payout details and payment-provider mandate references.';
comment on table public.fee_transactions is
  'Auditable Delai success-fee collection records; one record per paid claim.';
comment on table public.payment_provider_events is
  'Durable, idempotent payment-provider webhook event inbox.';
