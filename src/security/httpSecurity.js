import { timingSafeEqual } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function constantTimeTextEqual(left, right) {
  const leftBuffer = Buffer.from(cleanText(left), "utf8");
  const rightBuffer = Buffer.from(cleanText(right), "utf8");

  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isUuid(value) {
  return UUID_PATTERN.test(cleanText(value));
}

function requireClaimId(req, res, next) {
  const claimId = req.body?.claim_id;

  if (!isUuid(claimId)) {
    return res.status(400).json({
      success: false,
      error: "claim_id must be a valid UUID.",
    });
  }

  return next();
}

function createRateLimiter({
  windowMs = 15 * 60 * 1000,
  max = 300,
  keyPrefix = "api",
  skip = null,
} = {}) {
  const buckets = new Map();
  let requestsSinceSweep = 0;

  return function rateLimit(req, res, next) {
    if (typeof skip === "function" && skip(req)) return next();

    const now = Date.now();
    const key = `${keyPrefix}:${req.ip || req.socket?.remoteAddress || "unknown"}`;
    const current = buckets.get(key);
    const bucket =
      current && current.resetAt > now
        ? current
        : { count: 0, resetAt: now + windowMs };

    bucket.count += 1;
    buckets.set(key, bucket);

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader(
      "RateLimit-Remaining",
      String(Math.max(0, max - bucket.count))
    );
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    requestsSinceSweep += 1;
    if (requestsSinceSweep >= 500) {
      requestsSinceSweep = 0;
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }

    if (bucket.count > max) {
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)))
      );
      return res.status(429).json({
        success: false,
        error: "Too many requests. Please try again later.",
      });
    }

    return next();
  };
}

function boundedText(value, { max = 1000, allowEmpty = true } = {}) {
  const text = cleanText(value);

  if ((!allowEmpty && !text) || text.length > max) {
    return null;
  }

  return text;
}

export {
  boundedText,
  cleanText,
  constantTimeTextEqual,
  createRateLimiter,
  isUuid,
  requireClaimId,
};
