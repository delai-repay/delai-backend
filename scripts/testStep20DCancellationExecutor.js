import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GreaterAngliaCancellationAdapter,
  getGreaterAngliaCancellationIntegrationStatus,
} from "../src/cancellations/greaterAngliaCancellationAdapter.js";
import {
  CANCELLATION_FINAL_SUBMIT_IMPLEMENTED,
  EXECUTOR_VERSION,
  buildGreaterAngliaCancellationFormDraft,
  buildGreaterAngliaCancellationQuestion,
  splitPassengerName,
  validateGreaterAngliaCancellationDraftPreflight,
} from "../src/cancellations/greaterAngliaCancellationPlaywrightExecutor.js";
import { buildSafeSubmissionResponse } from "../src/security/claimResponseSanitizer.js";

for (const name of [
  "ENABLE_GREATER_ANGLIA_CANCELLATION_SUBMISSION",
  "GREATER_ANGLIA_CANCELLATION_FINAL_SUBMIT_ENABLED",
  "GREATER_ANGLIA_CANCELLATION_PLAYWRIGHT_ENABLED",
]) {
  delete process.env[name];
}

const submissionContext = {
  contextVersion: "1.4-cancellations",
  claim: {
    id: "claim-step20d",
    userId: "user-step20d",
    detectedDelayId: "delay-step20d",
    claimType: "cancellation_compensation",
    compensationRoute: "season_ticket_cancelled_journey",
    journeyOutcome: "abandoned",
  },
  operator: {
    key: "greater_anglia",
    displayName: "Greater Anglia",
    suppliedName: "Greater Anglia",
    knownOperator: true,
  },
  passenger: {
    title: "Mr",
    fullName: "Example Test Passenger",
    email: "passenger@example.com",
    mobile: "07123456789",
    addressLine1: "1 Example Street",
    addressLine2: "Example District",
    townCity: "Chelmsford",
    postcode: "CM1 1AA",
    country: "United Kingdom",
  },
  journey: {
    serviceIdentifier: "2F31",
    serviceStatus: "cancelled",
    date: "2026-08-20",
    scheduledTime: "08:07",
    scheduledArrivalTime: "08:54",
    originStation: "Hatfield Peverel",
    destinationStation: "London Liverpool Street",
    passengerConfirmationStatus: "confirmed",
    journeyOutcome: "abandoned",
    disruptionReason: "Signalling failure",
    delayMinutes: null,
  },
  ticket: {
    id: "ticket-step20d",
    type: "Annual season ticket",
    cost: 5000,
    originStation: "Hatfield Peverel",
    destinationStation: "London Liverpool Street",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    smartcardProvider: "Greater Anglia",
    smartcardNumber: "123456789012345678",
  },
  paymentDetails: {
    bankAccountName: "Example Test Passenger",
    sortCode: "200000",
    accountNumber: "55779911",
  },
};

const adapter = new GreaterAngliaCancellationAdapter();
const mappedSubmission = adapter.buildCasePayload({
  claim: {
    id: "claim-step20d",
    user_id: "user-step20d",
    detected_delay_id: "delay-step20d",
    claim_type: "cancellation_compensation",
    compensation_route: "season_ticket_cancelled_journey",
    journey_outcome: "abandoned",
  },
  detectedDelay: {
    id: "delay-step20d",
    operator: "Greater Anglia",
    service_status: "cancelled",
  },
  submissionContext,
});

assert.deepEqual(splitPassengerName("Example Test Passenger"), {
  firstName: "Example Test",
  lastName: "Passenger",
});
assert.deepEqual(splitPassengerName("Prince"), {
  firstName: "Prince",
  lastName: null,
});

const draft = buildGreaterAngliaCancellationFormDraft(mappedSubmission);
assert.equal(draft.firstName, "Example Test");
assert.equal(draft.lastName, "Passenger");
assert.equal(draft.journeyDate, "2026-08-20");
assert.equal(draft.journeyTime, "08:07");
assert.equal(draft.ticketCost, "5000.00");
assert.equal(draft.marketingConsent, false);
assert.equal(draft.regulatorResearchConsent, false);

const preflight = validateGreaterAngliaCancellationDraftPreflight(
  mappedSubmission
);
assert.equal(preflight.valid, true);
assert.deepEqual(preflight.missingFields, []);

const singleNamePreflight = validateGreaterAngliaCancellationDraftPreflight({
  ...mappedSubmission,
  passenger: {
    ...mappedSubmission.passenger,
    fullName: "Prince",
  },
});
assert.equal(singleNamePreflight.valid, false);
assert.ok(singleNamePreflight.missingFields.includes("passenger last name"));

const question = buildGreaterAngliaCancellationQuestion(mappedSubmission);
assert.match(question, /cancelled and abandoned journey/i);
assert.match(question, /Hatfield Peverel to London Liverpool Street/);
assert.doesNotMatch(question, /123456789012345678/);
assert.doesNotMatch(question, /200000/);
assert.doesNotMatch(question, /55779911/);
assert.equal(Object.hasOwn(mappedSubmission, "paymentDetails"), false);
assert.equal(mappedSubmission.safety.finalSubmitEnabled, false);
assert.equal(mappedSubmission.safety.finalSubmitHardLocked, true);

