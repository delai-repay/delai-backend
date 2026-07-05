import BaseOperatorAdapter from "./baseOperatorAdapter.js";

class SimulatedOperatorAdapter extends BaseOperatorAdapter {
  async submitClaim({ claim, detectedDelay }) {
    if (!claim?.id) {
      throw new Error(
        "A claim ID is required for simulated operator submission."
      );
    }

    const operator =
      detectedDelay?.operator || this.displayName || "Test operator";

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
      operatorKey: this.operatorKey,
    };
  }
}

export default SimulatedOperatorAdapter;