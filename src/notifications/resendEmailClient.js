const RESEND_ENDPOINT = "https://api.resend.com/emails";

function clean(value) {
  return String(value || "").trim();
}

export function emailDeliveryConfig(env = process.env) {
  return {
    enabled: clean(env.DELAI_EMAIL_DELIVERY_ENABLED).toLowerCase() === "true",
    apiKey: clean(env.RESEND_API_KEY),
    from: clean(env.DELAI_EMAIL_FROM),
    publicAppUrl: clean(env.DELAI_PUBLIC_APP_URL).replace(/\/$/, ""),
  };
}

export function validateEmailDeliveryConfig(env = process.env) {
  const config = emailDeliveryConfig(env);
  if (!config.enabled) return { ok: false, code: "email_delivery_disabled", config };
  if (!config.apiKey) return { ok: false, code: "resend_api_key_missing", config };
  if (!config.from) return { ok: false, code: "email_from_missing", config };
  if (!/^https:\/\//i.test(config.publicAppUrl)) {
    return { ok: false, code: "public_app_url_invalid", config };
  }
  return { ok: true, config };
}

export async function sendResendEmail(
  { to, subject, html, text, idempotencyKey },
  { env = process.env, fetchImpl = fetch } = {}
) {
  const validation = validateEmailDeliveryConfig(env);
  if (!validation.ok) {
    return { sent: false, skipped: true, code: validation.code };
  }

  const recipient = clean(to);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return { sent: false, skipped: true, code: "recipient_email_invalid" };
  }

  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${validation.config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": clean(idempotencyKey),
    },
    body: JSON.stringify({
      from: validation.config.from,
      to: [recipient],
      subject: clean(subject),
      html: String(html || ""),
      text: String(text || ""),
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(`Resend returned HTTP ${response.status}.`);
    error.code = "resend_http_error";
    error.status = response.status;
    error.providerMessage = clean(payload?.message) || null;
    throw error;
  }

  return {
    sent: true,
    skipped: false,
    provider: "resend",
    providerMessageId: clean(payload?.id) || null,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildDelayConfirmationEmail({ detectedDelay, confirmationUrl }) {
  const scheduled = clean(
    detectedDelay?.scheduled_departure_time || detectedDelay?.scheduled_time
  );
  const origin = clean(detectedDelay?.origin_station) || "Saved origin";
  const destination = clean(detectedDelay?.destination_station) || "saved destination";
  const serviceDate = clean(detectedDelay?.service_date) || "your travel date";
  const cancelled = clean(detectedDelay?.service_status).toLowerCase() === "cancelled";
  const delayMinutes = Math.max(0, Number(detectedDelay?.delay_minutes || 0));
  const disruption = cancelled
    ? "was reported as cancelled"
    : `was delayed by ${delayMinutes} minute${delayMinutes === 1 ? "" : "s"}`;
  const subject = cancelled
    ? `Was this your ${scheduled || "saved"} cancelled train?`
    : `Were you on the ${scheduled || "saved"} delayed train?`;

  const safeUrl = escapeHtml(confirmationUrl);
  const summary = `${serviceDate}, ${scheduled || "time unavailable"}, ${origin} to ${destination}: ${disruption}.`;
  const text = [
    subject,
    "",
    summary,
    "",
    "Review this journey securely in Delai:",
    confirmationUrl,
    "",
    "Opening the link does not confirm a claim. You must choose Yes or No on the Delai page.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en"><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#172033">
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
  <div style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #dfe6ef">
    <p style="margin:0 0 8px;color:#2156a5;font-weight:700">DELAI</p>
    <h1 style="font-size:24px;line-height:1.3;margin:0 0 16px">${escapeHtml(subject)}</h1>
    <p style="font-size:16px;line-height:1.6;margin:0 0 24px">${escapeHtml(summary)}</p>
    <a href="${safeUrl}" style="display:inline-block;background:#2156a5;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700">Review journey</a>
    <p style="font-size:13px;line-height:1.5;color:#5e6b7d;margin:24px 0 0">Opening this link does not confirm a claim. You must choose Yes or No on the secure Delai page. The link expires automatically.</p>
  </div>
</div></body></html>`;

  return { subject, html, text };
}

