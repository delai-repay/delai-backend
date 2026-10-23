import { createHash } from "node:crypto";

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
  }
  return value;
}

export function buildSubmissionSnapshotHash({ claim, detectedDelay, submissionContext }) {
  // Keep every submission field, including payment details, but exclude the
  // clock and workflow marker that necessarily change between review and send.
  const context = structuredClone(submissionContext || {});
  delete context.generatedAt;
  if (context.claim) delete context.claim.submissionStatus;
  return createHash("sha256").update(JSON.stringify(ordered({
    snapshotVersion: 2,
    claimId: claim?.id || null,
    userId: claim?.user_id || null,
    detectedDelayId: detectedDelay?.id || null,
    submissionContext: context,
  }))).digest("hex");
}
