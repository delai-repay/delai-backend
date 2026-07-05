import BaseOperatorAdapter from "./baseOperatorAdapter.js";
import SimulatedOperatorAdapter from "./simulatedOperatorAdapter.js";

const registeredOperatorAdapters = new Map();

function normaliseOperatorName(operatorName) {
  return String(operatorName || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function registerOperatorAdapter({ names, createAdapter }) {
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error(
      "registerOperatorAdapter requires at least one operator name."
    );
  }

  if (typeof createAdapter !== "function") {
    throw new Error(
      "registerOperatorAdapter requires a createAdapter function."
    );
  }

  for (const name of names) {
    const operatorKey = normaliseOperatorName(name);

    if (!operatorKey) {
      continue;
    }

    registeredOperatorAdapters.set(operatorKey, createAdapter);
  }
}

function getOperatorAdapter({ operator, allowSimulation = false } = {}) {
  const displayName =
    String(operator || "").trim() || "Unknown train operator";

  const operatorKey =
    normaliseOperatorName(displayName) || "unknown_operator";

  if (allowSimulation) {
    return new SimulatedOperatorAdapter({
      operatorKey,
      displayName,
    });
  }

  const createAdapter = registeredOperatorAdapters.get(operatorKey);

  if (createAdapter) {
    return createAdapter({
      operatorKey,
      displayName,
    });
  }

  return new BaseOperatorAdapter({
    operatorKey,
    displayName,
  });
}

function getRegisteredOperatorKeys() {
  return Array.from(registeredOperatorAdapters.keys());
}

export {
  getOperatorAdapter,
  getRegisteredOperatorKeys,
  normaliseOperatorName,
  registerOperatorAdapter,
};