const GREATER_ANGLIA_DELAY_REPAY_PORTAL = {
  operatorKey: "greater_anglia",
  displayName: "Greater Anglia",
  startClaimUrl:
    "https://greateranglia.delayrepaycompensation.com/index.cfm?action=myclaims.add",
  accountUrl: "https://greateranglia.delayrepaycompensation.com/index.cfm",
  appealUrl:
    "https://greateranglia.delayrepaycompensation.com/index.cfm?action=myclaims.appeal",
  submissionMethod: "playwright_browser_automation",
  provider: "Tracsis Travel Compensation Services",
  currentStrategyVersion: "greater-anglia-browser-strategy-1.1",
};

const DELAY_BANDS = [
  { min: 120, portalValue: "120+ Mins" },
  { min: 60, portalValue: "60+ Mins" },
  { min: 30, portalValue: "30+ Mins" },
  { min: 15, portalValue: "15+ Mins" },
];

const TICKET_TYPE_PORTAL_MAP = new Map([
  ["daily", "Other"],
  ["day", "Other"],
  ["single", "Single (one-way)"],
  ["single_return", "Return"],
  ["return", "Return"],
  ["advance", "Single (one-way)"],
  ["anytime", "Single (one-way)"],
  ["off_peak", "Single (one-way)"],
  ["super_off_peak", "Single (one-way)"],
  ["weekly", "7 Day Season"],
  ["weekly_season_ticket", "7 Day Season"],
  ["monthly", "Monthly Season"],
  ["monthly_season_ticket", "Monthly Season"],
  ["annual", "Annual Season"],
  ["annual_season_ticket", "Annual Season"],
  ["season", "Other Season Duration"],
  ["season_ticket", "Other Season Duration"],
  ["flexi", "8 in 28 Flexi"],
  ["flexi_season", "8 in 28 Flexi"],
  ["flexi_season_ticket", "8 in 28 Flexi"],
  ["other", "Other"],
]);

function cleanText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const cleanedValue = String(value).trim();
  return cleanedValue || null;
}

function boolEnv(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
}

function normaliseTicketType(ticketType) {
  return (
    cleanText(ticketType)
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || ""
  );
}

function splitScheduledTime(value) {
  const cleanValue = cleanText(value);

  if (!cleanValue) {
    return {
      hour: null,
      minute: null,
      exact: false,
    };
  }

  const exactMatch = cleanValue.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (exactMatch) {
    return {
      hour: exactMatch[1],
      minute: exactMatch[2],
      exact: true,
    };
  }

  const windowMatch = cleanValue.match(/([01]\d|2[0-3]):([0-5]\d)/);

  if (windowMatch) {
    return {
      hour: windowMatch[1],
      minute: windowMatch[2],
      exact: false,
    };
  }

  return {
    hour: null,
    minute: null,
    exact: false,
  };
}

function getDelayBand(delayMinutes) {
  const cleanDelayMinutes = Number(delayMinutes);

  if (Number.isNaN(cleanDelayMinutes)) {
    return null;
  }

  const matchingBand = DELAY_BANDS.find(
    (band) => cleanDelayMinutes >= band.min
  );

  return matchingBand?.portalValue || null;
}

function mapTicketTypeToPortal(ticketType) {
  const normalisedTicketType = normaliseTicketType(ticketType);

  return (
    TICKET_TYPE_PORTAL_MAP.get(normalisedTicketType) ||
    cleanText(ticketType) ||
    "Other"
  );
}

