import BaseCancellationAdapter from "./baseCancellationAdapter.js";

const GREATER_ANGLIA_CANCELLATION_POLICY = {
  policyVersion: "greater-anglia-passenger-charter-2026-03",
  policyName: "Greater Anglia Passenger's Charter March 2026",
  passengerCharterUrl:
    "https://www.greateranglia.co.uk/media/16044/download?inline=",
  customerRelationsUrl:
    "https://www.greateranglia.co.uk/form/customer-relations",
  contactCentrePhone: "0345 600 7245",
  contactCentreOption: "8",
};

function boolEnv(name) {
  return String(process.env[name] || "").trim().toLowerCase() === "true";
}

function getGreaterAngliaCancellationIntegrationStatus() {
  if (!boolEnv("ENABLE_GREATER_ANGLIA_CANCELLATION_SUBMISSION")) {
    return "cancellation_adapter_ready_safety_locked";
  }

  if (!boolEnv("GREATER_ANGLIA_CANCELLATION_FINAL_SUBMIT_ENABLED")) {
    return "cancellation_adapter_ready_final_submit_disabled";
  }

  return "cancellation_dispatch_executor_pending";
}

class GreaterAngliaCancellationAdapter extends BaseCancellationAdapter {
  constructor() {
    super({
      operatorKey: "greater_anglia",
      displayName: "Greater Anglia",
      compensationRoute: "season_ticket_cancelled_journey",
    });

    this.adapterVersion = "greater-anglia-cancellation-1.0";
    this.submissionStrategy =
      "greater_anglia_customer_relations_case_preparation";
    this.policyVersion = GREATER_ANGLIA_CANCELLATION_POLICY.policyVersion;
  }

  buildCasePayload({ claim, detectedDelay, submissionContext } = {}) {
    const basePayload = super.buildCasePayload({
      claim,
      detectedDelay,
      submissionContext,
    });

    const journey = basePayload.journey;
    const ticket = basePayload.ticket;

    return {
      ...basePayload,
      adapterVersion: this.adapterVersion,
      operator: {
        ...basePayload.operator,
        submissionMode: this.submissionStrategy,
      },
      policy: {
        ...GREATER_ANGLIA_CANCELLATION_POLICY,
        eligibilityDecision: "operator_determined",
        compensationAmount: "operator_determined",
        claimDeadlineDays: 28,
      },
      submissionChannel: {
        type: "operator_customer_relations_form",
        url: GREATER_ANGLIA_CANCELLATION_POLICY.customerRelationsUrl,
        liveDispatchImplemented: false,
        finalSubmitRequiresVerifiedExecutor: true,
      },
      compensationRequest: {
        subject: "Season Ticket compensation for cancelled journey",
        requestedOutcome:
          "Please assess compensation covering the cost of this journey under the Greater Anglia Passenger's Charter.",
        passengerStatement:
          "The passenger confirmed that the exact scheduled service was cancelled and that they abandoned the journey without travelling.",
        serviceEvidence: {
          serviceIdentifier: journey.serviceIdentifier,
          serviceStatus: journey.serviceStatus,
          date: journey.date,
          scheduledDepartureTime: journey.scheduledDepartureTime,
          scheduledArrivalTime: journey.scheduledArrivalTime,
          originStation: journey.originStation,
          destinationStation: journey.destinationStation,
          disruptionReason: journey.disruptionReason,
        },
        ticketEvidence: {
          ticketType: ticket.type,
          ticketCost: ticket.cost,
          validFrom: ticket.startDate,
          validUntil: ticket.endDate,
          ticketOriginStation: ticket.originStation,
          ticketDestinationStation: ticket.destinationStation,
          smartcardProvider: ticket.smartcardProvider,
          smartcardNumber: ticket.smartcardNumber,
        },
      },
      safety: {
        ...basePayload.safety,
        finalSubmitEnabled:
          boolEnv("ENABLE_GREATER_ANGLIA_CANCELLATION_SUBMISSION") &&
          boolEnv("GREATER_ANGLIA_CANCELLATION_FINAL_SUBMIT_ENABLED"),
        liveDispatchImplemented: false,
        eligibilityAndAmountMustBeConfirmedByOperator: true,
      },
    };
  }

  async submitCase({ claim, detectedDelay, submissionContext } = {}) {
    const mappedSubmission = this.buildCasePayload({
      claim,
      detectedDelay,
      submissionContext,
    });
    const integrationStatus =
      getGreaterAngliaCancellationIntegrationStatus();
    const finalSubmitEnabled = mappedSubmission.safety.finalSubmitEnabled;

    const reason = finalSubmitEnabled
      ? "Greater Anglia cancellation case mapping is ready, but a verified Customer Relations dispatch executor has not been implemented. Final submission remains blocked."
      : "Greater Anglia cancellation case mapping is ready. External Customer Relations submission remains safety locked until the form executor is verified.";

    return {
      submitted: false,
      blocked: true,
      ready: true,
      reason,
      source: "greater_anglia_cancellation_adapter_ready",
      operator: this.displayName,
      operatorKey: this.operatorKey,
      integrationStatus,
      submissionStatus: "cancellation_adapter_ready",
      submissionStrategy: this.submissionStrategy,
      finalSubmitEnabled,
      policyVersion: this.policyVersion,
      submissionChannel: "operator_customer_relations_form",
      customer_status: "cancellation_adapter_ready",
      customer_title: "Cancellation compensation case ready",
      customer_message:
        "Delai has prepared your cancelled-journey Season Ticket compensation case for Greater Anglia, but it has not been submitted.",
      customer_next_step:
        "Submit the prepared case through Greater Anglia Customer Relations within the applicable claim deadline. Delai's automatic final dispatch remains safety locked until the dedicated form executor is verified.",
      mappedSubmission,
    };
  }
}

export {
  GREATER_ANGLIA_CANCELLATION_POLICY,
  getGreaterAngliaCancellationIntegrationStatus,
};
export default GreaterAngliaCancellationAdapter;
