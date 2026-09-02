import { createHash } from "node:crypto";
import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import {
  createFeePayment,
  createMandateBillingRequest,
  createMandateBillingRequestFlow,
  getBillingRequest,
  getGoCardlessConfiguration,
  getMandate,
  getPayment,
} from "./gocardlessClient.js";
import {
  buildPaymentProfileSummary,
  getPaymentProfileRecord,
  updatePaymentProfileProviderState,
} from "./paymentProfileService.js";
import {
  findOrAccrueClaimFee,
  getFeeLedgerSummary,
  getOpenFeeCollectionBatch,
  prepareFeeCollectionBatch,
} from "./feeLedgerService.js";
import {
  determineCollectionTrigger,
  getFeeCollectionPolicy,
} from "./feePolicy.js";

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function isTrueEnv(name) {
  return cleanText(process.env[name]).toLowerCase() === "true";
}

function stableKey(value, prefix = "delai") {
  return `${prefix}-${createHash("sha256")
    .update(String(value))
    .digest("hex")
    .slice(0, 40)}`;
}

function splitFullName(fullName) {
  const parts = cleanText(fullName).split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { given_name: "Delai", family_name: "Customer" };
  }

  if (parts.length === 1) {
    return { given_name: parts[0], family_name: "Customer" };
  }

  return {
    given_name: parts.slice(0, -1).join(" "),
    family_name: parts.at(-1),
  };
}

function getFrontendUrl() {
  return cleanText(process.env.FRONTEND_URL) || "http://localhost:5173";
}

function getCollectionSafety() {
  const provider = getGoCardlessConfiguration();
  const collectionEnabled = isTrueEnv("PAYMENTS_FEE_COLLECTION_ENABLED");
  const liveCollectionEnabled = isTrueEnv(
    "PAYMENTS_LIVE_COLLECTION_ENABLED"
  );

  return {
    provider,
    collectionEnabled,
    liveCollectionEnabled,
    allowed:
      collectionEnabled &&
      (provider.environment !== "live" || liveCollectionEnabled),
  };
}

async function loadUserIdentity(userId) {
  const [{ data: authData, error: authError }, { data: profile }] =
    await Promise.all([
      supabaseAdmin.auth.admin.getUserById(userId),
      supabaseAdmin
        .from("profiles")
        .select("*")
        .or(`id.eq.${userId},user_id.eq.${userId}`)
        .limit(1)
        .maybeSingle(),
    ]);

  if (authError) throw authError;

  const authUser = authData?.user;
  const fullName =
    profile?.full_name ||
    profile?.name ||
    authUser?.user_metadata?.full_name ||
    authUser?.user_metadata?.name ||
    "Delai Customer";

  return {
    fullName,
    email: profile?.email || authUser?.email || "",
    addressLine1: profile?.address_line_1 || profile?.address1 || "",
    addressLine2: profile?.address_line_2 || profile?.address2 || "",
    city: profile?.town_city || profile?.city || profile?.town || "",
    postalCode: profile?.postcode || profile?.postal_code || "",
  };
}

