import BaseOperatorAdapter from "./baseOperatorAdapter.js";
import SimulatedOperatorAdapter from "./simulatedOperatorAdapter.js";
import {
  getOperatorByKey,
  normaliseOperatorName,
  resolveOperator,
} from "./operatorCatalog.js";

const registeredOperatorAdapters = new Map();

function resolveOperatorIdentity(operatorName) {
  const suppliedName = String(operatorName || "").trim();
  const catalogOperator = resolveOperator(suppliedName);

  if (catalogOperator) {
    return {
      operatorKey: catalogOperator.key,
      displayName: catalogOperator.displayName,
      knownOperator: true,
    };
  }

  return {
    operatorKey:
      normaliseOperatorName(suppliedName) || "unknown_operator",
    displayName: suppliedName || "Unknown train operator",
    knownOperator: false,
  };
}

function registerOperatorAdapter({
  operatorKey,
  names = [],
  createAdapter,
}) {
  if (typeof createAdapter !== "function") {
    throw new Error(
      "registerOperatorAdapter requires a createAdapter function."
    );
  }

  const catalogOperator = operatorKey
    ? getOperatorByKey(operatorKey)
    : names
        .map((name) => resolveOperator(name))
        .find(Boolean);

  const registryKey =
    catalogOperator?.key ||
    normaliseOperatorName(operatorKey || names[0]);

  if (!registryKey) {
    throw new Error(
      "registerOperatorAdapter requires a valid operator key or name."
    );
  }

  registeredOperatorAdapters.set(registryKey, createAdapter);

  return registryKey;
}

function getOperatorAdapter({
  operator,
  allowSimulation = false,
} = {}) {
  const identity = resolveOperatorIdentity(operator);

  if (allowSimulation) {
    return new SimulatedOperatorAdapter({
      operatorKey: identity.operatorKey,
      displayName: identity.displayName,
    });
  }

  const createAdapter = registeredOperatorAdapters.get(
    identity.operatorKey
  );

  if (createAdapter) {
    return createAdapter({
      operatorKey: identity.operatorKey,
      displayName: identity.displayName,
    });
  }

  return new BaseOperatorAdapter({
    operatorKey: identity.operatorKey,
    displayName: identity.displayName,
  });
}

function getOperatorIntegrationStatus(operatorName) {
  const identity = resolveOperatorIdentity(operatorName);

  const adapterRegistered = registeredOperatorAdapters.has(
    identity.operatorKey
  );

  return {
    operatorKey: identity.operatorKey,
    displayName: identity.displayName,
    knownOperator: identity.knownOperator,
    adapterRegistered,
    integrationStatus: adapterRegistered
      ? "connected"
      : "awaiting_integration",
  };
}

function getRegisteredOperatorKeys() {
  return Array.from(registeredOperatorAdapters.keys());
}

export {
  getOperatorAdapter,
  getOperatorIntegrationStatus,
  getRegisteredOperatorKeys,
  registerOperatorAdapter,
  resolveOperatorIdentity,
};