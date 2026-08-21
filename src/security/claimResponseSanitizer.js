function cleanString(value, maxLength = 120) {
  if (value === undefined || value === null) return null;

  const cleaned = String(value).trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

function buildSafeClaimResponse(claim = {}) {
  return {
    id: cleanString(claim.id, 80),
    status: cleanString(claim.status, 60),
    submission_status: cleanString(claim.submission_status, 80),
    claim_type: cleanString(claim.claim_type, 80),
    compensation_route: cleanString(claim.compensation_route, 100),
    journey_outcome: cleanString(claim.journey_outcome, 60),
    cancellation_adapter_key: cleanString(
      claim.cancellation_adapter_key,
      100
    ),
    cancellation_policy_version: cleanString(
      claim.cancellation_policy_version,
      120
    ),
    cancellation_case_prepared_at: cleanString(
      claim.cancellation_case_prepared_at,
      40
    ),
    cancellation_submission_channel: cleanString(
      claim.cancellation_submission_channel,
      120
    ),
    cancellation_executor_key: cleanString(
      claim.cancellation_executor_key,
      120
    ),
    cancellation_executor_version: cleanString(
      claim.cancellation_executor_version,
      120
    ),
    cancellation_executor_checkpoint: cleanString(
      claim.cancellation_executor_checkpoint,
      120
    ),
    cancellation_form_draft_prepared_at: cleanString(
      claim.cancellation_form_draft_prepared_at,
      40
    ),
    submitted_at: cleanString(claim.submitted_at, 40),
    operator_reference: cleanString(claim.operator_reference, 120),
    outcome: cleanString(claim.outcome, 60),
    outcome_updated_at: cleanString(claim.outcome_updated_at, 40),
    payment_status: cleanString(claim.payment_status, 60),
  };
}

function buildSafeAuditSummary(audit) {
  if (!audit || typeof audit !== "object") return null;

  return {
    recorded: audit.recorded === true,
    audit_id: cleanString(audit.audit_id, 80),
    result_status: cleanString(audit.result_status, 60),
    screenshot_count: Number.isFinite(Number(audit.screenshot_count))
      ? Number(audit.screenshot_count)
      : 0,
  };
}

function buildSafeSubmissionResponse(result = {}) {
  const source =
    result?.submission && typeof result.submission === "object"
      ? result.submission
      : result;
  const audit =
    source?.operator_submission_audit || result?.operator_submission_audit;

  return {
    submitted: source?.submitted === true,
    blocked: source?.blocked === true || result?.blocked === true,
    checkpoint: cleanString(source?.checkpoint, 80),
    blocker_code: cleanString(source?.blocker_code, 100),
    operator: cleanString(source?.operator, 100),
    operator_key: cleanString(
      source?.operatorKey || source?.operator_key,
      100
    ),
    integration_status: cleanString(
      source?.integrationStatus || source?.integration_status,
      120
    ),
    submission_status: cleanString(
      source?.submissionStatus || source?.submission_status,
      100
    ),
    policy_version: cleanString(
      source?.policyVersion || source?.policy_version,
      120
    ),
    submission_channel: cleanString(
      source?.submissionChannel || source?.submission_channel,
      120
    ),
    executor_version: cleanString(
      source?.executorVersion || source?.executor_version,
      120
    ),
    final_submit_enabled: source?.finalSubmitEnabled === true,
    operator_submission_audit: buildSafeAuditSummary(audit),
  };
}

export { buildSafeClaimResponse, buildSafeSubmissionResponse };
