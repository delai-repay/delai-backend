class BaseOperatorAdapter {
  constructor({ operatorKey, displayName } = {}) {
    this.operatorKey = operatorKey || "unknown_operator";
    this.displayName = displayName || "Unknown train operator";
  }

  buildSubmissionPayload({ claim, detectedDelay, submissionContext } = {}) {
    return {
      operator: {
        key: this.operatorKey,
        displayName: this.displayName,
      },
      claim: {
        id: claim?.id || submissionContext?.claim?.id || null,
        detectedDelayId:
          claim?.detected_delay_id ||
          submissionContext?.claim?.detectedDelayId ||
          detectedDelay?.id ||
          null,
        userId: claim?.user_id || submissionContext?.claim?.userId || null,
      },
      passenger: submissionContext?.passenger || {},
      journey: submissionContext?.journey || {},
      ticket: submissionContext?.ticket || {},
      commute: submissionContext?.commute || {},
      generatedAt: new Date().toISOString(),
      adapterVersion: "base-1.0",
    };
  }

  async submitClaim({ claim, detectedDelay, submissionContext } = {}) {
    return {
      submitted: false,
      blocked: true,
      reason: `No live train operator submission adapter is connected for ${this.displayName}.`,
      source: "operator_adapter_not_connected",
      operator: this.displayName,
      operatorKey: this.operatorKey,
      mappedSubmission: this.buildSubmissionPayload({
        claim,
        detectedDelay,
        submissionContext,
      }),
    };
  }

  async checkOutcome() {
    return {
      found: false,
      final: false,
      outcome: "still_waiting",
      blocked: true,
      reason: `No live outcome-checking adapter is connected for ${this.displayName}.`,
      source: "operator_adapter_not_connected",
      operator: this.displayName,
      operatorKey: this.operatorKey,
    };
  }

  async checkPayment() {
    return {
      found: false,
      paid: false,
      blocked: true,
      reason: `No live payment-checking adapter is connected for ${this.displayName}.`,
      source: "operator_adapter_not_connected",
      operator: this.displayName,
      operatorKey: this.operatorKey,
    };
  }
}

export default BaseOperatorAdapter;