const disabledResult = await adapter.submitCase({
  claim: {
    id: "claim-step20d",
    user_id: "user-step20d",
    claim_type: "cancellation_compensation",
    compensation_route: "season_ticket_cancelled_journey",
  },
  detectedDelay: {
    id: "delay-step20d",
    operator: "Greater Anglia",
  },
  submissionContext,
});
assert.equal(disabledResult.submitted, false);
assert.equal(disabledResult.blocked, true);
assert.equal(disabledResult.ready, true);
assert.equal(disabledResult.finalSubmitEnabled, false);
assert.equal(
  disabledResult.integrationStatus,
  "cancellation_adapter_ready_safety_locked"
);
assert.equal(
  disabledResult.source,
  "greater_anglia_cancellation_draft_executor_disabled"
);
assert.equal(disabledResult.executorVersion, EXECUTOR_VERSION);

process.env.GREATER_ANGLIA_CANCELLATION_PLAYWRIGHT_ENABLED = "true";
process.env.GREATER_ANGLIA_CANCELLATION_FINAL_SUBMIT_ENABLED = "true";
process.env.ENABLE_GREATER_ANGLIA_CANCELLATION_SUBMISSION = "true";

let executorInput = null;
const controlledAdapter = new GreaterAngliaCancellationAdapter({
  draftExecutor: async (input) => {
    executorInput = input;
    return {
      submitted: false,
      blocked: true,
      ready: true,
      reason: "Protected form boundary reached.",
      source: "greater_anglia_cancellation_playwright_safety_locked",
      integrationStatus: "cancellation_playwright_ready_safety_locked",
      submissionStatus: "cancellation_form_draft_ready",
      checkpoint: "final_submit_boundary",
      blocker_code: "cancellation_final_submit_safety_lock",
      finalSubmitEnabled: false,
      executorVersion: EXECUTOR_VERSION,
      draftPreparedAt: "2026-08-20T12:00:00.000Z",
      runContext: {
        executorVersion: EXECUTOR_VERSION,
        finalSubmitEnabled: false,
        checkpoint: "final_submit_boundary",
        screenshots: [{ path: "private-draft.png" }],
      },
    };
  },
});

const controlledResult = await controlledAdapter.submitCase({
  claim: {
    id: "claim-step20d",
    user_id: "user-step20d",
    claim_type: "cancellation_compensation",
    compensation_route: "season_ticket_cancelled_journey",
  },
  detectedDelay: {
    id: "delay-step20d",
    operator: "Greater Anglia",
  },
  submissionContext,
});

assert.ok(executorInput?.mappedSubmission);
assert.equal(controlledResult.submitted, false);
assert.equal(controlledResult.blocked, true);
assert.equal(controlledResult.ready, true);
assert.equal(controlledResult.finalSubmitEnabled, false);
assert.equal(controlledResult.checkpoint, "final_submit_boundary");
assert.equal(
  controlledResult.submissionStatus,
  "cancellation_form_draft_ready"
);
assert.equal(
  getGreaterAngliaCancellationIntegrationStatus(),
  "cancellation_playwright_ready_safety_locked"
);
assert.equal(CANCELLATION_FINAL_SUBMIT_IMPLEMENTED, false);

const safeResult = buildSafeSubmissionResponse(controlledResult);
assert.equal(safeResult.executor_version, EXECUTOR_VERSION);
assert.equal(safeResult.final_submit_enabled, false);
assert.equal(JSON.stringify(safeResult).includes("private-draft.png"), false);
assert.equal(JSON.stringify(safeResult).includes("123456789012345678"), false);

const executorSource = readFileSync(
  new URL(
    "../src/cancellations/greaterAngliaCancellationPlaywrightExecutor.js",
    import.meta.url
  ),
  "utf8"
);
assert.match(
  executorSource,
  /const CANCELLATION_FINAL_SUBMIT_IMPLEMENTED = false;/
);
assert.doesNotMatch(executorSource, /clickFinalSubmit/);
assert.match(executorSource, /Step 20D did not and cannot press Submit/);

const serverSource = readFileSync(
  new URL("../src/server.js", import.meta.url),
  "utf8"
);
for (const column of [
  "cancellation_executor_key",
  "cancellation_executor_version",
  "cancellation_executor_checkpoint",
  "cancellation_form_draft_prepared_at",
]) {
  assert.match(serverSource, new RegExp(`\\b${column}\\b`));
}

const migrationSource = readFileSync(
  new URL(
    "../supabase/migrations/20260820_step20d_cancellation_draft_executor.sql",
    import.meta.url
  ),
  "utf8"
);
for (const column of [
  "cancellation_executor_key",
  "cancellation_executor_version",
  "cancellation_executor_checkpoint",
  "cancellation_form_draft_prepared_at",
]) {
  assert.match(migrationSource, new RegExp(`\\b${column}\\b`));
}
assert.doesNotMatch(migrationSource, /submitted_at|operator_reference/);

console.log("Step 20D cancellation draft executor tests passed.");
