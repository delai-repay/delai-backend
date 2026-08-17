const CANCELLED_SERVICE_STATUSES = new Set([
  "cancelled",
  "canceled",
  "part_cancelled",
  "part_canceled",
]);

const SEASON_TICKET_TYPES = new Set([
  "weekly season ticket",
  "monthly season ticket",
  "annual season ticket",
  "flexi season ticket",
]);

function normaliseServiceStatus(value, cancelledFlag = false) {
  if (cancelledFlag === true) return "cancelled";

  const status = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (CANCELLED_SERVICE_STATUSES.has(status)) {
    return status.startsWith("part_") ? "part_cancelled" : "cancelled";
  }

  return "delayed";
}

function isCancelledService(value) {
  return ["cancelled", "part_cancelled"].includes(
    normaliseServiceStatus(value)
  );
}

function isSeasonTicketType(value) {
  return SEASON_TICKET_TYPES.has(String(value || "").trim().toLowerCase());
}

function getCancelledJourneyRoute({ ticketType, journeyOutcome } = {}) {
  if (String(journeyOutcome || "").trim().toLowerCase() !== "abandoned") {
    return {
      eligible: false,
      claimType: null,
      compensationRoute: "manual_review",
      submissionStatus: "manual_review_required",
      autoSubmitBlocked: true,
      reason: "A cancelled journey must be confirmed as abandoned before it can be routed.",
    };
  }

  if (isSeasonTicketType(ticketType)) {
    return {
      eligible: true,
      claimType: "cancellation_compensation",
      compensationRoute: "season_ticket_cancelled_journey",
      submissionStatus: "awaiting_cancellation_adapter",
      autoSubmitBlocked: true,
      reason:
        "This abandoned cancellation is a season-ticket compensation case and must not use the ordinary Delay Repay adapter.",
    };
  }

  return {
    eligible: true,
    claimType: "cancellation_refund",
    compensationRoute: "unused_ticket_refund",
    submissionStatus: "awaiting_retailer_refund_adapter",
    autoSubmitBlocked: true,
    reason:
      "This abandoned cancellation should be routed to the original ticket retailer for an unused-ticket refund.",
  };
}

export {
  getCancelledJourneyRoute,
  isCancelledService,
  isSeasonTicketType,
  normaliseServiceStatus,
};
