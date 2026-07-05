import BaseOperatorAdapter from "./baseOperatorAdapter.js";

class SimulatedOperatorAdapter extends BaseOperatorAdapter {
  async submitClaim({
    claim,
    detectedDelay,
    submissionContext,
  }) {
    if (!claim?.id) {
      throw new Error(
        "A claim ID is required for simulated operator submission."
      );
    }

    if (!submissionContext?.contextVersion) {
      throw new Error(
        "A valid universal submission context is required."
      );
    }

    const operator =
      submissionContext.operator?.displayName ||
      detectedDelay?.operator ||
      this.displayName ||
      "Test operator";

    const operatorReference = `TEST-${claim.id
      .replaceAll("-", "")
      .slice(0, 10)
      .toUpperCase()}`;

    return {
      submitted: true,
      blocked: false,
      operatorReference,
      submittedAt: new Date().toISOString(),
      source: "simulated_operator_adapter",
      operator,
      operatorKey:
        submissionContext.operator?.key ||
        this.operatorKey,
      contextVersion: submissionContext.contextVersion,
    };
  }
}

export default SimulatedOperatorAdapter;