async function startDirectDebitSetup(userId) {
  const config = getGoCardlessConfiguration();

  if (!config.configured) {
    const error = new Error(
      "Direct Debit setup is not configured in this environment yet."
    );
    error.code = "payment_provider_not_configured";
    throw error;
  }

  const paymentProfile = await getPaymentProfileRecord(userId);

  if (
    !paymentProfile?.bank_account_name_encrypted ||
    !paymentProfile?.sort_code_encrypted ||
    !paymentProfile?.account_number_encrypted
  ) {
    const error = new Error(
      "Save the operator payout account before setting up Direct Debit."
    );
    error.code = "payout_account_required";
    throw error;
  }

  if (!paymentProfile.fee_terms_accepted_at) {
    const error = new Error(
      "Accept the 10% success-fee terms before setting up Direct Debit."
    );
    error.code = "fee_terms_required";
    throw error;
  }

  if (paymentProfile.gocardless_mandate_id) {
    const mandate = await getMandate(paymentProfile.gocardless_mandate_id);

    if (mandate?.status === "active") {
      await updatePaymentProfileProviderState(userId, {
        mandate_status: "active",
      });

      return {
        already_active: true,
        authorisation_url: null,
        payment_profile: buildPaymentProfileSummary({
          ...paymentProfile,
          mandate_status: "active",
        }),
      };
    }
  }

  let billingRequestId = paymentProfile.gocardless_billing_request_id;

  if (billingRequestId) {
    const existingRequest = await getBillingRequest(billingRequestId);
    if (["cancelled", "fulfilled"].includes(existingRequest?.status)) {
      billingRequestId = null;
    }
  }

  if (!billingRequestId) {
    const billingRequest = await createMandateBillingRequest({
      idempotencyKey: stableKey(
        `${userId}:${paymentProfile.bank_details_updated_at || "initial"}`,
        "dd-request"
      ),
    });
    billingRequestId = billingRequest.id;
  }

  const identity = await loadUserIdentity(userId);
  const name = splitFullName(identity.fullName);
  const frontendUrl = getFrontendUrl();
  const flowWindow = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const flow = await createMandateBillingRequestFlow({
    billingRequestId,
    redirectUri: `${frontendUrl}/?payment_setup=complete`,
    exitUri: `${frontendUrl}/?payment_setup=cancelled`,
    idempotencyKey: stableKey(
      `${billingRequestId}:${flowWindow}`,
      "dd-flow"
    ),
    prefilledCustomer: {
      ...name,
      email: identity.email,
      address_line1: identity.addressLine1 || undefined,
      address_line2: identity.addressLine2 || undefined,
      city: identity.city || undefined,
      postal_code: identity.postalCode || undefined,
      country_code: "GB",
    },
  });

  const updated = await updatePaymentProfileProviderState(userId, {
    gocardless_billing_request_id: billingRequestId,
    gocardless_billing_request_flow_id: flow.id,
    mandate_status: "pending_customer_authorisation",
  });

  return {
    already_active: false,
    authorisation_url: flow.authorisation_url,
    environment: config.environment,
    payment_profile: buildPaymentProfileSummary(updated),
  };
}

async function queueFeeCollectionJob({ userId, claimId, runAfter = null }) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("automation_jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("claim_id", claimId)
    .eq("job_type", "claim_collect_fee")
    .in("status", ["queued", "retry", "processing"])
    .limit(1);

  if (existingError) throw existingError;
  if (existing?.length) return 0;

  const { error: insertError } = await supabaseAdmin
    .from("automation_jobs")
    .insert({
      user_id: userId,
      claim_id: claimId,
      job_type: "claim_collect_fee",
      status: "queued",
      run_after: runAfter || new Date().toISOString(),
    });

  if (insertError?.code === "23505") return 0;
  if (insertError) throw insertError;
  return 1;
}

async function queueOutstandingFeeJobs(userId, runAfter = null) {
  const { data: claims, error } = await supabaseAdmin
    .from("claims")
    .select("id")
    .eq("user_id", userId)
    .eq("payment_status", "fee_due");

  if (error) throw error;
  if (!claims?.length) return 0;

  let queued = 0;
  const claimIds = claims.map((claim) => claim.id);
  const { data: entries, error: entryError } = await supabaseAdmin
    .from("fee_transactions")
    .select("claim_id, fee_amount_pence, fee_amount, accrued_at, status")
    .eq("user_id", userId)
    .in("claim_id", claimIds)
    .order("accrued_at", { ascending: true });

  if (entryError) throw entryError;

  const entriesByClaim = new Map(
    (entries || []).map((entry) => [entry.claim_id, entry])
  );
  const missingClaims = claims.filter((claim) => !entriesByClaim.has(claim.id));

  for (const claim of missingClaims) {
    queued += await queueFeeCollectionJob({
      userId,
      claimId: claim.id,
      runAfter,
    });
  }

  if (missingClaims.length) return queued;

  const openBatch = await getOpenFeeCollectionBatch(userId);
  const outstandingEntries = (entries || []).filter((entry) =>
    ["outstanding", "pending"].includes(entry.status)
  );
  const balancePence = outstandingEntries.reduce(
    (total, entry) =>
      total +
      Number(
        entry.fee_amount_pence ?? Math.round(Number(entry.fee_amount || 0) * 100)
      ),
    0
  );
  const trigger = determineCollectionTrigger({
    balancePence,
    oldestAccruedAt: outstandingEntries[0]?.accrued_at || null,
    policy: getFeeCollectionPolicy(),
  });
  const claimToQueue = openBatch
    ? claims[0]
    : trigger
      ? { id: outstandingEntries[0]?.claim_id }
      : null;

  if (claimToQueue?.id) {
    queued += await queueFeeCollectionJob({
      userId,
      claimId: claimToQueue.id,
      runAfter,
    });
  }

  return queued;
}

