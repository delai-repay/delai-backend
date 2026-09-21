const DEFAULT_BASE_URL =
  "https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS";

const PILOT_STATION_CODES = new Map([
  ["hatfield peverel", "HAP"],
  ["london liverpool street", "LST"],
  ["liverpool street", "LST"],
]);

function cleanStationName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clockTime(value) {
  const match = String(value || "").trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function minutesBetween(start, end) {
  if (!start || !end) return null;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  let difference = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (difference < -720) difference += 1440;
  return Math.max(0, difference);
}

function londonDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const read = (type) => parts.find((part) => part.type === type)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function findCallingPoint(service, destinationCrs) {
  const groups = Array.isArray(service?.subsequentCallingPoints)
    ? service.subsequentCallingPoints
    : [];
  return groups
    .flatMap((group) => (Array.isArray(group?.callingPoint) ? group.callingPoint : []))
    .find((point) => String(point?.crs || "").toUpperCase() === destinationCrs);
}

export function resolveCommuteCrs(commute, direction) {
  const outbound = direction === "outbound";
  const originName = outbound ? commute.origin_station : commute.destination_station;
  const destinationName = outbound ? commute.destination_station : commute.origin_station;
  const originCrs = outbound ? commute.origin_crs : commute.destination_crs;
  const destinationCrs = outbound ? commute.destination_crs : commute.origin_crs;
  return {
    originName,
    destinationName,
    originCrs:
      String(originCrs || PILOT_STATION_CODES.get(cleanStationName(originName)) || "")
        .trim()
        .toUpperCase() || null,
    destinationCrs:
      String(
        destinationCrs || PILOT_STATION_CODES.get(cleanStationName(destinationName)) || ""
      )
        .trim()
        .toUpperCase() || null,
  };
}

export function normaliseDarwinBoard({
  board,
  originName,
  destinationName,
  destinationCrs,
  serviceDate,
}) {
  const services = Array.isArray(board?.trainServices) ? board.trainServices : [];
  return services.flatMap((service) => {
    const scheduledDeparture = clockTime(service?.std);
    const destination = findCallingPoint(service, destinationCrs);
    const scheduledArrival = clockTime(destination?.st);
    const actualArrival = clockTime(destination?.at) || clockTime(destination?.et);
    const cancelled = Boolean(
      service?.isCancelled || service?.filterLocationCancelled || destination?.isCancelled
    );
    const delayMinutes = minutesBetween(scheduledArrival, actualArrival);

    if (!scheduledDeparture || (!cancelled && delayMinutes === null)) return [];

    return [
      {
        service_identifier: String(service?.serviceID || service?.rsid || "").trim() || null,
        service_date: serviceDate,
        operator: String(service?.operator || "").trim() || null,
        origin_station: originName,
        destination_station: destinationName,
        scheduled_departure_time: scheduledDeparture,
        scheduled_arrival_time: scheduledArrival,
        actual_arrival_time: actualArrival,
        delay_minutes: cancelled ? null : delayMinutes,
        service_status: cancelled ? "cancelled" : "delayed",
        disruption_reason:
          String(
            service?.cancelReason ||
              destination?.cancelReason ||
              service?.delayReason ||
              destination?.delayReason ||
              ""
          ).trim() || null,
        source: "national_rail_darwin_ldbws",
      },
    ];
  });
}

export function createNationalRailDarwinClient({ env = process.env, fetchImpl = fetch } = {}) {
  const enabled = String(env.NATIONAL_RAIL_DARWIN_ENABLED || "false").toLowerCase() === "true";
  const apiKey = String(env.NATIONAL_RAIL_DARWIN_API_KEY || "").trim();
  const baseUrl = String(env.NATIONAL_RAIL_DARWIN_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const timeoutMs = Math.max(1000, Number(env.NATIONAL_RAIL_DARWIN_TIMEOUT_MS || 10000));

  async function getServices({ originCrs, destinationCrs, originName, destinationName }, { probe = false } = {}) {
    if (!enabled && !probe) return { status: "disabled", services: [] };
    if (!apiKey) return { status: "credentials_missing", services: [] };
    if (!originCrs || !destinationCrs) return { status: "station_crs_missing", services: [] };
    if (!/^[A-Z]{3}$/.test(originCrs) || !/^[A-Z]{3}$/.test(destinationCrs)) {
      return { status: "station_crs_invalid", services: [] };
    }

    const url = new URL(
      `${baseUrl}/api/20220120/GetDepBoardWithDetails/${encodeURIComponent(originCrs)}`
    );
    url.searchParams.set("numRows", "50");
    url.searchParams.set("filterCrs", destinationCrs);
    url.searchParams.set("filterType", "to");
    url.searchParams.set("timeOffset", "-119");
    url.searchParams.set("timeWindow", "119");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "x-apikey": apiKey,
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Darwin LDBWS returned HTTP ${response.status}.`);
      const board = await response.json();
      if (!board || typeof board !== "object" || !Array.isArray(board.trainServices)) {
        throw new Error("Darwin LDBWS returned a board without trainServices; check detailed-board access.");
      }
      return {
        status: "connected",
        board_train_count: board.trainServices.length,
        board_with_calling_points_count: board.trainServices.filter(
          (service) => Array.isArray(service?.subsequentCallingPoints)
        ).length,
        services: normaliseDarwinBoard({
          board,
          originName,
          destinationName,
          destinationCrs,
          serviceDate: londonDate(board?.generatedAt ? new Date(board.generatedAt) : new Date()),
        }),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { enabled, getServices };
}
