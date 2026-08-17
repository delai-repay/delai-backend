# Delai Step 20C — Cancelled-Journey Compensation Adapter

This package extends the completed Step 20B cancellation routing.

## What Step 20C does

- Keeps cancelled and abandoned journeys out of ordinary Delay Repay.
- Adds a generic cancellation-adapter registry for future UK operators.
- Adds the first Greater Anglia Season Ticket cancellation adapter.
- Validates exact service, passenger confirmation, abandoned outcome and ticket validity.
- Rejects invented delay minutes for cancelled journeys.
- Prepares the official Greater Anglia Customer Relations compensation case.
- Records a non-sensitive adapter checkpoint and audit attempt.
- Queues existing eligible Step 20B cases for the new adapter.
- Keeps final external form submission safety locked.

## Why the route is separate

Greater Anglia's March 2026 Passenger's Charter states that a Season Ticket
holder unable to travel should contact its Contact Centre for compensation
covering the journey. Ordinary Delay Repay is based on the delay at the arrival
station, which does not exist when the passenger abandons a cancelled journey.

## Installation order

1. Replace the matching backend source files with the files in this package.
2. Run `supabase/migrations/20260817_step20c_cancellation_adapter.sql` in the
   Supabase SQL Editor.
3. Run:

   ```text
   node scripts/testStep20CCancellations.js
   node scripts/testStep20BCancellations.js
   node scripts/testStep20ASecurity.js
   node scripts/testStep20Payments.js
   node scripts/testSubmissionValidation.js
   ```

4. Restart the local backend.

## Safety

No new environment variables are required for Step 20C. Do not enable these
future flags yet:

- `ENABLE_GREATER_ANGLIA_CANCELLATION_SUBMISSION`
- `GREATER_ANGLIA_CANCELLATION_FINAL_SUBMIT_ENABLED`

Even if they are accidentally enabled, this version still blocks final dispatch
because a verified Customer Relations form executor has not yet been added.
