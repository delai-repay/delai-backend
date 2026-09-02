import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import {
  FEE_RATE_PERCENTAGE,
  getFeeCollectionPolicy,
  penceToPounds,
  poundsToPence,
} from "./feePolicy.js";

async function findOrAccrueClaimFee(claim) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("fee_transactions")
    .select("*")
    .eq("claim_id", claim.id)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  const compensationAmountPence = poundsToPence(claim.compensation_amount);
  const feeAmountPence = Math.round(
    compensationAmountPence * (FEE_RATE_PERCENTAGE / 100)
  );
  if (feeAmountPence <= 0) {
    throw new Error("Calculated success fee must be at least one penny.");
  }
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("fee_transactions")
    .insert({
      user_id: claim.user_id,
      claim_id: claim.id,
      compensation_amount: claim.compensation_amount,
      fee_percentage: FEE_RATE_PERCENTAGE,
      fee_amount: penceToPounds(feeAmountPence),
      fee_amount_pence: feeAmountPence,
      currency: "GBP",
      status: "outstanding",
      provider: "gocardless",
      attempts: 0,
      accrued_at: claim.payment_recorded_at || now,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: racedEntry, error: racedError } = await supabaseAdmin
        .from("fee_transactions")
        .select("*")
        .eq("claim_id", claim.id)
        .single();
      if (racedError) throw racedError;
      return racedEntry;
    }
    throw error;
  }

  return data;
}

async function prepareFeeCollectionBatch(userId, { forceReason = null } = {}) {
  const policy = getFeeCollectionPolicy();
  const { data, error } = await supabaseAdmin.rpc(
    "prepare_fee_collection_batch",
    {
      p_user_id: userId,
      p_threshold_pence: policy.thresholdPence,
      p_annual_residual_days: policy.annualResidualDays,
      p_minimum_annual_pence: policy.minimumAnnualCollectionPence,
      p_force_reason: forceReason,
    }
  );

  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function getOpenFeeCollectionBatch(userId) {
  const { data, error } = await supabaseAdmin
    .from("fee_collection_batches")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["scheduled", "pending_submission", "submitted", "failed"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getFeeLedgerSummary(userId, { limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const [
    { data: entries, error: entryError },
    { data: batches, error: batchError },
    { data: totalRows, error: totalError },
  ] =
    await Promise.all([
      supabaseAdmin
        .from("fee_transactions")
        .select(
          "id, claim_id, fee_amount_pence, fee_amount, fee_percentage, currency, status, collection_batch_id, accrued_at, collected_at, created_at"
        )
        .eq("user_id", userId)
        .order("accrued_at", { ascending: false })
        .limit(safeLimit),
      supabaseAdmin
        .from("fee_collection_batches")
        .select(
          "id, amount_pence, entry_count, currency, trigger_reason, status, provider, submitted_at, confirmed_at, created_at"
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin.rpc("get_fee_ledger_totals", { p_user_id: userId }),
    ]);

  if (entryError) throw entryError;
  if (batchError) throw batchError;
  if (totalError) throw totalError;

  const totals = Array.isArray(totalRows) ? totalRows[0] || {} : totalRows || {};
  const outstandingPence = Number(totals.outstanding_pence || 0);
  const inCollectionPence = Number(totals.in_collection_pence || 0);
  const collectedPence = Number(totals.collected_pence || 0);
  const policy = getFeeCollectionPolicy();

  return {
    currency: "GBP",
    fee_rate_percentage: policy.feeRatePercentage,
    collection_threshold_pence: policy.thresholdPence,
    collection_threshold: penceToPounds(policy.thresholdPence),
    annual_residual_days: policy.annualResidualDays,
    outstanding_pence: outstandingPence,
    outstanding: penceToPounds(outstandingPence),
    in_collection_pence: inCollectionPence,
    in_collection: penceToPounds(inCollectionPence),
    collected_pence: collectedPence,
    collected: penceToPounds(collectedPence),
    entries: entries || [],
    collection_batches: batches || [],
  };
}

export {
  findOrAccrueClaimFee,
  getFeeLedgerSummary,
  getOpenFeeCollectionBatch,
  prepareFeeCollectionBatch,
};
