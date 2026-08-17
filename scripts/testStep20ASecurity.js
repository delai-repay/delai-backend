import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSafeClaimResponse,
  buildSafeSubmissionResponse,
} from "../src/security/claimResponseSanitizer.js";

const sensitiveClaim = {
  id: "claim-test",
  user_id: "user-secret",
  status: "ready_to_submit",
  submission_status: "awaiting_operator_integration",
  prepared_summary: "Passenger email and full smartcard details",
  smartcard_number: "633597024611480820",
  submitted_at: null,
  payment_status: "not_paid",
};

const safeClaim = buildSafeClaimResponse(sensitiveClaim);
assert.deepEqual(Object.keys(safeClaim), [
  "id",
  "status",
  "submission_status",
  "claim_type",
  "compensation_route",
  "journey_outcome",
  "submitted_at",
  "operator_reference",
  "outcome",
  "outcome_updated_at",
  "payment_status",
]);
assert.equal(safeClaim.id, "claim-test");

const sensitiveSubmission = {
  blocked: true,
  submission: {
    submitted: false,
    blocked: true,
    checkpoint: "final_review",
    blocker_code: "final_submit_safety_lock",
    operator: "Greater Anglia",
    operatorKey: "greater_anglia",
    integrationStatus: "playwright_executor_ready_safety_locked",
    finalSubmitEnabled: false,
    runContext: {
      passenger: {
        fullName: "Test Passenger",
        email: "private@example.invalid",
        address: "1 Private Street",
      },
      mappedSubmission: {
        smartcardNumber: "633597024611480820",
        sortCode: "200000",
        accountNumber: "55779911",
      },
    },
    operator_submission_audit: {
      recorded: true,
      audit_id: "audit-test",
      result_status: "blocked",
      screenshot_count: 6,
      screenshots: [{ path: "private-local-path.png" }],
    },
  },
};

const safeSubmission = buildSafeSubmissionResponse(sensitiveSubmission);
assert.equal(safeSubmission.checkpoint, "final_review");
assert.equal(safeSubmission.blocker_code, "final_submit_safety_lock");
assert.equal(safeSubmission.final_submit_enabled, false);
assert.equal(
  safeSubmission.operator_submission_audit.screenshot_count,
  6
);

const serialized = JSON.stringify({ safeClaim, safeSubmission });
for (const secret of [
  "user-secret",
  "private@example.invalid",
  "1 Private Street",
  "633597024611480820",
  "200000",
  "55779911",
  "private-local-path.png",
]) {
  assert.equal(serialized.includes(secret), false, `Leaked: ${secret}`);
}

const serverSource = readFileSync(
  new URL("../src/server.js", import.meta.url),
  "utf8"
);

for (const route of [
  "validate-claim-submission",
  "submit-claim-with-delai",
]) {
  const protectedRoutePattern = new RegExp(
    `app\\.post\\(\\s*["']/${route}["'],\\s*requireAuthenticatedUser`,
    "m"
  );
  assert.match(
    serverSource,
    protectedRoutePattern,
    `${route} must require an authenticated user`
  );
}

assert.match(serverSource, /const user_id = req\.authUser\.id;/);
const submissionRouteStart = serverSource.indexOf(
  'app.post("/submit-claim-with-delai"'
);
const submissionRouteEnd = serverSource.indexOf(
  'app.post("/mark-claim-ready"',
  submissionRouteStart
);
const submissionRouteSource = serverSource.slice(
  submissionRouteStart,
  submissionRouteEnd
);

assert.ok(submissionRouteStart >= 0 && submissionRouteEnd > submissionRouteStart);
assert.doesNotMatch(submissionRouteSource, /claim:\s*finalClaim[,\n]/);
assert.doesNotMatch(
  submissionRouteSource,
  /submission:\s*submissionResult(?:\.submission)?[,\n]/
);

console.log("Step 20A claim API security tests passed.");
