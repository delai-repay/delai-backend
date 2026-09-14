const GREATER_ANGLIA_CLAIM_WINDOW_DAYS = 28;

function parseIsoDate(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatIsoDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function getUkCalendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function evaluateGreaterAngliaClaimDeadline({ serviceDate, now = new Date() } = {}) {
  const incidentDate = parseIsoDate(serviceDate);
  if (!incidentDate) {
    return {
      valid: false,
      eligible: false,
      expired: false,
      reason: "missing_or_invalid_service_date",
      serviceDate: null,
      deadlineDate: null,
      currentDate: getUkCalendarDate(now),
      daysRemaining: null,
    };
  }

  const deadline = new Date(incidentDate.getTime());
  deadline.setUTCDate(deadline.getUTCDate() + GREATER_ANGLIA_CLAIM_WINDOW_DAYS);
  const deadlineDate = formatIsoDate(deadline);
  const currentDate = getUkCalendarDate(now);
  const current = parseIsoDate(currentDate);
  const daysRemaining = Math.round((deadline.getTime() - current.getTime()) / 86400000);
  const expired = currentDate > deadlineDate;

  return {
    valid: true,
    eligible: !expired,
    expired,
    reason: expired ? "claim_deadline_expired" : "within_claim_window",
    serviceDate: formatIsoDate(incidentDate),
    deadlineDate,
    currentDate,
    daysRemaining,
    windowDays: GREATER_ANGLIA_CLAIM_WINDOW_DAYS,
  };
}

export {
  GREATER_ANGLIA_CLAIM_WINDOW_DAYS,
  evaluateGreaterAngliaClaimDeadline,
  getUkCalendarDate,
};