async function queueReadyFeeCollectionJobs({ limit = 50 } = {}) {
  const safety = getCollectionSafety();

  if (!safety.allowed) {
    return {
      skipped: true,
      reason: "fee_collection_safety_lock",
      queued_count: 0,
    };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const { data: profiles, error } = await supabaseAdmin
    .from("payment_profiles")
    .select("user_id")
    .eq("mandate_status", "active")
    .limit(safeLimit);

  if (error) throw error;

  const activeUserIds = (profiles || []).map((profile) => profile.user_id);
  if (!activeUserIds.length) {
    return { skipped: false, queued_count: 0 };
  }

  const { data: entries, error: entryError } = await supabaseAdmin
    .from("fee_transactions")
    .select("user_id, claim_id, fee_amount_pence, fee_amount, accrued_at")
    .in("user_id", activeUserIds)
    .in("status", ["outstanding", "pending"])
    .is("collection_batch_id", null)
    .order("accrued_at", { ascending: true })
    .limit(Math.min(safeLimit * 100, 5000));

  if (entryError) throw entryError;

  const byUser = new Map();
  for (const entry of entries || []) {
    const current = byUser.get(entry.user_id) || {
      balancePence: 0,
      oldestAccruedAt: entry.accrued_at,
      claimId: entry.claim_id,
    };
    current.balancePence += Number(
      entry.fee_amount_pence ?? Math.round(Number(entry.fee_amount || 0) * 100)
    );
    byUser.set(entry.user_id, current);
  }

  const policy = getFeeCollectionPolicy();
  let queuedCount = 0;
  for (const [userId, ledger] of byUser) {
    const trigger = determineCollectionTrigger({
      ...ledger,
      policy,
    });
    if (!trigger || !ledger.claimId) continue;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("automation_jobs")
      .select("id")
      .eq("user_id", userId)
      .eq("job_type", "claim_collect_fee")
      .in("status", ["queued", "retry", "processing"])
      .limit(1);

    if (existingError) throw existingError;
    if (existing?.length) continue;

    const { error: insertError } = await supabaseAdmin
      .from("automation_jobs")
      .insert({
        user_id: userId,
        claim_id: ledger.claimId,
        job_type: "claim_collect_fee",
        status: "queued",
        run_after: new Date().toISOString(),
      });

    if (insertError?.code === "23505") continue;
    if (insertError) throw insertError;
    queuedCount += 1;
  }

  return {
    skipped: false,
    queued_count: queuedCount,
  };
}

async function refreshDirectDebitStatus(userId) {
  const paymentProfile = await getPaymentProfileRecord(userId);

  if (!paymentProfile) return buildPaymentProfileSummary(null);

  const config = getGoCardlessConfiguration();

  if (!config.configured) return buildPaymentProfileSummary(paymentProfile);

  let mandateId = paymentProfile.gocardless_mandate_id;
  let requestStatus = null;

  if (paymentProfile.gocardless_billing_request_id) {
    const billingRequest = await getBillingRequest(
      paymentProfile.gocardless_billing_request_id
    );
    requestStatus = billingRequest?.status || null;
    mandateId =
      mandateId ||
      billingRequest?.links?.mandate_request_mandate ||
      billingRequest?.links?.mandate ||
      null;
  }

  let mandateStatus = paymentProfile.mandate_status || "not_started";

  if (mandateId) {
    const mandate = await getMandate(mandateId);
    mandateStatus = mandate?.status || mandateStatus;
  } else if (requestStatus === "cancelled") {
    mandateStatus = "cancelled";
  } else if (requestStatus === "fulfilled") {
    mandateStatus = "pending_submission";
  }

  const updated = await updatePaymentProfileProviderState(userId, {
    gocardless_mandate_id: mandateId || undefined,
    mandate_status: mandateStatus,
  });

  if (mandateStatus === "active") {
    await queueOutstandingFeeJobs(userId);
  }

  return buildPaymentProfileSummary(updated);
}

async function collectFeeForClaim(claim) {
  const transaction = await findOrAccrueClaimFee(claim);
  const alreadyCollected = ["confirmed", "paid_out"].includes(
    transaction.status
  );

  if (alreadyCollected) {
    return {
      success: true,
      message: "Delai success fee has already been collected.",
      transaction_id: transaction.id,
    };
  }

  const safety = getCollectionSafety();

  if (!safety.provider.configured) {
    return {
      success: true,
      blocked: true,
      code: "payment_provider_not_configured",
      message: "GoCardless fee collection is not configured yet.",
    };
  }

  if (!safety.allowed) {
    return {
      success: true,
      blocked: true,
      code: "fee_collection_safety_lock",
      message:
        "Fee collection is safety-locked. No Direct Debit payment was created.",
    };
  }

  const profile = await getPaymentProfileRecord(claim.user_id);

  if (!profile?.gocardless_mandate_id) {
    return {
      success: true,
      blocked: true,
      code: "direct_debit_mandate_required",
      message:
        "The customer must complete the Direct Debit mandate before the success fee can be collected.",
    };
  }

  const mandate = await getMandate(profile.gocardless_mandate_id);

  if (mandate?.status !== "active") {
    await updatePaymentProfileProviderState(claim.user_id, {
      mandate_status: mandate?.status || "unknown",
    });

    return {
      success: true,
      blocked: true,
      code: "direct_debit_mandate_not_active",
      message: `Direct Debit mandate is ${mandate?.status || "not active"}.`,
    };
  }

  let batch = await getOpenFeeCollectionBatch(claim.user_id);
  if (batch?.status === "failed" && !isTrueEnv("FEE_COLLECTION_AUTOMATIC_RETRY_ENABLED")) {
    return {
      success: true,
      blocked: true,
      code: "fee_retry_safety_lock",
      message:
        "The accumulated fee payment failed. Automatic retry is safety-locked.",
    };
  }

  if (batch && Number(batch.attempts || 0) >= 3) {
    return {
      success: true,
      blocked: true,
      code: "fee_retry_limit_reached",
      message: "The accumulated fee collection retry limit has been reached.",
    };
  }

  if (!batch) {
    batch = await prepareFeeCollectionBatch(claim.user_id);
  }

  if (!batch) {
    const ledger = await getFeeLedgerSummary(claim.user_id, { limit: 100 });
    return {
      success: true,
      blocked: false,
      deferred: true,
      code: "fee_balance_below_collection_threshold",
      message: `Delai's fee has been added to the customer's balance. Collection starts at £${ledger.collection_threshold.toFixed(2)}, or as an eligible annual residual.`,
      outstanding_pence: ledger.outstanding_pence,
      collection_threshold_pence: ledger.collection_threshold_pence,
      transaction_id: transaction.id,
    };
  }

  if (
    batch.provider_payment_id &&
    !["failed", "cancelled", "charged_back"].includes(batch.status)
  ) {
    const payment = await getPayment(batch.provider_payment_id);
    return {
      success: true,
      message: "Accumulated fee payment is already in progress.",
      provider_status: payment.status,
      batch_id: batch.id,
    };
  }

  const nextAttempt = Number(batch.attempts || 0) + 1;
  const idempotencyKey = stableKey(`${batch.id}:attempt:${nextAttempt}`, "fee-batch");
  const payment = await createFeePayment({
    mandateId: profile.gocardless_mandate_id,
    amountPence: batch.amount_pence,
    feeBatchId: batch.id,
    idempotencyKey,
  });
  const now = new Date().toISOString();

  const { error: batchError } = await supabaseAdmin
    .from("fee_collection_batches")
    .update({
      status: ["submitted", "confirmed", "paid_out"].includes(payment.status)
        ? payment.status
        : "pending_submission",
      provider_payment_id: payment.id,
      idempotency_key: idempotencyKey,
      attempts: nextAttempt,
      last_attempt_at: now,
      submitted_at: now,
      failure_code: null,
      failure_message: null,
      updated_at: now,
    })
    .eq("id", batch.id);

  if (batchError) throw batchError;

  const { data: batchEntries, error: entryError } = await supabaseAdmin
    .from("fee_transactions")
    .update({
      status: "submitted",
      attempts: nextAttempt,
      last_attempt_at: now,
      failure_code: null,
      failure_message: null,
      updated_at: now,
    })
    .eq("collection_batch_id", batch.id)
    .select("claim_id");

  if (entryError) throw entryError;

  const claimIds = (batchEntries || []).map((entry) => entry.claim_id);

  let claimError = null;
  if (claimIds.length) {
    const result = await supabaseAdmin
      .from("claims")
      .update({
        payment_status: "fee_due",
        fee_provider: "gocardless",
        fee_provider_payment_id: payment.id,
        fee_collection_error: null,
      })
      .eq("user_id", claim.user_id)
      .in("id", claimIds);
    claimError = result.error;
  }

  if (claimError) throw claimError;

  return {
    success: true,
    blocked: false,
    message: `Delai accumulated ${batch.entry_count} success fee(s) into one Direct Debit.`,
    provider_status: payment.status,
    batch_id: batch.id,
    amount_pence: batch.amount_pence,
    entry_count: batch.entry_count,
    trigger_reason: batch.trigger_reason,
  };
}

async function createPaymentNotification({ userId, claimId, type, title, message }) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("claim_id", claimId)
    .eq("type", type)
    .limit(1);

  if (existingError) throw existingError;
  if (existing?.length) return;

  const { error: insertError } = await supabaseAdmin.from("notifications").insert({
    user_id: userId,
    claim_id: claimId,
    type,
    title,
    message,
    read: false,
  });

  if (insertError) throw insertError;
}

