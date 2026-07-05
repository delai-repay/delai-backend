class BaseOperatorAdapter {
  constructor({ operatorKey, displayName } = {}) {
    this.operatorKey = operatorKey || "unknown_operator";
    this.displayName = displayName || "Unknown train operator";
  }

  async submitClaim() {
    return {
      submitted: false,
      blocked: true,
      reason: `No live train operator submission adapter is connected for ${this.displayName}.`,
      source: "operator_adapter_not_connected",
      operator: this.displayName,
      operatorKey: this.operatorKey,
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