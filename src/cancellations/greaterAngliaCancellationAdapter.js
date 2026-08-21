import BaseCancellationAdapter from "./baseCancellationAdapter.js";
import {
  EXECUTOR_VERSION,
  runGreaterAngliaCancellationDraft,
} from "./greaterAngliaCancellationPlaywrightExecutor.js";

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
  if (!boolEnv("GREATER_ANGLIA_CANCELLATION_PLAYWRIGHT_ENABLED")) {
    return "cancellation_adapter_ready_safety_locked";
  }

  return "cancellation_playwright_ready_safety_locked";
}

class GreaterAngliaCancellationAdapter extends BaseCancellationAdapter {
  constructor({ draftExecutor = runGreaterAngliaCancellationDraft } = {}) {
    super({
      operatorKey: "greater_anglia",
      displayName: "Greater Anglia",
      compensationRoute: "season_ticket_cancelled_journey",
    });

    this.adapterVersion = "greater-anglia-cancellation-1.1-step20d";
    this.submissionStrategy =
      "greater_anglia_customer_relations_playwright_draft";
    this.policyVersion = GREATER_ANGLIA_CANCELLATION_POLICY.policyVersion;
    this.executorVersion = EXECUTOR_VERSION;
    this.draftExecutor = draftExecutor;
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
        draftExecutorImplemented: true,
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
        finalSubmitEnabled: false,
        liveDispatchImplemented: false,
        finalSubmitHardLocked: true,
        bankDetailsIncluded: false,
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
    const executorEnabled = boolEnv(
      "GREATER_ANGLIA_CANCELLATION_PLAYWRIGHT_ENABLED"
    );

    if (executorEnabled) {
      const executorResult = await this.draftExecutor({ mappedSubmission });

      return {
        ...executorResult,
        submitted: false,
        blocked: true,
        operator: this.displayName,
        operatorKey: this.operatorKey,
        integrationStatus:
          executorResult.integrationStatus || integrationStatus,
        submissionStatus:
          executorResult.submissionStatus ||
          (executorResult.ready
            ? "cancellation_form_draft_ready"
            : "cancellation_executor_blocked"),
        submissionStrategy: this.submissionStrategy,
        finalSubmitEnabled: false,
        policyVersion: this.policyVersion,
        submissionChannel: "operator_customer_relations_form",
        executorVersion:
          executorResult.executorVersion || this.executorVersion,
        mappedSubmission,
      };
    }

    return {
      submitted: false,
      blocked: true,
      ready: true,
      reason:
        "Greater Anglia cancellation mapping and the protected form-draft executor are ready. The browser executor is disabled until a controlled dry run is authorised.",
      source: "greater_anglia_cancellation_draft_executor_disabled",
      operator: this.displayName,
      operatorKey: this.operatorKey,
      integrationStatus,
      submissionStatus: "cancellation_adapter_ready",
      submissionStrategy: this.submissionStrategy,
      finalSubmitEnabled: false,
      policyVersion: this.policyVersion,
      submissionChannel: "operator_customer_relations_form",
      executorVersion: this.executorVersion,
      customer_status: "cancellation_adapter_ready",
      customer_title: "Cancellation compensation case ready",
      customer_message:
        "Delai has prepared your cancelled-journey Season Ticket compensation case for Greater Anglia, but it has not been submitted.",
      customer_next_step:
        "Submit the prepared case through Greater Anglia Customer Relations within the applicable claim deadline. Delai's protected browser draft remains disabled until a controlled test is authorised.",
      mappedSubmission,
    };
  }
}

export {
  GREATER_ANGLIA_CANCELLATION_POLICY,
  GreaterAngliaCancellationAdapter,
  getGreaterAngliaCancellationIntegrationStatus,
};
export default GreaterAngliaCancellationAdapter;
