import BaseOperatorAdapter from "./baseOperatorAdapter.js";
import {
  buildGreaterAngliaPortalSubmissionPlan,
  getGreaterAngliaIntegrationStatus,
  getGreaterAngliaSubmissionMode,
} from "./greaterAngliaDelayRepayPortal.js";

function cleanText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const cleanedValue = String(value).trim();
  return cleanedValue || null;
}

function cleanMoney(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numberValue = Number(value);
  return Number.isNaN(numberValue) ? null : numberValue;
}

function buildYesNo(value) {
  return value ? "yes" : "no";
}

class GreaterAngliaOperatorAdapter extends BaseOperatorAdapter {
  constructor() {
    super({
      operatorKey: "greater_anglia",
      displayName: "Greater Anglia",
    });

    this.integrationStatus = getGreaterAngliaIntegrationStatus();
    this.adapterVersion = "greater-anglia-1.1";
    this.submissionStrategy = "playwright_browser_automation";
  }

  buildSubmissionPayload({ claim, detectedDelay, submissionContext } = {}) {
    const passenger = submissionContext?.passenger || {};
    const journey = submissionContext?.journey || {};
    const ticket = submissionContext?.ticket || {};
    const commute = submissionContext?.commute || {};

    return {
      adapterVersion: this.adapterVersion,
      mappedAt: new Date().toISOString(),
      operator: {
        key: this.operatorKey,
        displayName: this.displayName,
        claimPortal: "Greater Anglia Delay Repay",
        submissionMode: this.submissionStrategy,
      },
      claim: {
        id: claim?.id || submissionContext?.claim?.id || null,
        userId: claim?.user_id || submissionContext?.claim?.userId || null,
        detectedDelayId:
          claim?.detected_delay_id ||
          submissionContext?.claim?.detectedDelayId ||
          detectedDelay?.id ||
          null,
        preparedSummary: cleanText(submissionContext?.claim?.preparedSummary),
      },
      passenger: {
        fullName: cleanText(passenger.fullName),
        email: cleanText(passenger.email),
        mobile: cleanText(passenger.mobile),
        addressLine1: cleanText(passenger.addressLine1),
        addressLine2: cleanText(passenger.addressLine2),
        townCity: cleanText(passenger.townCity),
        postcode: cleanText(passenger.postcode),
        country: cleanText(passenger.country) || "United Kingdom",
        preferredPaymentMethod: cleanText(passenger.preferredPaymentMethod),
      },
      journey: {
        date: cleanText(journey.date),
        originStation: cleanText(journey.originStation),
        destinationStation: cleanText(journey.destinationStation),
        direction: cleanText(journey.direction),
        travelWindow: cleanText(journey.travelWindow),
        scheduledTime: cleanText(journey.scheduledTime),
        actualTime: cleanText(journey.actualTime),
        delayMinutes:
          journey.delayMinutes === undefined || journey.delayMinutes === null
            ? null
            : Number(journey.delayMinutes),
        source: cleanText(journey.source),
      },
      ticket: {
        type: cleanText(ticket.type),
        cost: cleanMoney(ticket.cost),
        originStation: cleanText(ticket.originStation),
        destinationStation: cleanText(ticket.destinationStation),
        startDate: cleanText(ticket.startDate),
        endDate: cleanText(ticket.endDate),
        bookingReference: cleanText(ticket.bookingReference),
        smartcardProvider: cleanText(ticket.smartcardProvider),
        smartcardNumber: cleanText(ticket.smartcardNumber),
        hasSmartcardNumber: buildYesNo(cleanText(ticket.smartcardNumber)),
      },
      commute: {
        id: commute.id || null,
        originStation: cleanText(commute.originStation),
        destinationStation: cleanText(commute.destinationStation),
        outboundTime: cleanText(commute.outboundTime),
        returnTime: cleanText(commute.returnTime),
        travelDays: Array.isArray(commute.travelDays)
          ? commute.travelDays
          : [],
      },
    };
  }

  async submitClaim({ claim, detectedDelay, submissionContext } = {}) {
    const mappedSubmission = this.buildSubmissionPayload({
      claim,
      detectedDelay,
      submissionContext,
    });

    const portalSubmissionPlan = buildGreaterAngliaPortalSubmissionPlan(
      mappedSubmission
    );

    const submissionMode = getGreaterAngliaSubmissionMode();

    if (submissionMode !== "playwright") {
      return {
        submitted: false,
        blocked: true,
        reason:
          "Greater Anglia browser automation strategy is ready, but live external submission is not enabled yet.",
        source: "greater_anglia_browser_automation_strategy_ready",
        operator: this.displayName,
        operatorKey: this.operatorKey,
        integrationStatus: this.integrationStatus,
        submissionStrategy: this.submissionStrategy,
        customer_status: "operator_submission_pending",
        customer_title: "Claim ready for Delai submission",
        customer_message:
          "Your claim is ready. Delai is preparing automatic submission for Greater Anglia.",
        customer_next_step:
          "No further action is needed right now. Delai has saved the mapped claim details and will continue once live submission is enabled.",
        mappedSubmission,
        portalSubmissionPlan,
      };
    }

    return {
      submitted: false,
      blocked: true,
      reason:
        "Greater Anglia Playwright submission mode is enabled, but the verified browser executor has not been connected yet.",
      source: "greater_anglia_playwright_executor_pending",
      operator: this.displayName,
      operatorKey: this.operatorKey,
      integrationStatus: "playwright_executor_pending",
      submissionStrategy: this.submissionStrategy,
      customer_status: "operator_submission_pending",
      customer_title: "Claim ready for Delai submission",
      customer_message:
        "Your claim is ready. Delai is preparing automatic submission for Greater Anglia.",
      customer_next_step:
        "No further action is needed right now. Delai has saved the mapped claim details and is waiting for the verified browser executor.",
      mappedSubmission,
      portalSubmissionPlan,
    };
  }

  async checkOutcome() {
    return {
      found: false,
      final: false,
      outcome: "still_waiting",
      blocked: true,
      reason:
        "Greater Anglia outcome checking is not connected yet.",
      source: "greater_anglia_outcome_adapter_pending",
      operator: this.displayName,
      operatorKey: this.operatorKey,
    };
  }

  async checkPayment() {
    return {
      found: false,
      paid: false,
      blocked: true,
      reason:
        "Greater Anglia payment checking is not connected yet.",
      source: "greater_anglia_payment_adapter_pending",
      operator: this.displayName,
      operatorKey: this.operatorKey,
    };
  }
}

export default GreaterAngliaOperatorAdapter;
