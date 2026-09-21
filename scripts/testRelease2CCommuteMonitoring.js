import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createNationalRailDarwinClient,
  normaliseDarwinBoard,
  resolveCommuteCrs,
} from "../src/delays/nationalRailDarwinClient.js";

const commute = {
  origin_station: "Hatfield Peverel",
  destination_station: "London Liverpool Street",
};
assert.deepEqual(resolveCommuteCrs(commute, "outbound"), {
  originName: "Hatfield Peverel",
  destinationName: "London Liverpool Street",
  originCrs: "HAP",
  destinationCrs: "LST",
});

const services = normaliseDarwinBoard({
  originName: commute.origin_station,
  destinationName: commute.destination_station,
  destinationCrs: "LST",
  serviceDate: "2026-09-14",
  board: {
    trainServices: [
      {
        serviceID: "darwin-service-1",
        std: "07:48",
        operator: "Greater Anglia",
        delayReason: "A signalling fault",
        subsequentCallingPoints: [
          { callingPoint: [{ crs: "LST", st: "08:30", et: "08:47" }] },
        ],
      },
      {
        serviceID: "vague-delay-is-not-evidence",
        std: "07:58",
        operator: "Greater Anglia",
        subsequentCallingPoints: [
          { callingPoint: [{ crs: "LST", st: "08:40", et: "Delayed" }] },
        ],
      },
      {
        serviceID: "darwin-cancelled",
        std: "07:30",
        operator: "Greater Anglia",
        isCancelled: true,
        cancelReason: "Train crew unavailable",
        subsequentCallingPoints: [],
      },
    ],
  },
});
assert.equal(services.length, 2);
assert.equal(services[0].delay_minutes, 17);
assert.equal(services[0].actual_arrival_time, "08:47");
assert.equal(services[1].service_status, "cancelled");

const disabled = createNationalRailDarwinClient({ env: {}, fetchImpl: () => assert.fail() });
assert.equal((await disabled.getServices({})).status, "disabled");

let requestedUrl;
let requestedKey;
const client = createNationalRailDarwinClient({
  env: {
    NATIONAL_RAIL_DARWIN_ENABLED: "true",
    NATIONAL_RAIL_DARWIN_API_KEY: "sample-consumer-key",
  },
  fetchImpl: async (url, options) => {
    requestedUrl = String(url);
    requestedKey = options.headers["x-apikey"];
    assert.equal(options.headers.Authorization, undefined);
    return { ok: true, json: async () => ({ generatedAt: "2026-09-14T08:00:00+01:00", trainServices: [] }) };
  },
});
const liveResult = await client.getServices({
  originCrs: "HAP",
  destinationCrs: "LST",
  originName: "Hatfield Peverel",
  destinationName: "London Liverpool Street",
});
assert.equal(liveResult.status, "connected");
assert.match(requestedUrl, /^https:\/\/api1\.raildata\.org\.uk\/1010-live-departure-board-dep1_2\/LDBWS\//);
assert.match(requestedUrl, /GetDepBoardWithDetails\/HAP/);
assert.match(requestedUrl, /filterCrs=LST/);
assert.equal(requestedKey, "sample-consumer-key");

const missingKey = createNationalRailDarwinClient({ env: { NATIONAL_RAIL_DARWIN_ENABLED: "true" }, fetchImpl: () => assert.fail() });
assert.equal((await missingKey.getServices({ originCrs: "HAP", destinationCrs: "LST" })).status, "credentials_missing");

const probeWhileDisabled = createNationalRailDarwinClient({
  env: { NATIONAL_RAIL_DARWIN_API_KEY: "sample-consumer-key" },
  fetchImpl: async () => ({ ok: true, json: async () => ({ trainServices: [] }) }),
});
assert.equal((await probeWhileDisabled.getServices({ originCrs: "HAP", destinationCrs: "LST" }, { probe: true })).status, "connected");
assert.equal((await probeWhileDisabled.getServices({ originCrs: "HAP", destinationCrs: "LST" })).status, "disabled");

const invalidShape = createNationalRailDarwinClient({
  env: { NATIONAL_RAIL_DARWIN_API_KEY: "sample-consumer-key" },
  fetchImpl: async () => ({ ok: true, json: async () => ({ error: "unexpected response" }) }),
});
await assert.rejects(() => invalidShape.getServices({ originCrs: "HAP", destinationCrs: "LST" }, { probe: true }), /without trainServices/);

const deniedDetails = createNationalRailDarwinClient({
  env: { NATIONAL_RAIL_DARWIN_API_KEY: "sample-consumer-key" },
  fetchImpl: async () => ({ ok: false, status: 403 }),
});
await assert.rejects(
  () => deniedDetails.getServices({ originCrs: "HAP", destinationCrs: "LST" }, { probe: true }),
  /HTTP 403/
);

const serverSource = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
assert.match(serverSource, /app\.post\("\/monitor-commutes", requireAutomationSecret/);
assert.match(serverSource, /app\.post\("\/probe-darwin", requireAutomationSecret/);
assert.match(serverSource, /timeZone: "Europe\/London"/);
assert.match(serverSource, /provider_status: "connected"/);
assert.match(serverSource, /provider_results: providerResults/);
assert.match(serverSource, /returned no qualifying delayed or cancelled services/);

console.log("Release 2C automatic commute monitoring tests passed.");
