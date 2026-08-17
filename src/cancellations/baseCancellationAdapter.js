function cleanText(value) {
  if (value === undefined || value === null) return null;

  const cleaned = String(value).trim();
  return cleaned || null;
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === "") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

class BaseCancellationAdapter {
  constructor({ operatorKey, displayName, compensationRoute } = {}) {
    this.operatorKey = operatorKey || "unknown_operator";
    this.displayName = displayName || "Unknown train operator";
    this.compensationRoute =
      compensationRoute || "season_ticket_cancelled_journey";
    this.adapterVersion = "base-cancellation-1.0";
    this.submissionStrategy = "operator_cancellation_adapter_pending";
  }

  buildCasePayload({ claim, detectedDelay, submissionContext } = {}) {
    const contextClaim = submissionContext?.claim || {};
    const passenger = submissionContext?.passenger || {};
    const journey = submissionContext?.journey || {};
    const ticket = submissionContext?.ticket || {};

    return {
      adapterVersion: this.adapterVersion,
      mappedAt: new Date().toISOString(),
      operator: {
        key: this.operatorKey,
        displayName: this.displayName,
        submissionMode: this.submissionStrategy,
      },
      claim: {
        id: claim?.id || contextClaim.id || null,
        userId: claim?.user_id || contextClaim.userId || null,
        detectedDelayId:
          claim?.detected_delay_id ||
          contextClaim.detectedDelayId ||
          detectedDelay?.id ||
          null,
        claimType:
          cleanText(claim?.claim_type) || cleanText(contextClaim.claimType),
        compensationRoute:
          cleanText(claim?.compensation_route) ||
          cleanText(contextClaim.compensationRoute) ||
          this.compensationRoute,
        journeyOutcome:
          cleanText(claim?.journey_outcome) ||
          cleanText(contextClaim.journeyOutcome),
      },
      passenger: {
        title: cleanText(passenger.title),
        fullName: cleanText(passenger.fullName),
        email: cleanText(passenger.email),
        mobile: cleanText(passenger.mobile),
        addressLine1: cleanText(passenger.addressLine1),
        addressLine2: cleanText(passenger.addressLine2),
        townCity: cleanText(passenger.townCity),
        postcode: cleanText(passenger.postcode),
        country: cleanText(passenger.country) || "United Kingdom",
      },
      journey: {
        serviceIdentifier:
          cleanText(journey.serviceIdentifier) ||
          cleanText(detectedDelay?.service_identifier),
        serviceStatus:
          cleanText(journey.serviceStatus) ||
          cleanText(detectedDelay?.service_status),
        date:
          cleanText(journey.date) ||
          cleanText(detectedDelay?.service_date) ||
          cleanText(detectedDelay?.delay_date),
        scheduledDepartureTime:
          cleanText(journey.scheduledTime) ||
          cleanText(detectedDelay?.scheduled_departure_time) ||
          cleanText(detectedDelay?.scheduled_time),
        scheduledArrivalTime:
          cleanText(journey.scheduledArrivalTime) ||
          cleanText(detectedDelay?.scheduled_arrival_time),
        originStation:
          cleanText(journey.originStation) ||
          cleanText(detectedDelay?.origin_station),
        destinationStation:
          cleanText(journey.destinationStation) ||
          cleanText(detectedDelay?.destination_station),
        journeyOutcome:
          cleanText(journey.journeyOutcome) ||
          cleanText(detectedDelay?.journey_outcome),
        passengerConfirmationStatus:
          cleanText(journey.passengerConfirmationStatus) ||
          cleanText(detectedDelay?.passenger_confirmation_status),
        disruptionReason:
          cleanText(journey.disruptionReason) ||
          cleanText(detectedDelay?.disruption_reason),
        delayMinutes: cleanNumber(journey.delayMinutes),
      },
      ticket: {
        id: ticket.id || null,
        type: cleanText(ticket.type),
        cost: cleanNumber(ticket.cost),
        originStation: cleanText(ticket.originStation),
        destinationStation: cleanText(ticket.destinationStation),
        startDate: cleanText(ticket.startDate),
        endDate: cleanText(ticket.endDate),
        bookingReference: cleanText(ticket.bookingReference),
        smartcardProvider: cleanText(ticket.smartcardProvider),
        smartcardNumber: cleanText(ticket.smartcardNumber),
      },
      safety: {
        ordinaryDelayRepayBlocked: true,
        noDelayMinutesInvented: journey.delayMinutes == null,
        paymentDetailsIncluded: false,
        finalSubmitEnabled: false,
      },
    };
  }

  async submitCase({ claim, detectedDelay, submissionContext } = {}) {
    return {
      submitted: false,
      blocked: true,
      ready: false,
      reason: `No cancelled-journey compensation adapter is connected for ${this.displayName}.`,
      source: "cancellation_adapter_not_connected",
      operator: this.displayName,
      operatorKey: this.operatorKey,
      integrationStatus: "cancellation_adapter_pending",
      submissionStatus: "awaiting_cancellation_adapter",
      submissionStrategy: this.submissionStrategy,
      finalSubmitEnabled: false,
      mappedSubmission: this.buildCasePayload({
        claim,
        detectedDelay,
        submissionContext,
      }),
    };
  }
}

export default BaseCancellationAdapter;
