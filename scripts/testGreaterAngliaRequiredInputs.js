import assert from "node:assert/strict";
import { buildClaimSubmissionContext } from "../src/operators/claimSubmissionContext.js";
import GreaterAngliaOperatorAdapter from "../src/operators/greaterAngliaOperatorAdapter.js";
import { buildGreaterAngliaPortalSubmissionPlan } from "../src/operators/greaterAngliaDelayRepayPortal.js";
import { validateSubmissionContext } from "../src/operators/submissionValidation.js";
import { getGreaterAngliaInputLabel, getGreaterAngliaRequiredInputIssues } from "../src/operators/greaterAngliaRequiredInputs.js";

const previousDefaultTitle = process.env.GREATER_ANGLIA_DEFAULT_TITLE;
delete process.env.GREATER_ANGLIA_DEFAULT_TITLE;

try {
  // Synthetic fixture: this test does not launch a browser or send a claim.
  const context = buildClaimSubmissionContext({
    claim: { id: "test-claim", user_id: "test-user", claim_type: "delay_repay" },
    detectedDelay: {
      id: "test-delay", operator: "Greater Anglia", service_date: "2026-10-07",
      origin_station: "London Liverpool Street", destination_station: "Hatfield Peverel",
      scheduled_departure_time: "18:42", delay_minutes: 20,
      passenger_confirmation_status: "confirmed",
    },
    profile: {
      title: "Dr", full_name: "Test Passenger", email: "test@example.invalid",
      mobile: "07000000000", address_line_1: "1 Example Street", postcode: "AA1 1AA",
      country: "United Kingdom",
    },
    seasonTicket: {
      ticket_type: "Single", ticket_cost: 20, booking_reference: "TEST-REF",
    },
  });
  const adapter = new GreaterAngliaOperatorAdapter();
  const payload = adapter.buildSubmissionPayload({ submissionContext: context });
  const plan = buildGreaterAngliaPortalSubmissionPlan(payload);

  // Reproduce the complete profile -> context -> adapter -> portal path.
  assert.equal(context.passenger.title, "Dr");
  assert.equal(payload.passenger.title, "Dr");
  assert.equal(plan.passengerStep.title, "Dr");
  assert.deepEqual(plan.automationReadiness.missingAutomationInputs, []);
  assert.equal(validateSubmissionContext(context).readyForSubmission, true);

  const legacyTitle = structuredClone(context);
  legacyTitle.passenger.title = "";
  legacyTitle.passenger.salutation = "Ms";
  const legacyPayload = adapter.buildSubmissionPayload({ submissionContext: legacyTitle });
  assert.equal(buildGreaterAngliaPortalSubmissionPlan(legacyPayload).passengerStep.title, "Ms");

  // A genuine missing value must be named before the browser is launched.
  const incomplete = structuredClone(context);
  Object.assign(incomplete.passenger, { title: " ", salutation: "", addressLine1: " ", postcode: "" });
  const invalid = validateSubmissionContext(incomplete);
  assert.equal(invalid.readyForSubmission, false);
  assert.deepEqual(new Set(invalid.missingFields), new Set([
    "passenger.title", "passenger.addressLine1", "passenger.postcode",
  ]));
  for (const field of invalid.missingFields) {
    assert.equal(invalid.errors.filter((issue) => issue.field === field).length, 1);
    assert.equal(invalid.warnings.some((issue) => issue.field === field), false);
    assert.ok(getGreaterAngliaInputLabel(field));
  }

  // Required field names must not contain the passenger's actual values.
  const publicIssues = JSON.stringify(getGreaterAngliaRequiredInputIssues(incomplete));
  for (const value of ["Test Passenger", "test@example.invalid", "1 Example Street", "TEST-REF"]) {
    assert.equal(publicIssues.includes(value), false);
  }

  // Keep the stricter rule specific to Greater Anglia Delay Repay.
  const otherOperator = structuredClone(incomplete);
  otherOperator.operator = { key: "lner", displayName: "LNER", suppliedName: "LNER", knownOperator: true };
  assert.equal(validateSubmissionContext(otherOperator).readyForSubmission, true);
  const cancellation = structuredClone(incomplete);
  cancellation.claim.claimType = "cancellation_compensation";
  assert.deepEqual(getGreaterAngliaRequiredInputIssues(cancellation), []);

  // Existing ticket failures remain specific and are not duplicated.
  const noReference = structuredClone(context);
  noReference.ticket.bookingReference = null;
  const noReferenceResult = validateSubmissionContext(noReference);
  assert.equal(noReferenceResult.errors.filter((issue) => issue.field.startsWith("ticket.")).length, 1);

  // The early check must agree with portal readiness for journey gaps too.
  const wrongTime = structuredClone(context);
  wrongTime.journey.scheduledTime = "evening";
  assert.equal(validateSubmissionContext(wrongTime).readyForSubmission, false);
  assert.ok(validateSubmissionContext(wrongTime).missingFields.includes("journey.scheduledTime"));

  console.log("Greater Anglia title mapping and required-input checks passed.");
} finally {
  if (previousDefaultTitle === undefined) delete process.env.GREATER_ANGLIA_DEFAULT_TITLE;
  else process.env.GREATER_ANGLIA_DEFAULT_TITLE = previousDefaultTitle;
}
