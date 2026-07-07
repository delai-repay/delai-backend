function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function normaliseTicketType(ticketType) {
  return cleanText(ticketType)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isValidEmail(email) {
  const cleanEmail = cleanText(email);

  if (!cleanEmail) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
}

function looksLikeExactTime(value) {
  const cleanValue = cleanText(value);

  return /^([01]\d|2[0-3]):[0-5]\d$/.test(cleanValue);
}

function createIssue({
  code,
  field,
  message,
  severity = "error",
}) {
  return {
    code,
    field,
    message,
    severity,
  };
}

function validateSubmissionContext(submissionContext) {
  const errors = [];
  const warnings = [];

  function addError(code, field, message) {
    errors.push(
      createIssue({
        code,
        field,
        message,
        severity: "error",
      })
    );
  }

  function addWarning(code, field, message) {
    warnings.push(
      createIssue({
        code,
        field,
        message,
        severity: "warning",
      })
    );
  }

  if (!submissionContext || typeof submissionContext !== "object") {
    addError(
      "missing_submission_context",
      "submissionContext",
      "The universal submission context is missing."
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

  if (!submissionContext.contextVersion) {
    addError(
      "missing_context_version",
      "contextVersion",
      "The submission context version is missing."
    );
  }

  const claim = submissionContext.claim || {};
  const operator = submissionContext.operator || {};
  const passenger = submissionContext.passenger || {};
  const journey = submissionContext.journey || {};
  const ticket = submissionContext.ticket || {};

  if (!claim.id) {
    addError(
      "missing_claim_id",
      "claim.id",
      "The claim ID is missing."
    );
  }

  if (!claim.userId) {
    addError(
      "missing_user_id",
      "claim.userId",
      "The claim user ID is missing."
    );
  }

  if (!operator.suppliedName && !operator.displayName) {
    addError(
      "missing_operator",
      "operator.suppliedName",
      "The train operator is missing."
    );
  }

  if (operator.knownOperator !== true) {
    addError(
      "unknown_operator",
      "operator.key",
      "The train operator could not be matched to the UK operator catalogue."
    );
  }

  if (!passenger.fullName) {
    addError(
      "missing_passenger_name",
      "passenger.fullName",
      "The passenger's full name is missing."
    );
  }

  if (!passenger.email) {
    addError(
      "missing_passenger_email",
      "passenger.email",
      "The passenger's email address is missing."
    );
  } else if (!isValidEmail(passenger.email)) {
    addError(
      "invalid_passenger_email",
      "passenger.email",
      "The passenger's email address is not valid."
    );
  }

  if (!passenger.mobile) {
    addWarning(
      "missing_passenger_mobile",
      "passenger.mobile",
      "The passenger's mobile number is missing. Some operators may require it."
    );
  }

  if (!journey.date) {
    addError(
      "missing_journey_date",
      "journey.date",
      "The journey date is missing."
    );
  }

  if (!journey.originStation) {
    addError(
      "missing_origin_station",
      "journey.originStation",
      "The journey origin station is missing."
    );
  }

  if (!journey.destinationStation) {
    addError(
      "missing_destination_station",
      "journey.destinationStation",
      "The journey destination station is missing."
    );
  }

  if (!journey.scheduledTime) {
    addError(
      "missing_scheduled_time",
      "journey.scheduledTime",
      "The scheduled journey time is missing."
    );
  } else if (!looksLikeExactTime(journey.scheduledTime)) {
    addWarning(
      "scheduled_time_not_exact",
      "journey.scheduledTime",
      "The scheduled time does not appear to be an exact HH:MM train time."
    );
  }

  if (
    journey.delayMinutes === null ||
    journey.delayMinutes === undefined
  ) {
    addError(
      "missing_delay_minutes",
      "journey.delayMinutes",
      "The delay length is missing."
    );
  } else if (
    Number.isNaN(Number(journey.delayMinutes)) ||
    Number(journey.delayMinutes) < 0
  ) {
    addError(
      "invalid_delay_minutes",
      "journey.delayMinutes",
      "The delay length is not valid."
    );
  }

  if (!ticket.type) {
    addError(
      "missing_ticket_type",
      "ticket.type",
      "The ticket type is missing."
    );
  }

  if (
    ticket.cost === null ||
    ticket.cost === undefined ||
    Number(ticket.cost) <= 0
  ) {
    addError(
      "missing_ticket_cost",
      "ticket.cost",
      "A valid ticket cost is required."
    );
  }

  const ticketType = normaliseTicketType(ticket.type);

  const dailyTicketTypes = new Set([
    "daily",
    "day",
    "single",
    "return",
    "advance",
    "anytime",
    "off_peak",
    "super_off_peak",
    "open_return",
  ]);

  const smartcardTicketTypes = new Set([
  "weekly",
  "weekly_season_ticket",
  "monthly",
  "monthly_season_ticket",
  "annual",
  "annual_season_ticket",
  "season",
  "season_ticket",
  "flexi",
  "flexi_season",
  "flexi_season_ticket",
  "other",
]);

  if (dailyTicketTypes.has(ticketType)) {
    if (!ticket.bookingReference) {
      addError(
        "missing_booking_reference",
        "ticket.bookingReference",
        "A booking reference is required for this ticket type."
      );
    }
  } else if (smartcardTicketTypes.has(ticketType)) {
    if (!ticket.smartcardProvider) {
      addError(
        "missing_smartcard_provider",
        "ticket.smartcardProvider",
        "The smartcard provider is required for this ticket type."
      );
    }

    if (!ticket.smartcardNumber) {
      addError(
        "missing_smartcard_number",
        "ticket.smartcardNumber",
        "The smartcard number is required for this ticket type."
      );
    }

    if (!ticket.startDate) {
      addError(
        "missing_ticket_start_date",
        "ticket.startDate",
        "The ticket start date is required."
      );
    }

    if (!ticket.endDate) {
      addError(
        "missing_ticket_end_date",
        "ticket.endDate",
        "The ticket end date is required."
      );
    }
  } else if (ticketType) {
    addWarning(
      "unrecognised_ticket_type",
      "ticket.type",
      `The ticket type "${ticket.type}" is not yet covered by a specific validation rule.`
    );
  }

  if (
    ticket.originStation &&
    journey.originStation &&
    cleanText(ticket.originStation).toLowerCase() !==
      cleanText(journey.originStation).toLowerCase()
  ) {
    addWarning(
      "ticket_origin_mismatch",
      "ticket.originStation",
      "The ticket origin does not match the delayed journey origin."
    );
  }

  if (
    ticket.destinationStation &&
    journey.destinationStation &&
    cleanText(ticket.destinationStation).toLowerCase() !==
      cleanText(journey.destinationStation).toLowerCase()
  ) {
    addWarning(
      "ticket_destination_mismatch",
      "ticket.destinationStation",
      "The ticket destination does not match the delayed journey destination."
    );
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
    missingFields: [
      ...new Set(errors.map((issue) => issue.field)),
    ],
  };
}

export {
  normaliseTicketType,
  validateSubmissionContext,
};