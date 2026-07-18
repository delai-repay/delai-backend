import BaseOperatorAdapter from "./baseOperatorAdapter.js";

function normaliseReferencePart(value) {
  return String(value || "sim")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

class SimulatedOperatorAdapter extends BaseOperatorAdapter {
  constructor({ operatorKey, displayName } = {}) {
    super({
      operatorKey: operatorKey || "simulated_operator",
      displayName: displayName || "Simulated train operator",
    });
  }

  async submitClaim({ claim, detectedDelay, submissionContext } = {}) {
    const submittedAt = new Date().toISOString();
    const referenceOperator = normaliseReferencePart(
      submissionContext?.operator?.key || this.operatorKey
    );
    const referenceClaim = normaliseReferencePart(
      claim?.id || submissionContext?.claim?.id || detectedDelay?.id || Date.now()
    );

    return {
      submitted: true,
      blocked: false,
      operatorReference: `SIM-${referenceOperator}-${referenceClaim}`,
      submittedAt,
      source: "simulated_operator_adapter",
      operator: this.displayName,
      operatorKey: this.operatorKey,
      mappedSubmission: this.buildSubmissionPayload({
        claim,
        detectedDelay,
        submissionContext,
      }),
    };
  }
}

export default SimulatedOperatorAdapter;
