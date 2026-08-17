import BaseCancellationAdapter from "./baseCancellationAdapter.js";
import GreaterAngliaCancellationAdapter, {
  getGreaterAngliaCancellationIntegrationStatus,
} from "./greaterAngliaCancellationAdapter.js";

function normaliseKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveCancellationOperator(operatorName) {
  const key = normaliseKey(operatorName);

  if (["greater_anglia", "ga", "abellio_greater_anglia"].includes(key)) {
    return {
      operatorKey: "greater_anglia",
      displayName: "Greater Anglia",
    };
  }

  return {
    operatorKey: key || "unknown_operator",
    displayName: operatorName || "Unknown train operator",
  };
}

function getCancellationAdapter({ operator, compensationRoute } = {}) {
  const identity = resolveCancellationOperator(operator);

  if (
    compensationRoute === "season_ticket_cancelled_journey" &&
    identity.operatorKey === "greater_anglia"
  ) {
    return new GreaterAngliaCancellationAdapter();
  }

  return new BaseCancellationAdapter({
    ...identity,
    compensationRoute,
  });
}

function getCancellationIntegrationStatus({ operator, compensationRoute } = {}) {
  const identity = resolveCancellationOperator(operator);
  const registered =
    compensationRoute === "season_ticket_cancelled_journey" &&
    identity.operatorKey === "greater_anglia";

  return {
    operatorKey: identity.operatorKey,
    displayName: identity.displayName,
    compensationRoute: compensationRoute || null,
    adapterRegistered: registered,
    integrationStatus: registered
      ? getGreaterAngliaCancellationIntegrationStatus()
      : "cancellation_adapter_pending",
  };
}

export {
  getCancellationAdapter,
  getCancellationIntegrationStatus,
  resolveCancellationOperator,
};
