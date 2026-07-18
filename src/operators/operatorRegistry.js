import BaseOperatorAdapter from "./baseOperatorAdapter.js";
import SimulatedOperatorAdapter from "./simulatedOperatorAdapter.js";
import GreaterAngliaOperatorAdapter from "./greaterAngliaOperatorAdapter.js";
import { getAllOperators } from "./operatorCatalog.js";
import {
  getGreaterAngliaIntegrationStatus,
  isGreaterAngliaFinalSubmitEnabled,
  isGreaterAngliaPlaywrightExecutorEnabled,
} from "./greaterAngliaDelayRepayPortal.js";

function normaliseOperatorName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getCatalogOperators() {
  try {
    const operators = getAllOperators();
    return Array.isArray(operators) ? operators : [];
  } catch (error) {
    console.error("Operator catalogue lookup failed:", error);
    return [];
  }
}

function buildOperatorLookup() {
  const lookup = new Map();

  for (const operator of getCatalogOperators()) {
    const key = operator.key || normaliseOperatorName(operator.displayName);
    const displayName = operator.displayName || operator.display_name || key;
    const aliases = Array.isArray(operator.aliases) ? operator.aliases : [];

    const values = [key, displayName, operator.display_name, ...aliases];

    for (const value of values) {
      const normalisedValue = normaliseOperatorName(value);

      if (normalisedValue) {
        lookup.set(normalisedValue, {
          operatorKey: key,
          displayName,
          aliases,
          knownOperator: true,
        });
      }
    }
  }

  return lookup;
}

const OPERATOR_ADAPTERS = new Map([
  ["greater_anglia", GreaterAngliaOperatorAdapter],
]);

function resolveOperatorIdentity(operatorName) {
  const normalisedOperator = normaliseOperatorName(operatorName);
  const lookup = buildOperatorLookup();

  if (lookup.has(normalisedOperator)) {
    return lookup.get(normalisedOperator);
  }

  if (normalisedOperator === "greater_anglia") {
    return {
      operatorKey: "greater_anglia",
      displayName: "Greater Anglia",
      aliases: ["Greater Anglia", "GA", "Abellio Greater Anglia"],
      knownOperator: true,
    };
  }

  return {
    operatorKey: normalisedOperator || "unknown_operator",
    displayName: operatorName || "Unknown train operator",
    aliases: [],
    knownOperator: false,
  };
}

function getOperatorIntegrationStatus(operatorName) {
  const identity = resolveOperatorIdentity(operatorName);
  const AdapterClass = OPERATOR_ADAPTERS.get(identity.operatorKey);
  const isGreaterAnglia = identity.operatorKey === "greater_anglia";

  let integrationStatus = "pending_operator_adapter";

  if (AdapterClass) {
    integrationStatus = isGreaterAnglia
      ? getGreaterAngliaIntegrationStatus()
      : "operator_adapter_registered";
  }

  return {
    operatorKey: identity.operatorKey,
    displayName: identity.displayName,
    knownOperator: identity.knownOperator,
    adapterRegistered: Boolean(AdapterClass),
    integrationStatus,
    playwrightExecutorEnabled:
      isGreaterAnglia && isGreaterAngliaPlaywrightExecutorEnabled(),
    finalSubmitEnabled:
      isGreaterAnglia && isGreaterAngliaFinalSubmitEnabled(),
    liveSubmissionEnabled:
      isGreaterAnglia && isGreaterAngliaFinalSubmitEnabled(),
  };
}

function getOperatorAdapter({ operator, allowSimulation = false } = {}) {
  const identity = resolveOperatorIdentity(operator);

  if (allowSimulation) {
    return new SimulatedOperatorAdapter({
      operatorKey: identity.operatorKey,
      displayName: identity.displayName,
    });
  }

  const AdapterClass = OPERATOR_ADAPTERS.get(identity.operatorKey);

  if (AdapterClass) {
    return new AdapterClass();
  }

  return new BaseOperatorAdapter({
    operatorKey: identity.operatorKey,
    displayName: identity.displayName,
  });
}

export {
  getOperatorAdapter,
  getOperatorIntegrationStatus,
  normaliseOperatorName,
  resolveOperatorIdentity,
};
