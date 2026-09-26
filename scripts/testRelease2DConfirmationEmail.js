import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createConfirmationToken,
  hashConfirmationToken,
  hashIncomingConfirmationToken,
} from "../src/notifications/confirmationTokenService.js";
import {
  buildDelayConfirmationEmail,
  sendResendEmail,
  validateEmailDeliveryConfig,
} from "../src/notifications/resendEmailClient.js";

const tokenEnv = {
  DELAI_CONFIRMATION_TOKEN_SECRET: "a".repeat(64),
  DELAI_CONFIRMATION_TOKEN_TTL_HOURS: "48",
};
const token = createConfirmationToken({
  env: tokenEnv,
  now: new Date("2026-09-26T08:00:00.000Z"),
});
assert.match(token.rawToken, /^[A-Za-z0-9_-]{43}$/);
assert.equal(token.tokenHash, hashConfirmationToken(token.rawToken, tokenEnv.DELAI_CONFIRMATION_TOKEN_SECRET));
assert.equal(token.tokenHash, hashIncomingConfirmationToken(token.rawToken, tokenEnv));
assert.equal(token.expiresAt, "2026-09-28T08:00:00.000Z");
assert.equal(hashIncomingConfirmationToken("not a token", tokenEnv), null);
assert.throws(
  () => createConfirmationToken({ env: { DELAI_CONFIRMATION_TOKEN_SECRET: "short" } }),
  /at least 32 characters/
);

assert.equal(validateEmailDeliveryConfig({}).code, "email_delivery_disabled");
const emailEnv = {
  DELAI_EMAIL_DELIVERY_ENABLED: "true",
  RESEND_API_KEY: "re_test_key",
  DELAI_EMAIL_FROM: "Delai <claims@notify.delaiapp.com>",
  DELAI_PUBLIC_APP_URL: "https://delaiapp.com",
};
assert.equal(validateEmailDeliveryConfig(emailEnv).ok, true);

const confirmationUrl = `https://delaiapp.com/confirm-journey?token=${token.rawToken}`;
const email = buildDelayConfirmationEmail({
  detectedDelay: {
    scheduled_departure_time: "07:48",
    origin_station: "Hatfield Peverel <test>",
    destination_station: "London Liverpool Street",
    service_date: "2026-09-26",
    delay_minutes: 17,
    service_status: "delayed",
  },
  confirmationUrl,
});
assert.match(email.subject, /07:48/);
assert.match(email.text, /Opening the link does not confirm a claim/);
assert.match(email.html, /Review journey/);
assert.doesNotMatch(email.html, /Hatfield Peverel <test>/);
assert.match(email.html, /Hatfield Peverel &lt;test&gt;/);

let request = null;
const sendResult = await sendResendEmail(
  {
    to: "passenger@example.com",
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: "delay-confirmation-test-token",
  },
  {
    env: emailEnv,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "resend-message-1" }),
      };
    },
  }
);
assert.equal(sendResult.sent, true);
assert.equal(sendResult.providerMessageId, "resend-message-1");
assert.equal(request.url, "https://api.resend.com/emails");
assert.equal(request.options.headers.Authorization, "Bearer re_test_key");
assert.equal(request.options.headers["Idempotency-Key"], "delay-confirmation-test-token");
assert.equal(JSON.parse(request.options.body).to[0], "passenger@example.com");
assert.doesNotMatch(request.options.body, /re_test_key/);

let disabledFetchCalled = false;
const disabledResult = await sendResendEmail(
  { to: "passenger@example.com" },
  {
    env: { DELAI_EMAIL_DELIVERY_ENABLED: "false" },
    fetchImpl: async () => {
      disabledFetchCalled = true;
    },
  }
);
assert.equal(disabledResult.code, "email_delivery_disabled");
assert.equal(disabledFetchCalled, false);

const serverSource = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
assert.match(serverSource, /app\.get\(\s*"\/delay-confirmation-token\/preview"/);
assert.match(serverSource, /app\.post\(\s*"\/delay-confirmation-token\/respond"/);
assert.match(serverSource, /provider_status: "no_scheduled_commutes"/);
assert.match(serverSource, /Cache-Control", "no-store"/);
assert.match(serverSource, /consumeDelayConfirmationToken/);

const migration = await readFile(
  new URL("../supabase/migrations/20260926_release2d_confirmation_email.sql", import.meta.url),
  "utf8"
);
assert.match(migration, /create table if not exists public\.delay_confirmation_tokens/);
assert.match(migration, /create table if not exists public\.notification_email_deliveries/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all .* from anon, authenticated/);

console.log("Release 2D secure journey confirmation email tests passed.");

