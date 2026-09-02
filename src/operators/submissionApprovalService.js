const DEFAULT_APPROVAL_MINUTES = 15;

function firstRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function approveClaimFinalSubmission({
  supabase,
  userId,
  claimId,
  submissionHash,
  expiresInMinutes = DEFAULT_APPROVAL_MINUTES,
}) {
  const { data, error } = await supabase.rpc("approve_claim_final_submission", {
    p_user_id: userId,
    p_claim_id: claimId,
    p_submission_hash: submissionHash,
    p_expires_in_minutes: expiresInMinutes,
  });

  if (error) throw error;

  const approval = firstRow(data);
  if (!approval) {
    throw new Error("Final-submission approval could not be created.");
  }

  return approval;
}

async function consumeClaimFinalSubmissionApproval({
  supabase,
  userId,
  claimId,
  jobId,
  submissionHash,
}) {
  const { data, error } = await supabase.rpc(
    "consume_claim_final_submission_approval",
    {
      p_user_id: userId,
      p_claim_id: claimId,
      p_job_id: String(jobId || "unknown-submission-job").slice(0, 200),
      p_submission_hash: submissionHash,
    }
  );

  if (error) throw error;

  const approval = firstRow(data);
  return {
    authorized: Boolean(approval),
    approval,
    reason: approval ? "claim_approval_consumed" : "claim_approval_required",
  };
}

async function revokeClaimFinalSubmissionApproval({
  supabase,
  userId,
  claimId,
}) {
  const { data, error } = await supabase.rpc("revoke_claim_final_submission_approval", {
    p_user_id: userId,
    p_claim_id: claimId,
  });

  if (error) throw error;
  return firstRow(data);
}

function resolveFinalSubmitGate({ globalEnabled, claimApproval } = {}) {
  const globalGate = globalEnabled === true;
  const claimGate = claimApproval?.authorized === true;

  return {
    enabled: globalGate && claimGate,
    globalGate,
    claimGate,
    reason: !globalGate
      ? "global_pilot_lock"
      : !claimGate
        ? "claim_approval_required"
        : "two_key_authorization_complete",
  };
}

export {
  DEFAULT_APPROVAL_MINUTES,
  approveClaimFinalSubmission,
  consumeClaimFinalSubmissionApproval,
  resolveFinalSubmitGate,
  revokeClaimFinalSubmissionApproval,
};
