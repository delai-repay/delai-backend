const GOCARDLESS_API_VERSION = "2015-07-06";

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function getGoCardlessConfiguration() {
  const environment =
    cleanText(process.env.GOCARDLESS_ENVIRONMENT).toLowerCase() === "live"
      ? "live"
      : "sandbox";
  const accessToken = cleanText(process.env.GOCARDLESS_ACCESS_TOKEN);

  return {
    environment,
    accessToken,
    configured: Boolean(accessToken),
    baseUrl:
      environment === "live"
        ? "https://api.gocardless.com"
        : "https://api-sandbox.gocardless.com",
  };
}

class GoCardlessApiError extends Error {
  constructor(message, { status = 500, payload = null } = {}) {
    super(message);
    this.name = "GoCardlessApiError";
    this.status = status;
    this.payload = payload;
    this.reason = payload?.error?.errors?.[0]?.reason || null;
    this.conflictingResourceId =
      payload?.error?.links?.conflicting_resource_id ||
      payload?.error?.errors?.[0]?.links?.conflicting_resource_id ||
      null;
  }
}

async function goCardlessRequest(
  path,
  { method = "GET", body = null, idempotencyKey = null } = {}
) {
  const config = getGoCardlessConfiguration();

  if (!config.configured) {
    throw new GoCardlessApiError(
      "GoCardless is not configured in this environment.",
      { status: 503 }
    );
  }

  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "GoCardless-Version": GOCARDLESS_API_VERSION,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new GoCardlessApiError(
      payload?.error?.message ||
        `GoCardless request failed with status ${response.status}.`,
      { status: response.status, payload }
    );
  }

  return payload;
}

async function createMandateBillingRequest({ idempotencyKey }) {
  try {
    const payload = await goCardlessRequest("/billing_requests", {
      method: "POST",
      idempotencyKey,
      body: {
        billing_requests: {
          mandate_request: {
            scheme: "bacs",
            description:
              "Delai variable 10% success fee after Delay Repay compensation",
          },
        },
      },
    });

    return payload.billing_requests;
  } catch (error) {
    if (error.conflictingResourceId) {
      return getBillingRequest(error.conflictingResourceId);
    }
    throw error;
  }
}

async function createMandateBillingRequestFlow({
  billingRequestId,
  redirectUri,
  exitUri,
  prefilledCustomer,
  idempotencyKey,
}) {
  try {
    const payload = await goCardlessRequest("/billing_request_flows", {
      method: "POST",
      idempotencyKey,
      body: {
        billing_request_flows: {
          redirect_uri: redirectUri,
          exit_uri: exitUri,
          language: "en",
          prefilled_customer: prefilledCustomer,
          links: {
            billing_request: billingRequestId,
          },
        },
      },
    });

    return payload.billing_request_flows;
  } catch (error) {
    if (error.conflictingResourceId) {
      return getBillingRequestFlow(error.conflictingResourceId);
    }
    throw error;
  }
}

async function createFeePayment({
  mandateId,
  amountPence,
  claimId,
  feeTransactionId,
  idempotencyKey,
}) {
  try {
    const payload = await goCardlessRequest("/payments", {
      method: "POST",
      idempotencyKey,
      body: {
        payments: {
          amount: amountPence,
          currency: "GBP",
          description: "Delai 10% success fee",
          retry_if_possible:
            cleanText(process.env.GOCARDLESS_RETRY_IF_POSSIBLE).toLowerCase() ===
            "true",
          metadata: {
            claim_id: claimId,
            fee_transaction_id: feeTransactionId,
          },
          links: {
            mandate: mandateId,
          },
        },
      },
    });

    return payload.payments;
  } catch (error) {
    if (error.conflictingResourceId) {
      return getPayment(error.conflictingResourceId);
    }
    throw error;
  }
}

async function getBillingRequest(id) {
  const payload = await goCardlessRequest(
    `/billing_requests/${encodeURIComponent(id)}`
  );
  return payload.billing_requests;
}

async function getBillingRequestFlow(id) {
  const payload = await goCardlessRequest(
    `/billing_request_flows/${encodeURIComponent(id)}`
  );
  return payload.billing_request_flows;
}

async function getMandate(id) {
  const payload = await goCardlessRequest(
    `/mandates/${encodeURIComponent(id)}`
  );
  return payload.mandates;
}

async function getPayment(id) {
  const payload = await goCardlessRequest(
    `/payments/${encodeURIComponent(id)}`
  );
  return payload.payments;
}

export {
  GoCardlessApiError,
  createFeePayment,
  createMandateBillingRequest,
  createMandateBillingRequestFlow,
  getBillingRequest,
  getBillingRequestFlow,
  getGoCardlessConfiguration,
  getMandate,
  getPayment,
};
