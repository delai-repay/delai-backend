import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  GREATER_ANGLIA_CLAIM_WINDOW_DAYS,
  evaluateGreaterAngliaClaimDeadline,
  getUkCalendarDate,
} from "../src/claims/claimDeadlinePolicy.js";

assert.equal(GREATER_ANGLIA_CLAIM_WINDOW_DAYS, 28);

const beforeDeadline = evaluateGreaterAngliaClaimDeadline({
  serviceDate: "2026-07-24",
  now: new Date("2026-08-20T12:00:00Z"),
});
assert.equal(beforeDeadline.deadlineDate, "2026-08-21");
assert.equal(beforeDeadline.eligible, true);
assert.equal(beforeDeadline.daysRemaining, 1);

const onDeadline = evaluateGreaterAngliaClaimDeadline({
  serviceDate: "2026-07-24",
  now: new Date("2026-08-21T12:00:00Z"),
});
assert.equal(onDeadline.eligible, true);
assert.equal(onDeadline.expired, false);
assert.equal(onDeadline.daysRemaining, 0);

const afterDeadline = evaluateGreaterAngliaClaimDeadline({
  serviceDate: "2026-07-24",
  now: new Date("2026-08-22T12:00:00Z"),
});
assert.equal(afterDeadline.eligible, false);
assert.equal(afterDeadline.expired, true);
assert.equal(afterDeadline.reason, "claim_deadline_expired");

assert.equal(
  getUkCalendarDate(new Date("2026-08-21T23:30:00Z")),
  "2026-08-22"
);
assert.equal(
  evaluateGreaterAngliaClaimDeadline({
    serviceDate: "2026-07-24",
    now: new Date("2026-08-21T23:30:00Z"),
  }).expired,
  true
);

for (const invalidDate of [null, "", "24/07/2026", "2026-02-30"]) {
  const result = evaluateGreaterAngliaClaimDeadline({
    serviceDate: invalidDate,
    now: new Date("2026-08-01T12:00:00Z"),
  });
  assert.equal(result.valid, false);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "missing_or_invalid_service_date");
}

const serverSource = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
const sanitizerSource = await readFile(
  new URL("../src/security/claimResponseSanitizer.js", import.meta.url),
  "utf8"
);
const migrationSource = await readFile(
  new URL(
    "../supabase/migrations/20260914_release2b_claim_deadline_protection.sql",
    import.meta.url
  ),
  "utf8"
);

assert.match(serverSource, /evaluateAndPersistGreaterAngliaDeadline/);
assert.match(serverSource, /customer_status: missingDate[\s\S]*"claim_deadline_expired"/);
assert.match(serverSource, /The 28-day Greater Anglia claim deadline has passed/);
assert.match(sanitizerSource, /submission_deadline_date/);
assert.match(migrationSource, /delay\.service_date \+ 28 < current_date/i);
assert.match(migrationSource, /coalesce\(claim\.claim_type, 'delay_repay'\) = 'delay_repay'/i);
assert.doesNotMatch(
  migrationSource,
  /coalesce\(claim\.claim_type, 'delay_repay'\) = 'cancellation_compensation'/i
);

console.log("Release 2B Greater Anglia claim-deadline protection tests passed.");