function mapPaymentStatus(status) {
  if (["confirmed", "paid_out"].includes(status)) return "fee_collected";
  return "fee_due";
}

async function syncFeeBatchPayment(payment, batch) {
  if (batch.provider_payment_id && batch.provider_payment_id !== payment.id) {
    return {
      skipped: true,
      reason: "stale_batch_payment_attempt",
      current_payment_id: batch.provider_payment_id,
    };
  }

  const now = new Date().toISOString();
  const failedStatuses = new Set([
    "failed",
    "cancelled",
    "customer_approval_denied",
    "charged_back",
  ]);
  const failed = failedStatuses.has(payment.status);
  const collected = ["confirmed", "paid_out"].includes(payment.status);
  const batchStatus = collected
    ? payment.status
    : failed
      ? payment.status === "charged_back"
        ? "charged_back"
        : payment.status === "cancelled"
          ? "cancelled"
          : "failed"
      : ["submitted", "pending_submission"].includes(payment.status)
        ? payment.status
        : "pending_submission";

  const { error: batchError } = await supabaseAdmin
    .from("fee_collection_batches")
    .update({
      status: batchStatus,
      provider_payment_id: payment.id,
      failure_code: failed ? payment.status : null,
      failure_message: failed
        ? "GoCardless reported that the accumulated success-fee payment did not complete."
        : null,
      confirmed_at: collected ? now : null,
      updated_at: now,
    })
    .eq("id", batch.id);

  if (batchError) throw batchError;

  const { data: transactions, error: transactionError } = await supabaseAdmin
    .from("fee_transactions")
    .update({
      status: collected ? payment.status : failed ? "failed" : "submitted",
      failure_code: failed ? payment.status : null,
      failure_message: failed
        ? "GoCardless reported that the accumulated success-fee payment did not complete."
        : null,
      collected_at: collected ? now : null,
      updated_at: now,
    })
    .eq("collection_batch_id", batch.id)
    .select("id, user_id, claim_id, fee_amount, fee_amount_pence");

  if (transactionError) throw transactionError;

  const claimIds = (transactions || []).map((transaction) => transaction.claim_id);
  if (claimIds.length) {
    const { error: claimUpdateError } = await supabaseAdmin
      .from("claims")
      .update({
        payment_status: collected ? "fee_collected" : "fee_due",
        fee_collection_error: failed ? payment.status : null,
        fee_collected_at: collected ? now : null,
      })
      .eq("user_id", batch.user_id)
      .in("id", claimIds);

    if (claimUpdateError) throw claimUpdateError;
  }

  if (collected) {
    for (const transaction of transactions || []) {
      await createPaymentNotification({
        userId: transaction.user_id,
        claimId: transaction.claim_id,
        type: "claim_fee_collected",
        title: "Success fee collected",
        message: `Delai's £${Number(transaction.fee_amount).toFixed(
          2
        )} success fee was included in one accumulated Direct Debit.`,
      });
    }
  }

  if (failed) {
    for (const transaction of transactions || []) {
      await createPaymentNotification({
        userId: transaction.user_id,
        claimId: transaction.claim_id,
        type: "claim_fee_failed",
        title: "Success fee payment needs attention",
        message:
          "The Direct Debit for Delai's accumulated success fees did not complete. Your compensation remains in your own account.",
      });
    }

    if (
      isTrueEnv("FEE_COLLECTION_AUTOMATIC_RETRY_ENABLED") &&
      Number(batch.attempts || 0) < 3
    ) {
      const retryDate = new Date(
        Date.now() + 3 * 24 * 60 * 60 * 1000
      ).toISOString();
      await queueOutstandingFeeJobs(batch.user_id, retryDate);
    }
  }

  return {
    skipped: false,
    payment_status: payment.status,
    batch_id: batch.id,
    entry_count: transactions?.length || 0,
  };
}

