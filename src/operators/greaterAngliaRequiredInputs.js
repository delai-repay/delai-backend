import { buildGreaterAngliaPortalSubmissionPlan } from "./greaterAngliaDelayRepayPortal.js";

// Reuse the executor's own readiness check so the customer sees gaps before
// the browser is started. These are field labels only, never profile values.
const FIELD_LABELS = Object.freeze({
  "passenger.title": "Passenger title is missing.",
  "passenger.fullName": "Passenger full name is missing.",
  "passenger.email": "Passenger email address is missing.",
  "passenger.addressLine1": "Passenger address line 1 is missing.",
  "passenger.postcode": "Passenger postcode is missing.",
  "journey.date": "Journey date is missing.",
  "journey.scheduledTime": "An exact scheduled departure time is required.",
  "journey.originStation": "Journey origin station is missing.",
  "journey.destinationStation": "Journey destination station is missing.",
  "journey.delayMinutes": "An eligible journey delay length is required.",
  "ticket.reference": "A Smartcard number or ticket reference is missing.",
});

export function getGreaterAngliaInputLabel(issue) {
  const field = typeof issue === "string" ? issue : issue?.field;
  return FIELD_LABELS[field] || null;
}

export function getGreaterAngliaRequiredInputIssues(context = {}) {
  if (
    context.operator?.key !== "greater_anglia" ||
    (context.claim?.claimType && context.claim.claimType !== "delay_repay")
  ) {
    return [];
  }

  const plan = buildGreaterAngliaPortalSubmissionPlan({
    passenger: context.passenger || {},
    journey: context.journey || {},
    ticket: context.ticket || {},
  });
  const missing = plan.automationReadiness?.missingAutomationInputs || [];
  const passenger = context.passenger || {};
  const journey = context.journey || {};
  const requiredFields = {
    "journey date": ["missing_journey_date", "journey.date"],
    "exact scheduled departure time": ["missing_exact_departure_time", "journey.scheduledTime"],
    "journey stations": [
      "missing_journey_station",
      String(journey.originStation || "").trim() ? "journey.destinationStation" : "journey.originStation",
    ],
    "delay band": ["missing_eligible_delay_length", "journey.delayMinutes"],
    "passenger title": ["missing_passenger_title", "passenger.title"],
    "passenger contact details": [
      "missing_passenger_contact",
      String(passenger.fullName || "").trim() ? "passenger.email" : "passenger.fullName",
    ],
    "passenger postcode": ["missing_passenger_postcode", "passenger.postcode"],
    "passenger address line 1": ["missing_passenger_address_line_1", "passenger.addressLine1"],
    "smartcard number or ticket reference": ["missing_ticket_reference", "ticket.reference"],
  };

  return missing.map((input) => {
    const [code, field] = requiredFields[input] || ["missing_greater_anglia_input", "claim.operatorInputs"];
    const label = FIELD_LABELS[field] || "A detail required by Greater Anglia is missing.";
    return { code, field, message: label, label, severity: "error" };
  });
}
