import { supabaseAdmin } from "../lib/supabaseAdmin.js";
import {
  decryptPaymentValue,
  encryptPaymentValue,
  maskAccountNumberLast4,
  maskSortCodeLast2,
  normaliseAccountNumber,
  normaliseSortCode,
} from "./paymentCrypto.js";

const FEE_TERMS_VERSION = "delai-success-fee-2026-08-v1";

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function validatePayoutBankDetails(input = {}) {
  const accountHolderName = cleanText(
    input.account_holder_name || input.accountHolderName
  );
  const sortCode = normaliseSortCode(input.sort_code || input.sortCode);
  const accountNumber = normaliseAccountNumber(
    input.account_number || input.accountNumber
  );
  const acceptFeeTerms =
    input.accept_fee_terms === true || input.acceptFeeTerms === true;
  const errors = [];

  if (accountHolderName.length < 2 || accountHolderName.length > 120) {
    errors.push("Enter the account holder name exactly as shown by the bank.");
  }

  if (!/^\d{6}$/.test(sortCode)) {
    errors.push("Sort code must contain exactly 6 digits.");
  }

  if (!/^\d{8}$/.test(accountNumber)) {
    errors.push("Account number must contain exactly 8 digits.");
  }

  if (!acceptFeeTerms) {
    errors.push(
      "You must agree to Delai collecting its 10% success fee after compensation is paid."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    values: {
      accountHolderName,
      sortCode,
      accountNumber,
      acceptFeeTerms,
    },
  };
}

function buildPaymentProfileSummary(profile) {
  if (!profile) {
    return {
      configured: false,
      payout_account: {
        configured: false,
        method: "BACS",
        account_holder_name_present: false,
        masked_sort_code: null,
        masked_account_number: null,
        updated_at: null,
      },
      fee_terms: {
        accepted: false,
        version: FEE_TERMS_VERSION,
        accepted_at: null,
      },
      direct_debit: {
        provider: "gocardless",
        status: "not_started",
        ready: false,
        updated_at: null,
      },
    };
  }

  const payoutConfigured = Boolean(
    profile.bank_account_name_encrypted &&
      profile.sort_code_encrypted &&
      profile.account_number_encrypted
  );
  const mandateStatus = profile.mandate_status || "not_started";

  return {
    configured: payoutConfigured,
    payout_account: {
      configured: payoutConfigured,
      method: profile.payout_method || "BACS",
      account_holder_name_present: Boolean(
        profile.bank_account_name_encrypted
      ),
      masked_sort_code: maskSortCodeLast2(profile.sort_code_last2),
      masked_account_number: maskAccountNumberLast4(
        profile.account_number_last4
      ),
      updated_at: profile.bank_details_updated_at || null,
    },
    fee_terms: {
      accepted: Boolean(profile.fee_terms_accepted_at),
      version: profile.fee_terms_version || FEE_TERMS_VERSION,
      accepted_at: profile.fee_terms_accepted_at || null,
    },
    direct_debit: {
      provider: profile.direct_debit_provider || "gocardless",
      status: mandateStatus,
      ready: mandateStatus === "active",
      updated_at: profile.mandate_updated_at || null,
    },
  };
}

async function getPaymentProfileRecord(userId) {
  const { data, error } = await supabaseAdmin
    .from("payment_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getPaymentProfileSummary(userId) {
  return buildPaymentProfileSummary(await getPaymentProfileRecord(userId));
}

async function savePayoutBankDetails(userId, input) {
  const validation = validatePayoutBankDetails(input);

  if (!validation.valid) {
    const error = new Error(validation.errors[0]);
    error.code = "invalid_payment_profile";
    error.validationErrors = validation.errors;
    throw error;
  }

  const { accountHolderName, sortCode, accountNumber } = validation.values;
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("payment_profiles")
    .upsert(
      {
        user_id: userId,
        payout_method: "BACS",
        bank_account_name_encrypted: encryptPaymentValue(accountHolderName),
        sort_code_encrypted: encryptPaymentValue(sortCode),
        account_number_encrypted: encryptPaymentValue(accountNumber),
        sort_code_last2: sortCode.slice(-2),
        account_number_last4: accountNumber.slice(-4),
        bank_details_updated_at: now,
        fee_terms_version: FEE_TERMS_VERSION,
        fee_terms_accepted_at: now,
        direct_debit_provider: "gocardless",
        updated_at: now,
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return buildPaymentProfileSummary(data);
}

async function loadPaymentDetailsForOperator(userId) {
  const profile = await getPaymentProfileRecord(userId);

  if (!profile) return null;

  const accountHolderName = decryptPaymentValue(
    profile.bank_account_name_encrypted
  );
  const sortCode = decryptPaymentValue(profile.sort_code_encrypted);
  const accountNumber = decryptPaymentValue(profile.account_number_encrypted);

  if (!accountHolderName || !sortCode || !accountNumber) return null;

  return {
    preferredPaymentMethod: profile.payout_method || "BACS",
    bankAccountName: accountHolderName,
    accountHolderName,
    sortCode,
    accountNumber,
  };
}

async function updatePaymentProfileProviderState(userId, updates = {}) {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("payment_profiles")
    .upsert(
      {
        user_id: userId,
        direct_debit_provider: "gocardless",
        ...updates,
        mandate_updated_at: updates.mandate_status ? now : undefined,
        updated_at: now,
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export {
  FEE_TERMS_VERSION,
  buildPaymentProfileSummary,
  getPaymentProfileRecord,
  getPaymentProfileSummary,
  loadPaymentDetailsForOperator,
  savePayoutBankDetails,
  updatePaymentProfileProviderState,
  validatePayoutBankDetails,
};
