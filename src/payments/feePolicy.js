const DEFAULT_COLLECTION_THRESHOLD_PENCE = 500;
const DEFAULT_ANNUAL_RESIDUAL_DAYS = 365;
const DEFAULT_MIN_ANNUAL_COLLECTION_PENCE = 100;
const FEE_RATE_PERCENTAGE = 10;

function safePositiveInteger(value, fallback, max = 1000000) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function getFeeCollectionPolicy() {
  return {
    feeRatePercentage: FEE_RATE_PERCENTAGE,
    thresholdPence: safePositiveInteger(
      process.env.PAYMENTS_FEE_COLLECTION_THRESHOLD_PENCE,
      DEFAULT_COLLECTION_THRESHOLD_PENCE
    ),
    annualResidualDays: safePositiveInteger(
      process.env.PAYMENTS_ANNUAL_RESIDUAL_DAYS,
      DEFAULT_ANNUAL_RESIDUAL_DAYS,
      3660
    ),
    minimumAnnualCollectionPence: safePositiveInteger(
      process.env.PAYMENTS_MIN_ANNUAL_COLLECTION_PENCE,
      DEFAULT_MIN_ANNUAL_COLLECTION_PENCE
    ),
  };
}

function poundsToPence(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Fee amount must be greater than zero.");
  }
  return Math.round(amount * 100);
}

function penceToPounds(value) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function determineCollectionTrigger({
  balancePence,
  oldestAccruedAt,
  now = new Date(),
  policy = getFeeCollectionPolicy(),
} = {}) {
  const balance = Number(balancePence || 0);

  if (balance >= policy.thresholdPence) return "threshold";
  if (balance < policy.minimumAnnualCollectionPence || !oldestAccruedAt) {
    return null;
  }

  const oldest = new Date(oldestAccruedAt);
  if (Number.isNaN(oldest.getTime())) return null;

  const ageMs = now.getTime() - oldest.getTime();
  const annualMs = policy.annualResidualDays * 24 * 60 * 60 * 1000;
  return ageMs >= annualMs ? "annual_residual" : null;
}

export {
  FEE_RATE_PERCENTAGE,
  determineCollectionTrigger,
  getFeeCollectionPolicy,
  penceToPounds,
  poundsToPence,
};
