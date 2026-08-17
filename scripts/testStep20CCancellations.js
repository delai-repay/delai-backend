import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getCancellationAdapter,
  getCancellationIntegrationStatus,
} from "../src/cancellations/cancellationAdapterRegistry.js";
import { validateCancellationSubmissionContext } from "../src/cancellations/cancellationValidation.js";

delete process.env.ENABLE_GREATER_ANGLIA_CANCELLATION_SUBMISSION;
delete process.env.GREATER_ANGLIA_CANCELLATION_FINAL_SUBMIT_ENABLED;

const validContext = {
  contextVersion: "1.4-cancellations",
  claim: {
    id: "claim-step20c",
    userId: "user-step20c",
    detectedDelayId: "delay-step20c",
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
    fullName: "Example Passenger",
    email: "passenger@example.com",
    mobile: "07123456789",
    addressLine1: "1 Example Street",
    townCity: "Chelmsford",
    postcode: "CM1 1AA",
    country: "United Kingdom",
  },
  journey: {
    serviceIdentifier: "greater-anglia-2026-08-17-0807-hap-lst",
    serviceStatus: "cancelled",
    date: "2026-08-17",
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
    id: "ticket-step20c",
    type: "Annual season ticket",
    cost: 5000,
    originStation: "Hatfield Peverel",
    destinationStation: "London Liverpool Street",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    smartcardProvider: "Greater Anglia",
    smartcardNumber: "1234567890",
  },
};

const validation = validateCancellationSubmissionContext(validContext);
assert.equal(validation.readyForSubmission, true);
assert.equal(validation.blockingIssueCount, 0);

const inventedDelayValidation = validateCancellationSubmissionContext({
  ...validContext,
  journey: {
    ...validContext.journey,
    delayMinutes: 120,
  },
});

assert.equal(inventedDelayValidation.readyForSubmission, false);
assert.ok(
  inventedDelayValidation.errors.some(
    (issue) => issue.code === "unexpected_delay_minutes"
  )
);

const invalidTicketValidation = validateCancellationSubmissionContext({
  ...validContext,
  ticket: {
    ...validContext.ticket,
    type: "Daily ticket",
  },
});

assert.equal(invalidTicketValidation.readyForSubmission, false);
assert.ok(
  invalidTicketValidation.errors.some(
    (issue) => issue.code === "season_ticket_required"
  )
);

const adapter = getCancellationAdapter({
  operator: "Greater Anglia",
  compensationRoute: "season_ticket_cancelled_journey",
});

const adapterResult = await adapter.submitCase({
  claim: {
    id: "claim-step20c",
    user_id: "user-step20c",
    detected_delay_id: "delay-step20c",
    claim_type: "cancellation_compensation",
    compensation_route: "season_ticket_cancelled_journey",
    journey_outcome: "abandoned",
  },
  detectedDelay: {
    id: "delay-step20c",
    operator: "Greater Anglia",
    service_status: "cancelled",
  },
  submissionContext: validContext,
});

assert.equal(adapterResult.submitted, false);
assert.equal(adapterResult.blocked, true);
assert.equal(adapterResult.ready, true);
assert.equal(adapterResult.submissionStatus, "cancellation_adapter_ready");
assert.equal(
  adapterResult.integrationStatus,
  "cancellation_adapter_ready_safety_locked"
);
assert.equal(adapterResult.finalSubmitEnabled, false);
assert.match(adapterResult.customer_message, /has not been submitted/);
assert.match(adapterResult.customer_next_step, /Submit the prepared case/);
assert.equal(
  adapterResult.mappedSubmission.submissionChannel.type,
  "operator_customer_relations_form"
);
assert.equal(
  adapterResult.mappedSubmission.policy.policyVersion,
  "greater-anglia-passenger-charter-2026-03"
);
assert.equal(
  adapterResult.mappedSubmission.journey.delayMinutes,
  null
);
assert.equal(
  adapterResult.mappedSubmission.safety.ordinaryDelayRepayBlocked,
  true
);
assert.equal(
  Object.hasOwn(adapterResult.mappedSubmission, "paymentDetails"),
  false
);

const unknownAdapter = getCancellationAdapter({
  operator: "Example Rail",
  compensationRoute: "season_ticket_cancelled_journey",
});
const unknownResult = await unknownAdapter.submitCase({
  submissionContext: validContext,
});
assert.equal(unknownResult.ready, false);
assert.equal(unknownResult.source, "cancellation_adapter_not_connected");

const integration = getCancellationIntegrationStatus({
  operator: "Greater Anglia",
  compensationRoute: "season_ticket_cancelled_journey",
});
assert.equal(integration.adapterRegistered, true);
assert.equal(
  integration.integrationStatus,
  "cancellation_adapter_ready_safety_locked"
);

const serverSource = readFileSync(
  new URL("../src/server.js", import.meta.url),
  "utf8"
);
assert.match(serverSource, /submitCancellationThroughAdapter/);
assert.match(serverSource, /processCancellationCompensationSubmitJob/);
assert.match(serverSource, /validateCancellationSubmissionContext/);
assert.match(serverSource, /queueCancellationCompensationSubmission/);
assert.match(serverSource, /cancellation_adapter_ready/);
assert.match(serverSource, /claim\.claim_type === "cancellation_refund"/);

const contextSource = readFileSync(
  new URL("../src/operators/claimSubmissionContext.js", import.meta.url),
  "utf8"
);
assert.match(contextSource, /contextVersion: "1\.4-cancellations"/);
assert.match(contextSource, /scheduled_departure_time/);
assert.match(contextSource, /passenger_confirmation_status/);
assert.match(contextSource, /disruption_reason/);

const migrationSource = readFileSync(
  new URL(
    "../supabase/migrations/20260817_step20c_cancellation_adapter.sql",
    import.meta.url
  ),
  "utf8"
);

for (const column of [
  "cancellation_adapter_key",
  "cancellation_policy_version",
  "cancellation_case_prepared_at",
  "cancellation_submission_channel",
]) {
  assert.match(migrationSource, new RegExp(`\\b${column}\\b`));
}

assert.match(migrationSource, /insert into public\.automation_jobs/);
assert.match(migrationSource, /season_ticket_cancelled_journey/);

console.log("Step 20C cancellation adapter tests passed.");
