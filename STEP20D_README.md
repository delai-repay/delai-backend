# Delai Step 20D — Greater Anglia Cancellation Form Draft Executor

## 2026-08-21 live-form compatibility hotfix

- Updates the executor audit version to
  `greater-anglia-cancellation-draft-1.0.2`.
- Locates the visible Greater Anglia postcode control using its label, postal
  autocomplete attribute, and current name/id variants.
- Skips hidden duplicate controls instead of assuming the first matching
  element is visible.
- Handles the current required “Best time to call” selector using an explicit
  passenger `AM` or `PM` preference. For the controlled local test only, set
  `GREATER_ANGLIA_CANCELLATION_BEST_TIME_TO_CALL=PM`; a later profile change
  should persist this per passenger.
- Selects the privacy-preserving “No thank you” marketing option and “No”
  regulator-research option using their scoped live radio groups.
- Treats Ticket Cost as an optional live-form control because it is not
  displayed for every Customer Relations contact reason.
- Keeps `CANCELLATION_FINAL_SUBMIT_IMPLEMENTED = false`; no final Submit action
  has been added.

Step 20D extends the verified Step 20C cancellation adapter with a protected
Playwright executor for Greater Anglia's Customer Relations form.

## What it does

- Uses the dedicated cancelled-journey compensation route, never Delay Repay.
- Maps the current Customer Relations contact, journey and ticket fields.
- Selects a safe complaint/compensation contact reason from the live options.
- Declines optional marketing and regulator-research contact where available.
- Builds a cancellation statement without bank or smartcard details.
- Detects required ticket-evidence uploads and stops safely if evidence is
  required but unavailable.
- Captures controlled browser checkpoints in `operator-run-artifacts`.
- Verifies that exactly one final `Submit` control is present.
- Stops at that boundary without clicking it.

## Hard safety boundary

Step 20D cannot submit the external form. The executor contains no final-submit
click function, and `CANCELLATION_FINAL_SUBMIT_IMPLEMENTED` is hard-coded to
`false`.

These older future flags remain ignored by the Step 20D executor:

- `ENABLE_GREATER_ANGLIA_CANCELLATION_SUBMISSION`
- `GREATER_ANGLIA_CANCELLATION_FINAL_SUBMIT_ENABLED`

## Installation order

1. Replace the matching backend files with the files in this package.
2. Run the local tests below.
3. Run
   `supabase/migrations/20260820_step20d_cancellation_draft_executor.sql`
   in the Supabase SQL Editor before deploying the updated backend.
4. Commit and deploy the backend.
5. Keep the cancellation Playwright flag disabled in production until a
   controlled dry run is ready.

## Tests

```text
node scripts/testStep20DCancellationExecutor.js
node scripts/testStep20CCancellations.js
node scripts/testStep20BCancellations.js
node scripts/testStep20ASecurity.js
node scripts/testStep20Payments.js
node scripts/testSubmissionValidation.js
```

## Controlled dry-run settings

No new environment variables are required for ordinary production operation.
The draft executor remains disabled by default.

For a deliberately supervised dry run only:

```text
GREATER_ANGLIA_CANCELLATION_PLAYWRIGHT_ENABLED=true
GREATER_ANGLIA_CANCELLATION_HEADLESS=false
GREATER_ANGLIA_CANCELLATION_CAPTURE_SCREENSHOTS=true
```

The dry run fills the form and stops before `Submit`. If Greater Anglia makes a
ticket image mandatory, the executor records an evidence-required blocker and
does not attempt to bypass it.

Browser screenshots can contain passenger information. Keep
`operator-run-artifacts/` out of Git and do not upload those files publicly.
