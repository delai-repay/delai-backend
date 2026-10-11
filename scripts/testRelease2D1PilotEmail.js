import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createPilotDeliveryEnv,
  getPilotEmailConfig,
  maskPilotEmail,
  pilotRecipientMatches,
  validatePilotEmailCandidate,
} from "../src/notifications/pilotEmailPolicy.js";

const candidateId = "a8b10dd2-9256-4a2f-b432-37c1962c675c";
const safeEnv = {
  DELAI_EMAIL_DELIVERY_ENABLED: "false",
  DELAI_EMAIL_PILOT_ENABLED: "true",
  DELAI_EMAIL_PILOT_DETECTED_DELAY_ID: candidateId,
  DELAI_EMAIL_PILOT_RECIPIENT: "Pilot@Example.com",
};

assert.equal(getPilotEmailConfig(safeEnv).recipient, "pilot@example.com");
assert.equal(validatePilotEmailCandidate(candidateId, safeEnv).ok, true);
assert.equal(
  validatePilotEmailCandidate("c81e70e4-a1c3-403d-a723-8d56581354db", safeEnv).code,
  "candidate_not_allowlisted"
);
assert.equal(
  validatePilotEmailCandidate(candidateId, {
    ...safeEnv,
    DELAI_EMAIL_PILOT_ENABLED: "false",
  }).code,
  "pilot_email_disabled"
);
assert.equal(
  validatePilotEmailCandidate(candidateId, {
    ...safeEnv,
    DELAI_EMAIL_DELIVERY_ENABLED: "true",
  }).code,
  "global_email_delivery_must_remain_disabled"
);
assert.equal(pilotRecipientMatches("PILOT@example.com", safeEnv), true);
assert.equal(pilotRecipientMatches("someone-else@example.com", safeEnv), false);
assert.equal(createPilotDeliveryEnv(safeEnv).DELAI_EMAIL_DELIVERY_ENABLED, "true");
assert.equal(safeEnv.DELAI_EMAIL_DELIVERY_ENABLED, "false");
assert.equal(maskPilotEmail("pilot@example.com"), "p***@example.com");

const serverSource = await readFile(
  new URL("../src/server.js", import.meta.url),
  "utf8"
);
assert.match(serverSource, /app\.post\(\s*"\/send-pilot-confirmation-email"/);
assert.match(
  serverSource,
  /"\/send-pilot-confirmation-email",\s*requireAutomationSecret/
);
assert.match(serverSource, /validatePilotEmailCandidate/);
assert.match(serverSource, /pilotRecipientMatches/);
assert.match(serverSource, /passenger_confirmation_status[^;]+pending/s);
assert.match(serverSource, /createPilotDeliveryEnv/);

console.log("Release 2D.1 allowlisted pilot email tests passed.");
