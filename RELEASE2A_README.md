# Delai Backend Release 2A

Release 2A adds a controlled final-submission boundary for the first Greater Anglia pilot claim.

## Safety model

A real final submission now requires both:

1. The existing Render pilot switch `GREATER_ANGLIA_FINAL_SUBMIT_ENABLED=true`.
2. A current, authenticated, claim-specific approval created through `POST /approve-claim-final-submit`.

The approval:

- belongs to one user and one claim;
- expires after 15 minutes;
- is consumed atomically once;
- is bound to a SHA-256 snapshot of the validated claim, journey, passenger, ticket and payment context;
- cannot be reused after data changes, expiry, revocation or an attempted submission;
- is stored in a backend-only, RLS-protected audit table.

Every other claim continues to stop at final review even while the global pilot switch is on. The cancellation final-submit implementation remains locked.

## Installation order

1. Extract this ZIP over the backend at commit `683bbb9`.
2. Run `npm run test:regression`.
3. Apply only `supabase/migrations/20260902_release2a_claim_submission_approvals.sql`.
4. Commit, push and confirm the Render deployment while `GREATER_ANGLIA_FINAL_SUBMIT_ENABLED=false`.
5. Perform another Greater Anglia dry run and review its screenshots.
6. Enable the global pilot switch only for the controlled pilot window.
7. Present the exact approval wording to the signed-in passenger and call the approval endpoint.
8. Trigger the worker once and inspect the resulting audit and operator reference.
9. Return the global pilot switch to `false` immediately after the controlled attempt.

## Approval request

The authenticated frontend sends:

```json
{
  "user_id": "SIGNED_IN_USER_ID",
  "claim_id": "READY_GREATER_ANGLIA_CLAIM_ID",
  "confirm_final_submission": true,
  "approval_acknowledgement": "I authorise Delai to submit this claim to Greater Anglia."
}
```

to `POST /approve-claim-final-submit` with the user's Supabase bearer token.

Do not enable the global pilot switch or send an approval request until the dry-run screenshots and claim details have been reviewed.
