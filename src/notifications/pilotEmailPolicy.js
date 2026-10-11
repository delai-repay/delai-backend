const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value) {
  return String(value || "").trim();
}

function normaliseEmail(value) {
  return clean(value).toLowerCase();
}

export function getPilotEmailConfig(env = process.env) {
  return {
    enabled: clean(env.DELAI_EMAIL_PILOT_ENABLED).toLowerCase() === "true",
    globalDeliveryEnabled:
      clean(env.DELAI_EMAIL_DELIVERY_ENABLED).toLowerCase() === "true",
    detectedDelayId: clean(env.DELAI_EMAIL_PILOT_DETECTED_DELAY_ID),
    recipient: normaliseEmail(env.DELAI_EMAIL_PILOT_RECIPIENT),
  };
}

export function validatePilotEmailCandidate(detectedDelayId, env = process.env) {
  const config = getPilotEmailConfig(env);

  if (!config.enabled) {
    return { ok: false, code: "pilot_email_disabled", config };
  }
  if (config.globalDeliveryEnabled) {
    return {
      ok: false,
      code: "global_email_delivery_must_remain_disabled",
      config,
    };
  }
  if (!UUID_PATTERN.test(config.detectedDelayId)) {
    return { ok: false, code: "pilot_candidate_not_configured", config };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.recipient)) {
    return { ok: false, code: "pilot_recipient_not_configured", config };
  }

  const requestedId = clean(detectedDelayId);
  if (!UUID_PATTERN.test(requestedId)) {
    return { ok: false, code: "invalid_detected_delay_id", config };
  }
  if (requestedId.toLowerCase() !== config.detectedDelayId.toLowerCase()) {
    return { ok: false, code: "candidate_not_allowlisted", config };
  }

  return { ok: true, code: "pilot_candidate_allowed", config };
}

export function pilotRecipientMatches(recipientEmail, env = process.env) {
  const config = getPilotEmailConfig(env);
  return Boolean(
    config.recipient && normaliseEmail(recipientEmail) === config.recipient
  );
}

export function createPilotDeliveryEnv(env = process.env) {
  return {
    ...env,
    DELAI_EMAIL_DELIVERY_ENABLED: "true",
  };
}

export function maskPilotEmail(value) {
  const email = normaliseEmail(value);
  const [local, domain] = email.split("@");
  if (!local || !domain) return null;
  return `${local.slice(0, 1)}***@${domain}`;
}
