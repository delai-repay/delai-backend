import {
  isCancelledService,
  isSeasonTicketType,
} from "../delays/journeyDisruptionRouting.js";

function cleanText(value) {
  return String(value ?? "").trim();
}

function isValidEmail(value) {
  const email = cleanText(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isExactTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(cleanText(value));
}

function dateOnly(value) {
  const match = cleanText(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || null;
}

function createIssue(code, field, message, severity = "error") {
  return { code, field, message, severity };
}

function validateCancellationSubmissionContext(submissionContext) {
  const errors = [];
  const warnings = [];

  const addError = (code, field, message) =>
    errors.push(createIssue(code, field, message));
  const addWarning = (code, field, message) =>
    warnings.push(createIssue(code, field, message, "warning"));

  if (!submissionContext || typeof submissionContext !== "object") {
    addError(
      "missing_submission_context",
      "submissionContext",
      "The cancellation submission context is missing."
    );

    return {
      valid: false,
      readyForSubmission: false,
      checkedAt: new Date().toISOString(),
      contextVersion: null,
      blockingIssueCount: errors.length,
      warningCount: warnings.length,
      errors,
      warnings,
      missingFields: errors.map((issue) => issue.field),
    };
  }

  const claim = submissionContext.claim || {};
  const operator = submissionContext.operator || {};
  const passenger = submissionContext.passenger || {};
  const journey = submissionContext.journey || {};
  const ticket = submissionContext.ticket || {};

  if (!claim.id) addError("missing_claim_id", "claim.id", "The claim ID is missing.");
  if (!claim.userId) addError("missing_user_id", "claim.userId", "The claim user ID is missing.");

  if (claim.claimType !== "cancellation_compensation") {
    addError(
      "invalid_claim_type",
      "claim.claimType",
      "The case is not marked as cancellation compensation."
    );
  }

  if (claim.compensationRoute !== "season_ticket_cancelled_journey") {
    addError(
      "invalid_compensation_route",
      "claim.compensationRoute",
      "The case is not on the Season Ticket cancelled-journey route."
    );
  }

  if (operator.knownOperator !== true) {
    addError(
      "unknown_operator",
      "operator.key",
      "The train operator could not be matched to the operator catalogue."
    );
  }

  if (!passenger.fullName) {
    addError("missing_passenger_name", "passenger.fullName", "The passenger's full name is missing.");
  }

  if (!isValidEmail(passenger.email)) {
    addError("invalid_passenger_email", "passenger.email", "A valid passenger email address is required.");
  }

  if (!passenger.addressLine1) {
    addError("missing_passenger_address", "passenger.addressLine1", "The passenger's address is required by the operator contact route.");
  }

  if (!passenger.postcode) {
    addError("missing_passenger_postcode", "passenger.postcode", "The passenger's postcode is required by the operator contact route.");
  }

  if (!isCancelledService(journey.serviceStatus)) {
    addError("service_not_cancelled", "journey.serviceStatus", "The exact service is not recorded as cancelled.");
  }

  if (cleanText(journey.journeyOutcome).toLowerCase() !== "abandoned") {
    addError("journey_not_abandoned", "journey.journeyOutcome", "The passenger has not confirmed that the journey was abandoned.");
  }

  if (cleanText(journey.passengerConfirmationStatus).toLowerCase() !== "confirmed") {
    addError("passenger_confirmation_required", "journey.passengerConfirmationStatus", "Passenger confirmation is required before preparing cancellation compensation.");
  }

  const serviceDate = dateOnly(journey.date);
  if (!serviceDate) {
    addError("missing_service_date", "journey.date", "The exact service date is missing.");
  }

  if (!isExactTime(journey.scheduledTime)) {
    addError("missing_exact_scheduled_time", "journey.scheduledTime", "An exact HH:MM scheduled departure time is required.");
  }

  if (!journey.originStation) {
    addError("missing_origin_station", "journey.originStation", "The journey origin station is missing.");
  }

  if (!journey.destinationStation) {
    addError("missing_destination_station", "journey.destinationStation", "The journey destination station is missing.");
  }

  if (journey.delayMinutes !== null && journey.delayMinutes !== undefined) {
    addError("unexpected_delay_minutes", "journey.delayMinutes", "A cancelled and abandoned journey must not use invented delay minutes.");
  }

  if (!isSeasonTicketType(ticket.type)) {
    addError("season_ticket_required", "ticket.type", "A valid Season Ticket is required for this compensation route.");
  }

  if (!Number.isFinite(Number(ticket.cost)) || Number(ticket.cost) <= 0) {
    addError("missing_ticket_cost", "ticket.cost", "A valid Season Ticket cost is required.");
  }

  if (!ticket.smartcardProvider) {
    addError("missing_smartcard_provider", "ticket.smartcardProvider", "The smartcard provider is required.");
  }

  if (!ticket.smartcardNumber) {
    addError("missing_smartcard_number", "ticket.smartcardNumber", "The smartcard number is required.");
  }

  const ticketStart = dateOnly(ticket.startDate);
  const ticketEnd = dateOnly(ticket.endDate);

  if (!ticketStart) {
    addError("missing_ticket_start_date", "ticket.startDate", "The Season Ticket start date is required.");
  }

  if (!ticketEnd) {
    addError("missing_ticket_end_date", "ticket.endDate", "The Season Ticket end date is required.");
  }

  if (serviceDate && ticketStart && ticketEnd) {
    if (serviceDate < ticketStart || serviceDate > ticketEnd) {
      addError("ticket_not_valid_on_service_date", "ticket.startDate", "The Season Ticket was not valid on the cancelled service date.");
    }
  }

  if (!journey.serviceIdentifier) {
    addWarning("missing_service_identifier", "journey.serviceIdentifier", "The exact service identifier is missing; date, time and stations will be used instead.");
  }

  if (!journey.disruptionReason) {
    addWarning("missing_disruption_reason", "journey.disruptionReason", "The cancellation reason was not supplied by the service feed.");
  }

  return {
    valid: errors.length === 0,
    readyForSubmission: errors.length === 0,
    checkedAt: new Date().toISOString(),
    contextVersion: submissionContext.contextVersion || null,
    blockingIssueCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    missingFields: [...new Set(errors.map((issue) => issue.field))],
  };
}

export { validateCancellationSubmissionContext };