async function syncPaymentResource(paymentId) {
  const payment = await getPayment(paymentId);
  const batchMetadataId = payment?.metadata?.fee_batch_id;

  const batchQuery = supabaseAdmin
    .from("fee_collection_batches")
    .select("*")
    .limit(1);
  const { data: batch, error: batchLookupError } = batchMetadataId
    ? await batchQuery.eq("id", batchMetadataId).maybeSingle()
    : await batchQuery.eq("provider_payment_id", paymentId).maybeSingle();

  if (batchLookupError) throw batchLookupError;
  if (batch) return syncFeeBatchPayment(payment, batch);

  const { data: transaction, error } = await supabaseAdmin
    .from("fee_transactions")
    .select("*")
    .or(
      `provider_payment_id.eq.${paymentId},id.eq.${payment?.metadata?.fee_transaction_id || "00000000-0000-0000-0000-000000000000"}`
    )
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!transaction) return { skipped: true, reason: "unknown_payment" };

  if (
    transaction.provider_payment_id &&
    transaction.provider_payment_id !== paymentId
  ) {
    return {
      skipped: true,
      reason: "stale_payment_attempt",
      current_payment_id: transaction.provider_payment_id,
    };
  }

  const claimPaymentStatus = mapPaymentStatus(payment.status);
  const now = new Date().toISOString();
  const failed = [
    "failed",
    "cancelled",
    "customer_approval_denied",
    "charged_back",
  ].includes(payment.status);
  const collected = claimPaymentStatus === "fee_collected";

  const { error: transactionUpdateError } = await supabaseAdmin
    .from("fee_transactions")
    .update({
      status: payment.status,
      provider_payment_id: payment.id,
      failure_code: failed ? payment.status : null,
      failure_message: failed
        ? "GoCardless reported that the success-fee payment did not complete."
        : null,
      collected_at: collected ? now : null,
      updated_at: now,
    })
    .eq("id", transaction.id);

  if (transactionUpdateError) throw transactionUpdateError;

  const { error: claimUpdateError } = await supabaseAdmin
    .from("claims")
    .update({
      payment_status: claimPaymentStatus,
      fee_collection_error: failed ? payment.status : null,
      fee_collected_at: collected ? now : null,
    })
    .eq("id", transaction.claim_id)
    .eq("user_id", transaction.user_id);

  if (claimUpdateError) throw claimUpdateError;

  if (collected) {
    await createPaymentNotification({
      userId: transaction.user_id,
      claimId: transaction.claim_id,
      type: "claim_fee_collected",
      title: "Success fee collected",
      message: `Delai's £${Number(transaction.fee_amount).toFixed(
        2
      )} success fee has been collected.`,
    });
  }

  if (failed) {
    await createPaymentNotification({
      userId: transaction.user_id,
      claimId: transaction.claim_id,
      type: "claim_fee_failed",
      title: "Success fee payment needs attention",
      message:
        "The Direct Debit for Delai's success fee did not complete. Your compensation remains in your own account.",
    });

    if (
      isTrueEnv("FEE_COLLECTION_AUTOMATIC_RETRY_ENABLED") &&
      Number(transaction.attempts || 0) < 3
    ) {
      const retryDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      await queueOutstandingFeeJobs(transaction.user_id, retryDate);
    }
  }

  return { skipped: false, payment_status: payment.status };
}

