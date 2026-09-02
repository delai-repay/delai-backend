import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  constantTimeTextEqual,
  createRateLimiter,
  isUuid,
} from "../src/security/httpSecurity.js";
import {
  determineCollectionTrigger,
  getFeeCollectionPolicy,
} from "../src/payments/feePolicy.js";
import { verifySignedWebhook } from "../src/payments/paymentCrypto.js";

const policy = getFeeCollectionPolicy();
assert.equal(policy.feeRatePercentage, 10);
assert.equal(policy.thresholdPence, 500);
assert.equal(policy.annualResidualDays, 365);
assert.equal(policy.minimumAnnualCollectionPence, 100);

assert.equal(
  determineCollectionTrigger({
    balancePence: 500,
    oldestAccruedAt: new Date().toISOString(),
    policy,
  }),
  "threshold"
);
assert.equal(
  determineCollectionTrigger({
    balancePence: 499,
    oldestAccruedAt: "2025-08-23T00:00:00.000Z",
    now: new Date("2026-08-24T00:00:00.000Z"),
    policy,
  }),
  "annual_residual"
);
assert.equal(
  determineCollectionTrigger({
    balancePence: 99,
    oldestAccruedAt: "2025-08-23T00:00:00.000Z",
    now: new Date("2026-08-24T00:00:00.000Z"),
    policy,
  }),
  null
);

assert.equal(constantTimeTextEqual("cron-secret", "cron-secret"), true);
assert.equal(constantTimeTextEqual("cron-secret", "wrong-secret"), false);
assert.equal(
  isUuid("c81e70e4-a1c3-403d-a723-8d56581354db"),
  true
);
assert.equal(isUuid("claim-test"), false);

const rateLimit = createRateLimiter({ windowMs: 60000, max: 2 });
const responses = [];
function runLimitedRequest() {
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      responses.push({ status: this.statusCode, payload });
      return this;
    },
  };
  let nextCalled = false;
  rateLimit({ ip: "127.0.0.1", socket: {} }, response, () => {
    nextCalled = true;
  });
  return { nextCalled, response };
}
assert.equal(runLimitedRequest().nextCalled, true);
assert.equal(runLimitedRequest().nextCalled, true);
assert.equal(runLimitedRequest().nextCalled, false);
assert.equal(responses.at(-1).status, 429);

const rawBody = Buffer.from('{"events":[]}');
const webhookSecret = "test-webhook-secret";
const signature = createHmac("sha256", webhookSecret)
  .update(rawBody)
  .digest("hex");
assert.equal(
  verifySignedWebhook({ rawBody, suppliedSignature: signature, secret: webhookSecret }),
  true
);
assert.equal(
  verifySignedWebhook({ rawBody, suppliedSignature: "bad", secret: webhookSecret }),
  false
);

const serverSource = readFileSync(
  new URL("../src/server.js", import.meta.url),
  "utf8"
);
for (const route of [
  "prepare-claim",
  "validate-claim-submission",
  "submit-claim-with-delai",
  "mark-claim-ready",
  "mark-claim-submitted",
  "update-claim-reference",
  "update-operator-response",
  "update-claim-outcome",
  "check-claim-outcome",
  "update-claim-payment",
]) {
  assert.match(
    serverSource,
    new RegExp(
      `app\\.post\\(\\s*["']/${route}["'],\\s*requireAuthenticatedUser`,
      "m"
    ),
    `${route} must authenticate the caller`
  );
}
assert.doesNotMatch(serverSource, /app\.get\("\/process-automation-jobs"/);
assert.doesNotMatch(serverSource, /app\.get\("\/check-submitted-claims"/);
assert.match(serverSource, /rpc\("lease_automation_jobs"/);
assert.match(serverSource, /const fee_percentage = 10;/);

const migrationSource = readFileSync(
  new URL(
    "../supabase/migrations/20260824_release1_security_fee_ledger.sql",
    import.meta.url
  ),
  "utf8"
);
assert.match(migrationSource, /for update skip locked/i);
assert.match(migrationSource, /prepare_fee_collection_batch/i);
assert.match(migrationSource, /fee_collection_batches/i);
assert.match(migrationSource, /enable row level security/i);

const cancellationExecutorSource = readFileSync(
  new URL(
    "../src/cancellations/greaterAngliaCancellationPlaywrightExecutor.js",
    import.meta.url
  ),
  "utf8"
);
assert.match(
  cancellationExecutorSource,
  /const CANCELLATION_FINAL_SUBMIT_IMPLEMENTED = false;/
);

console.log("Release 1 security and accumulated fee-ledger tests passed.");
