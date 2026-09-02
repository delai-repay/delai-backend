# Delai Backend Release 1

Release 1 hardens the existing `3c18dd3` backend and changes success-fee collection from one Direct Debit per claim to an accumulated ledger.

## What this release includes

- Authentication and ownership enforcement on every customer claim mutation.
- Constant-time cron-secret checks and POST-only automation routes.
- Signed GoCardless webhook verification using the unmodified request body.
- Per-IP API, claim, payment and early-access rate limits.
- UUID and payment-value validation.
- Supabase row-level security for customer-owned operational tables.
- Backend-only payment, job, audit and early-access tables.
- Atomic automation-job leasing using `FOR UPDATE SKIP LOCKED`.
- An auditable 10% fee ledger.
- One Direct Debit when accumulated fees reach £5.
- Annual residual collection after 365 days when at least £1 is due.
- Idempotent GoCardless batch-payment creation and webhook reconciliation.
- A customer-owned `GET /fee-ledger` API response with no bank details.

## Safety locks preserved

This release does not enable final submission to Greater Anglia. The cancellation executor still contains:

```js
const CANCELLATION_FINAL_SUBMIT_IMPLEMENTED = false;
```

Keep these Render values set to `false` during verification:

```text
GREATER_ANGLIA_FINAL_SUBMIT_ENABLED=false
GREATER_ANGLIA_CANCELLATION_FINAL_SUBMIT_ENABLED=false
PAYMENTS_FEE_COLLECTION_ENABLED=false
PAYMENTS_LIVE_COLLECTION_ENABLED=false
```

## Installation order

1. Stop the local backend if it is running.
2. Extract the release ZIP over `C:\Users\rolla\delai-backend`.
3. Confirm that `node_modules` and `operator-run-artifacts` were not replaced.
4. Run the Supabase migration in the SQL editor:

   `supabase/migrations/20260824_release1_security_fee_ledger.sql`

5. Add the new non-secret configuration values from `.env.example` to local `.env` and Render. Do not replace existing secrets.
6. Keep GoCardless in sandbox and fee collection disabled for the first deployment.
7. Run the checks below.

## Windows CMD verification

```bat
cd C:\Users\rolla\delai-backend
node --check src\server.js
node --check src\payments\paymentAutomation.js
node --check src\payments\feeLedgerService.js
npm run test:regression
git status --short
```

The migration should report success with no rows returned. The regression command should end with:

```text
Release 1 security and accumulated fee-ledger tests passed.
```

## Safe rollout sequence

1. Commit and push Release 1 with all collection flags `false`.
2. Confirm Render deploys and `/health` returns `{"ok":true,"service":"delai-backend"}`.
3. Run the cron once and confirm jobs lease and complete normally.
4. Inspect `GET /fee-ledger` while signed in; paid claims should accrue but no Direct Debit should be created while collection is disabled.
5. Configure and verify GoCardless sandbox credentials and webhook secret.
6. Set only `PAYMENTS_FEE_COLLECTION_ENABLED=true` in sandbox.
7. Test multiple small fees: they must remain outstanding until the balance reaches 500 pence, then create one batch payment.
8. Verify the signed webhook marks the batch, its ledger entries and linked claims as collected.
9. Do not enable live collection or operator final submission until the sandbox evidence has been reviewed.

## New environment values

| Variable | Default | Purpose |
|---|---:|---|
| `AUTOMATION_JOB_LEASE_SECONDS` | `300` | Releases a crashed worker's jobs after five minutes. |
| `PAYMENTS_FEE_COLLECTION_THRESHOLD_PENCE` | `500` | Creates a collection batch at £5. |
| `PAYMENTS_ANNUAL_RESIDUAL_DAYS` | `365` | Makes an old residual balance eligible annually. |
| `PAYMENTS_MIN_ANNUAL_COLLECTION_PENCE` | `100` | Avoids uneconomic annual collections below £1. |
| `API_RATE_LIMIT_MAX` | `300` | General requests per 15-minute window. |
| `CLAIM_RATE_LIMIT_MAX` | `120` | Claim mutations per 15-minute window. |
| `PAYMENT_RATE_LIMIT_MAX` | `40` | Payment requests per 15-minute window. |
| `EARLY_ACCESS_RATE_LIMIT_MAX` | `10` | Public signups per hour per source IP. |

## Operational notes

- The in-process rate limiter is appropriate for the current single Render instance. Replace it with a shared Redis-backed limiter before horizontally scaling the API.
- `lease_automation_jobs` and `prepare_fee_collection_batch` are database functions restricted to the Supabase service role.
- The API ignores any customer-supplied fee percentage and always records the agreed 10% rate.
- Existing one-claim `fee_transactions` are retained and backfilled into the ledger structure; no financial history is deleted.
- Account-closure collection is supported by the database batch function as `account_closure`, but no customer account-deletion endpoint is introduced in this release.