async function syncMandateResource(mandateId) {
  const mandate = await getMandate(mandateId);
  const { data: profile, error } = await supabaseAdmin
    .from("payment_profiles")
    .update({
      mandate_status: mandate.status,
      mandate_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("gocardless_mandate_id", mandateId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (profile?.user_id && mandate.status === "active") {
    await queueOutstandingFeeJobs(profile.user_id);
  }

  return { skipped: !profile, mandate_status: mandate.status };
}

async function syncBillingRequestResource(billingRequestId) {
  const request = await getBillingRequest(billingRequestId);
  const mandateId =
    request?.links?.mandate_request_mandate ||
    request?.links?.mandate ||
    null;
  const mandate = mandateId ? await getMandate(mandateId) : null;
  const { data: profile, error } = await supabaseAdmin
    .from("payment_profiles")
    .update({
      gocardless_mandate_id: mandateId,
      gocardless_customer_id: request?.links?.customer || null,
      mandate_status:
        mandate?.status ||
        (request?.status === "cancelled"
          ? "cancelled"
          : "pending_customer_authorisation"),
      mandate_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("gocardless_billing_request_id", billingRequestId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (profile?.user_id && mandate?.status === "active") {
    await queueOutstandingFeeJobs(profile.user_id);
  }

  return {
    skipped: !profile,
    billing_request_status: request?.status || null,
    mandate_status: mandate?.status || null,
  };
}

async function storeGoCardlessWebhookEvents(events = []) {
  if (!Array.isArray(events) || events.length === 0) return 0;

  const rows = events
    .filter((event) => event?.id)
    .map((event) => ({
      provider: "gocardless",
      provider_event_id: event.id,
      resource_type: event.resource_type || "unknown",
      action: event.action || "unknown",
      payload: event,
      status: "received",
      next_attempt_at: new Date().toISOString(),
    }));

  const { error } = await supabaseAdmin
    .from("payment_provider_events")
    .upsert(rows, {
      onConflict: "provider,provider_event_id",
      ignoreDuplicates: true,
    });

  if (error) throw error;
  return rows.length;
}

async function processPaymentProviderEvent(row) {
  const event = row.payload || {};
  const resourceType = event.resource_type || row.resource_type;

  if (resourceType === "payments" && event.links?.payment) {
    return syncPaymentResource(event.links.payment);
  }

  if (resourceType === "mandates" && event.links?.mandate) {
    return syncMandateResource(event.links.mandate);
  }

  if (resourceType === "billing_requests" && event.links?.billing_request) {
    return syncBillingRequestResource(event.links.billing_request);
  }

  return { skipped: true, reason: "unsupported_event_type" };
}

async function processPendingPaymentProviderEvents({ limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const workerId = `${process.env.RENDER_INSTANCE_ID || "local"}:${process.pid}`;
  const { data: events, error } = await supabaseAdmin.rpc(
    "lease_payment_provider_events",
    {
      p_limit: safeLimit,
      p_worker_id: workerId,
      p_lease_seconds: Number(process.env.AUTOMATION_JOB_LEASE_SECONDS || 300),
    }
  );

  if (error) throw error;

  const results = [];

  for (const event of events || []) {
    try {
      const result = await processPaymentProviderEvent(event);

      await supabaseAdmin
        .from("payment_provider_events")
        .update({
          status: "processed",
          processed_at: new Date().toISOString(),
          last_error: null,
          locked_at: null,
          locked_by: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", event.id);

      results.push({ event_id: event.provider_event_id, success: true, result });
    } catch (eventError) {
      const attempts = Number(event.attempts || 0);
      const retry = attempts < 5;

      await supabaseAdmin
        .from("payment_provider_events")
        .update({
          status: retry ? "retry" : "failed",
          attempts,
          last_error: eventError.message,
          next_attempt_at: new Date(
            Date.now() + Math.min(attempts * 15, 60) * 60 * 1000
          ).toISOString(),
          locked_at: null,
          locked_by: null,
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", event.id);

      results.push({
        event_id: event.provider_event_id,
        success: false,
        error: eventError.message,
      });
    }
  }

  return { processed_count: events?.length || 0, results };
}

export {
  collectFeeForClaim,
  getCollectionSafety,
  processPendingPaymentProviderEvents,
  queueReadyFeeCollectionJobs,
  refreshDirectDebitStatus,
  startDirectDebitSetup,
  storeGoCardlessWebhookEvents,
};
