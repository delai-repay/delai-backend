# Delai Backend Release 2B

Release 2B prevents Greater Anglia Delay Repay claims from being approved or sent after the operator's 28-day claim window.

## Behaviour

- The delayed journey date is day zero.
- The date 28 calendar days later is the final eligible submission date.
- The claim becomes expired on the following UK calendar day.
- UK local dates are used at runtime, including British Summer Time.
- Missing or invalid journey dates block submission as `awaiting_information`.
- Expired claims are labelled `claim_deadline_expired` and never open the browser executor.
- Final-submit approval independently repeats the deadline check.
- Cancellation compensation cases are excluded from this ordinary Delay Repay policy.

## Database migration

Apply only:

`supabase/migrations/20260914_release2b_claim_deadline_protection.sql`

The migration adds deadline audit columns and backfills Greater Anglia ordinary Delay Repay claims. Existing expired `prepared` or `ready_to_submit` claims are labelled `claim_deadline_expired`. It does not delete claims or alter cancellation cases.

## Safe rollout

1. Keep `GREATER_ANGLIA_FINAL_SUBMIT_ENABLED=false`.
2. Extract this overlay over the Release 2A backend.
3. Run syntax checks and `npm run test:regression`.
4. Apply the Release 2B migration.
5. Confirm the two old ordinary test claims show `claim_deadline_expired` and the cancellation case remains unchanged.
6. Commit, push and verify `/health`.
7. Use a new, genuine Greater Anglia journey within 28 days for the controlled dry run.
