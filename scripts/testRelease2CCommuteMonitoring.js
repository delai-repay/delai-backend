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
let requestedAuthorization;
const client = createNationalRailDarwinClient({
  env: {
    NATIONAL_RAIL_DARWIN_ENABLED: "true",
    NATIONAL_RAIL_DARWIN_USERNAME: "delai-user",
    NATIONAL_RAIL_DARWIN_PASSWORD: "secret",
  },
  fetchImpl: async (url, options) => {
    requestedUrl = String(url);
    requestedAuthorization = options.headers.Authorization;
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
assert.match(requestedUrl, /GetDepBoardWithDetails\/HAP/);
assert.match(requestedUrl, /filterCrs=LST/);
assert.equal(requestedAuthorization, `Basic ${Buffer.from("delai-user:secret").toString("base64")}`);

const serverSource = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
assert.match(serverSource, /app\.post\("\/monitor-commutes", requireAutomationSecret/);
assert.match(serverSource, /timeZone: "Europe\/London"/);

console.log("Release 2C automatic commute monitoring tests passed.");
