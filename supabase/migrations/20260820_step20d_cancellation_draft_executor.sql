-- Delai Step 20D
-- Records non-sensitive Greater Anglia Customer Relations draft-executor
-- checkpoints. The migration does not enable or perform final submission.

alter table public.claims
  add column if not exists cancellation_executor_key text,
  add column if not exists cancellation_executor_version text,
  add column if not exists cancellation_executor_checkpoint text,
  add column if not exists cancellation_form_draft_prepared_at timestamptz;

create index if not exists claims_cancellation_executor_checkpoint_idx
  on public.claims (
    cancellation_executor_key,
    cancellation_executor_checkpoint
  )
  where claim_type = 'cancellation_compensation';

comment on column public.claims.cancellation_executor_key is
  'Non-sensitive identifier for the browser executor used on a cancellation case.';

comment on column public.claims.cancellation_executor_version is
  'Version of the cancellation browser executor used for the latest draft attempt.';

comment on column public.claims.cancellation_executor_checkpoint is
  'Last non-sensitive browser checkpoint reached while preparing a cancellation form.';

comment on column public.claims.cancellation_form_draft_prepared_at is
  'Time the external cancellation form draft reached its protected final-submit boundary.';
