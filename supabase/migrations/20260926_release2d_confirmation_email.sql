begin;

create table if not exists public.delay_confirmation_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  detected_delay_id uuid not null references public.detected_delays(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  processing_at timestamptz,
  consumed_at timestamptz,
  consumed_response text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint delay_confirmation_tokens_response_check
    check (consumed_response is null or consumed_response in ('yes', 'no'))
);

create index if not exists delay_confirmation_tokens_active_hash_idx
  on public.delay_confirmation_tokens (token_hash, expires_at)
  where consumed_at is null and revoked_at is null;

create index if not exists delay_confirmation_tokens_delay_idx
  on public.delay_confirmation_tokens (detected_delay_id, created_at desc);

create table if not exists public.notification_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  detected_delay_id uuid references public.detected_delays(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete cascade,
  confirmation_token_id uuid references public.delay_confirmation_tokens(id) on delete set null,
  provider text not null default 'resend',
  provider_message_id text,
  idempotency_key text not null unique,
  status text not null default 'pending',
  error_code text,
  error_message text,
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_email_deliveries_status_check
    check (status in ('pending', 'sent', 'failed', 'skipped'))
);

create index if not exists notification_email_deliveries_notification_idx
  on public.notification_email_deliveries (notification_id, created_at desc);

create index if not exists notification_email_deliveries_status_idx
  on public.notification_email_deliveries (status, attempted_at);

alter table public.delay_confirmation_tokens enable row level security;
alter table public.notification_email_deliveries enable row level security;

revoke all on table public.delay_confirmation_tokens from anon, authenticated;
revoke all on table public.notification_email_deliveries from anon, authenticated;

comment on table public.delay_confirmation_tokens is
  'Hashed, expiring and single-use tokens for passenger journey confirmation links. Raw tokens are never stored.';

comment on table public.notification_email_deliveries is
  'Server-only audit trail for transactional confirmation email delivery. Recipient addresses are not stored here.';

commit;