function buildGreaterAngliaPortalSubmissionPlan(mappedSubmission = {}) {
  const passenger = mappedSubmission.passenger || {};
  const journey = mappedSubmission.journey || {};
  const ticket = mappedSubmission.ticket || {};
  const scheduledTime = splitScheduledTime(journey.scheduledTime);
  const delayBand = getDelayBand(journey.delayMinutes);

  const plan = {
    strategyVersion:
      GREATER_ANGLIA_DELAY_REPAY_PORTAL.currentStrategyVersion,
    operator: {
      key: GREATER_ANGLIA_DELAY_REPAY_PORTAL.operatorKey,
      displayName: GREATER_ANGLIA_DELAY_REPAY_PORTAL.displayName,
      provider: GREATER_ANGLIA_DELAY_REPAY_PORTAL.provider,
    },
    submissionMethod:
      GREATER_ANGLIA_DELAY_REPAY_PORTAL.submissionMethod,
    portal: {
      startClaimUrl: GREATER_ANGLIA_DELAY_REPAY_PORTAL.startClaimUrl,
      accountUrl: GREATER_ANGLIA_DELAY_REPAY_PORTAL.accountUrl,
    },
    safety: {
      liveSubmissionRequiresEnv: [
        "ENABLE_GREATER_ANGLIA_LIVE_SUBMISSION=true",
        "GREATER_ANGLIA_SUBMISSION_METHOD=playwright",
        "GREATER_ANGLIA_PLAYWRIGHT_EXECUTOR_ENABLED=true",
        "GREATER_ANGLIA_FINAL_SUBMIT_ENABLED=true",
      ],
      executorCanRunWithoutFinalSubmit:
        boolEnv("GREATER_ANGLIA_PLAYWRIGHT_EXECUTOR_ENABLED"),
      finalSubmitEnabled: boolEnv("GREATER_ANGLIA_FINAL_SUBMIT_ENABLED"),
      expectedReferenceLabels: [
        "Your Claim Reference Number",
        "Claim Reference Number",
        "Reference Number",
      ],
    },
    journeyStep: {
      dateOfJourney: cleanText(journey.date),
      scheduledDepartureHour: scheduledTime.hour,
      scheduledDepartureMinute: scheduledTime.minute,
      scheduledTimeWasExact: scheduledTime.exact,
      fromStation: cleanText(journey.originStation),
      toStation: cleanText(journey.destinationStation),
      delayBand,
      delayType: "Delayed",
    },
    ticketStep: {
      moreThanOneTicket: false,
      hasBarcode: false,
      ticketType: mapTicketTypeToPortal(ticket.type),
      ticketFormat: ticket.smartcardNumber
        ? "Smartcard"
        : ticket.bookingReference
          ? "Reference"
          : "Manual ticket details",
      smartcardNumber: cleanText(ticket.smartcardNumber),
      uniqueTicketReference: cleanText(ticket.bookingReference),
      originStation: cleanText(ticket.originStation),
      destinationStation: cleanText(ticket.destinationStation),
      dateFrom: cleanText(ticket.startDate),
      expiryDate: cleanText(ticket.endDate),
      ticketPrice: ticket.cost ?? null,
      ticketClass: "Standard Class",
    },
    passengerStep: {
      fullName: cleanText(passenger.fullName),
      email: cleanText(passenger.email),
      mobile: cleanText(passenger.mobile),
      addressLine1: cleanText(passenger.addressLine1),
      addressLine2: cleanText(passenger.addressLine2),
      townCity: cleanText(passenger.townCity),
      postcode: cleanText(passenger.postcode),
      country: cleanText(passenger.country) || "United Kingdom",
    },
    compensationStep: {
      preferredPaymentMethod:
        cleanText(passenger.preferredPaymentMethod) || "BACS",
      bankDetailsRequiredForBacs: true,
      availableOperatorMethods: [
        "PayPal",
        "BACS",
        "Payment back to debit or credit card used",
        "Rail Travel Vouchers",
      ],
    },
    confirmationStep: {
      customerDeclarationRequired: true,
      fraudWarningMustBeShownBeforeSubmit: true,
      submitOnlyWhenPassengerConfirmedTravel: true,
    },
  };

  const missingAutomationInputs = [];

  if (!plan.journeyStep.dateOfJourney) {
    missingAutomationInputs.push("journey date");
  }

  if (!plan.journeyStep.scheduledDepartureHour) {
    missingAutomationInputs.push("exact scheduled departure time");
  }

  if (!plan.journeyStep.fromStation || !plan.journeyStep.toStation) {
    missingAutomationInputs.push("journey stations");
  }

  if (!plan.journeyStep.delayBand) {
    missingAutomationInputs.push("delay band");
  }

  if (!plan.passengerStep.fullName || !plan.passengerStep.email) {
    missingAutomationInputs.push("passenger contact details");
  }

  if (!plan.ticketStep.smartcardNumber && !plan.ticketStep.uniqueTicketReference) {
    missingAutomationInputs.push("smartcard number or ticket reference");
  }

  return {
    ...plan,
    automationReadiness: {
      readyForBrowserAutomation: missingAutomationInputs.length === 0,
      missingAutomationInputs,
    },
  };
}

function getGreaterAngliaSubmissionMode() {
  if (process.env.ENABLE_GREATER_ANGLIA_LIVE_SUBMISSION !== "true") {
    return "disabled";
  }

  return process.env.GREATER_ANGLIA_SUBMISSION_METHOD || "disabled";
}

function isGreaterAngliaPlaywrightExecutorEnabled() {
  return (
    getGreaterAngliaSubmissionMode() === "playwright" &&
    boolEnv("GREATER_ANGLIA_PLAYWRIGHT_EXECUTOR_ENABLED")
  );
}

function isGreaterAngliaFinalSubmitEnabled() {
  return (
    isGreaterAngliaPlaywrightExecutorEnabled() &&
    boolEnv("GREATER_ANGLIA_FINAL_SUBMIT_ENABLED")
  );
}

function getGreaterAngliaIntegrationStatus() {
  const mode = getGreaterAngliaSubmissionMode();

  if (mode !== "playwright") {
    return "browser_automation_strategy_ready";
  }

  if (!isGreaterAngliaPlaywrightExecutorEnabled()) {
    return "playwright_executor_pending";
  }

  if (isGreaterAngliaFinalSubmitEnabled()) {
    return "live_submission_enabled";
  }

  return "playwright_executor_ready_safety_locked";
}

export {
  GREATER_ANGLIA_DELAY_REPAY_PORTAL,
  buildGreaterAngliaPortalSubmissionPlan,
  getDelayBand,
  getGreaterAngliaIntegrationStatus,
  getGreaterAngliaSubmissionMode,
  isGreaterAngliaFinalSubmitEnabled,
  isGreaterAngliaPlaywrightExecutorEnabled,
  mapTicketTypeToPortal,
  splitScheduledTime,
};
