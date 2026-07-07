import { resolveOperatorIdentity } from "./operatorRegistry.js";

function cleanText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const cleanedValue = String(value).trim();

  return cleanedValue || null;
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numberValue = Number(value);

  return Number.isNaN(numberValue) ? null : numberValue;
}

function cleanTravelDays(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((day) => day.trim())
      .filter(Boolean);
  }

  return [];
}

function buildClaimSubmissionContext({
  claim,
  detectedDelay,
  profile = null,
  authUser = null,
  seasonTicket = null,
  commute = null,
}) {
  if (!claim?.id) {
    throw new Error(
      "A valid claim is required to build submission context."
    );
  }

  if (!detectedDelay?.id) {
    throw new Error(
      "A valid detected delay is required to build submission context."
    );
  }

  const rawOperatorName =
    detectedDelay.operator ||
    commute?.operator ||
    seasonTicket?.operator ||
    null;

  const operatorIdentity =
    resolveOperatorIdentity(rawOperatorName);

  return {
    contextVersion: "1.0",
    generatedAt: new Date().toISOString(),

    claim: {
      id: claim.id,
      userId: claim.user_id,
      detectedDelayId: claim.detected_delay_id,
      status: claim.status,
      preparedSummary: cleanText(claim.prepared_summary),
      preparedAt: claim.prepared_at || null,
      submissionStatus: claim.submission_status || null,
      existingOperatorReference:
        cleanText(claim.operator_reference),
    },

    operator: {
      key: operatorIdentity.operatorKey,
      displayName: operatorIdentity.displayName,
      suppliedName: cleanText(rawOperatorName),
      knownOperator: operatorIdentity.knownOperator,
    },

    passenger: {
    fullName:
    cleanText(profile?.full_name) ||
    cleanText(profile?.name) ||
    cleanText(
      authUser?.user_metadata?.full_name
    ) ||
    cleanText(authUser?.user_metadata?.name),

    email:
    cleanText(profile?.email) ||
    cleanText(authUser?.email) ||
    cleanText(authUser?.user_metadata?.email),

    mobile:
    cleanText(profile?.mobile) ||
    cleanText(profile?.phone) ||
    cleanText(authUser?.phone) ||
    cleanText(authUser?.user_metadata?.phone),
  },

    journey: {
      delayId: detectedDelay.id,
      date: detectedDelay.delay_date || null,
      operator: cleanText(rawOperatorName),
      originStation:
        cleanText(detectedDelay.origin_station) ||
        cleanText(commute?.origin_station),
      destinationStation:
        cleanText(detectedDelay.destination_station) ||
        cleanText(commute?.destination_station),
      direction: cleanText(detectedDelay.direction),
      travelWindow: cleanText(detectedDelay.travel_window),
      scheduledTime: cleanText(
        detectedDelay.scheduled_time
      ),
      actualTime: cleanText(detectedDelay.actual_time),
      delayMinutes: cleanNumber(
        detectedDelay.delay_minutes
      ),
      source: cleanText(detectedDelay.source),
    },

    ticket: {
  id: seasonTicket?.id || null,

  type: cleanText(seasonTicket?.ticket_type),

  cost: cleanNumber(
    seasonTicket?.ticket_cost ??
      seasonTicket?.cost ??
      seasonTicket?.purchase_price
  ),

  originStation: cleanText(
    seasonTicket?.origin_station
  ),

  destinationStation: cleanText(
    seasonTicket?.destination_station
  ),

  startDate:
    seasonTicket?.ticket_start_date ||
    seasonTicket?.valid_from ||
    null,

  endDate:
    seasonTicket?.ticket_end_date ||
    seasonTicket?.valid_until ||
    null,

  bookingReference:
    cleanText(seasonTicket?.booking_reference) ||
    cleanText(seasonTicket?.booking_ref) ||
    cleanText(seasonTicket?.ticket_reference),

  smartcardProvider:
    cleanText(seasonTicket?.smartcard_provider) ||
    cleanText(seasonTicket?.operator),

  smartcardNumber: cleanText(
    seasonTicket?.smartcard_number
  ),
},

    commute: {
      id: commute?.id || null,
      originStation: cleanText(commute?.origin_station),
      destinationStation: cleanText(
        commute?.destination_station
      ),
      outboundTime: cleanText(commute?.outbound_time),
      returnTime: cleanText(commute?.return_time),
      travelDays: cleanTravelDays(commute?.travel_days),
      operator: cleanText(commute?.operator),
    },
  };
}

export {
  buildClaimSubmissionContext,
};