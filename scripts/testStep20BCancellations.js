import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getCancelledJourneyRoute,
  isCancelledService,
  isSeasonTicketType,
  normaliseServiceStatus,
} from "../src/delays/journeyDisruptionRouting.js";

assert.equal(normaliseServiceStatus("Cancelled"), "cancelled");
assert.equal(normaliseServiceStatus("canceled"), "cancelled");
assert.equal(normaliseServiceStatus("part cancelled"), "part_cancelled");
assert.equal(normaliseServiceStatus(undefined, true), "cancelled");
assert.equal(normaliseServiceStatus("on time"), "delayed");
assert.equal(isCancelledService("cancelled"), true);
assert.equal(isCancelledService("delayed"), false);

assert.equal(isSeasonTicketType("Annual season ticket"), true);
assert.equal(isSeasonTicketType("Daily ticket"), false);

const annualSeasonTicketRoute = getCancelledJourneyRoute({
  ticketType: "Annual season ticket",
  journeyOutcome: "abandoned",
});

assert.deepEqual(annualSeasonTicketRoute, {
  eligible: true,
  claimType: "cancellation_compensation",
  compensationRoute: "season_ticket_cancelled_journey",
  submissionStatus: "awaiting_cancellation_adapter",
  autoSubmitBlocked: true,
  reason:
    "This abandoned cancellation is a season-ticket compensation case and must not use the ordinary Delay Repay adapter.",
});

const dailyTicketRoute = getCancelledJourneyRoute({
  ticketType: "Daily ticket",
  journeyOutcome: "abandoned",
});

assert.equal(dailyTicketRoute.claimType, "cancellation_refund");
assert.equal(dailyTicketRoute.compensationRoute, "unused_ticket_refund");
assert.equal(dailyTicketRoute.autoSubmitBlocked, true);

const unconfirmedRoute = getCancelledJourneyRoute({
  ticketType: "Annual season ticket",
  journeyOutcome: null,
});

assert.equal(unconfirmedRoute.eligible, false);
assert.equal(unconfirmedRoute.compensationRoute, "manual_review");

const serverSource = readFileSync(
  new URL("../src/server.js", import.meta.url),
  "utf8"
);

for (const route of [
  "pending-delay-confirmations",
  "respond-delay-confirmation",
]) {
  assert.match(
    serverSource,
    new RegExp(
      `app\\.(?:get|post)\\(\\s*["']/${route}["'],\\s*requireAuthenticatedUser`,
      "m"
    ),
    `${route} must require an authenticated user`
  );
}

assert.match(
  serverSource,
  /app\.post\(\s*["']\/detect-delays["'],\s*requireAutomationSecret/,
  "detect-delays must require the automation secret"
);

assert.match(serverSource, /isCancelledService\(service\.serviceStatus\)/);
assert.match(
  serverSource,
  /function isTimeInsideCommuteWindow\(time, windowValue, toleranceMinutes = 15\)/
);
assert.match(serverSource, /ensureCancelledAbandonedCompensationCase/);
assert.match(serverSource, /awaiting_cancellation_adapter/);
assert.match(
  serverSource,
  /cannot be submitted through the ordinary Delay Repay adapter/
);

const cancellationFunctionStart = serverSource.indexOf(
  "async function ensureCancelledAbandonedCompensationCase"
);
const cancellationFunctionEnd = serverSource.indexOf(
  "async function processClaimPrepareJob",
  cancellationFunctionStart
);
const cancellationFunctionSource = serverSource.slice(
  cancellationFunctionStart,
  cancellationFunctionEnd
);

assert.ok(
  cancellationFunctionStart >= 0 &&
    cancellationFunctionEnd > cancellationFunctionStart
);
assert.doesNotMatch(cancellationFunctionSource, /queueAutomationJob\s*\(/);

const migrationSource = readFileSync(
  new URL(
    "../supabase/migrations/20260817_step20b_cancelled_abandoned_journeys.sql",
    import.meta.url
  ),
  "utf8"
);

for (const column of [
  "service_status",
  "journey_outcome",
  "compensation_route",
  "claim_type",
]) {
  assert.match(migrationSource, new RegExp(`\\b${column}\\b`));
}

console.log("Step 20B cancelled/abandoned journey tests passed.");
