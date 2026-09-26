import { createHmac, randomBytes } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;

function cleanSecret(value) {
  return String(value || "").trim();
}

export function getConfirmationTokenTtlHours(env = process.env) {
  const parsed = Number.parseInt(env.DELAI_CONFIRMATION_TOKEN_TTL_HOURS || "48", 10);
  if (!Number.isFinite(parsed)) return 48;
  return Math.min(Math.max(parsed, 1), 168);
}

export function confirmationTokenConfig(env = process.env) {
  const secret = cleanSecret(env.DELAI_CONFIRMATION_TOKEN_SECRET);
  return {
    secret,
    configured: secret.length >= 32,
    ttlHours: getConfirmationTokenTtlHours(env),
  };
}

export function hashConfirmationToken(rawToken, secret) {
  const token = String(rawToken || "").trim();
  const signingSecret = cleanSecret(secret);
  if (!TOKEN_PATTERN.test(token) || signingSecret.length < 32) return null;
  return createHmac("sha256", signingSecret).update(token).digest("hex");
}

export function createConfirmationToken({ env = process.env, now = new Date() } = {}) {
  const config = confirmationTokenConfig(env);
  if (!config.configured) {
    throw new Error("DELAI_CONFIRMATION_TOKEN_SECRET must contain at least 32 characters.");
  }

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashConfirmationToken(rawToken, config.secret);
  const expiresAt = new Date(now.getTime() + config.ttlHours * 60 * 60 * 1000);

  return {
    rawToken,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
    ttlHours: config.ttlHours,
  };
}

export function hashIncomingConfirmationToken(rawToken, env = process.env) {
  const config = confirmationTokenConfig(env);
  if (!config.configured) return null;
  return hashConfirmationToken(rawToken, config.secret);
}

