import { buildSubmissionSnapshotHash } from "./submissionSnapshot.js";
import { evaluateGreaterAngliaClaimDeadline } from "../claims/claimDeadlinePolicy.js";
import { FEE_RATE_PERCENTAGE } from "../payments/feePolicy.js";
import { isCancelledService } from "../delays/journeyDisruptionRouting.js";

export const FINAL_SUBMISSION_ACKNOWLEDGEMENT = "I authorise Delai to submit this claim to Greater Anglia.";
const PREPARED_SOURCE = "greater_anglia_playwright_executor_safety_locked";
const fail = (status, code, message) => Object.assign(new Error(message), { status, code, customerSafe: true });
const normalizedOperator = (value) => String(value || "").toLowerCase().replace(/[^a-z]/g, "");
const recordedSubmitted = (c) => c.status === "submitted" || c.submission_status === "submitted" || Boolean(c.submitted_at);
const isSent = (c) => recordedSubmitted(c) || Boolean(c.operator_reference);

export function createClaimFinalReviewHandlers(deps) {
  const {
    supabase, loadClaimSubmissionContext, validateSubmissionContext,
    isFinalSubmitEnabled, approveClaimFinalSubmission, revokeClaimFinalSubmissionApproval,
    queueAutomationJob, withTimeout, now = () => new Date(),
    deadlineExpiredMessage = "The 28-day Greater Anglia claim deadline has passed.",
  } = deps;
  const read = (query, label) => withTimeout(query, 10000, label);

  async function ownedClaim(req) {
    if (!req.authUser?.id) throw fail(401, "authentication_required", "Please sign in again.");
    const userId = req.authUser.id;
    const claimId = req.body?.claim_id;
    const { data: claim, error } = await read(supabase.from("claims").select("*").eq("id", claimId).eq("user_id", userId).maybeSingle(), "Review claim lookup");
    if (error) throw error;
    if (!claim || claim.user_id !== userId || claim.id !== claimId) throw fail(404, "claim_not_found", "Claim not found.");
    return claim;
  }

  async function approvalFor(claim) {
    const { data, error } = await read(supabase.from("claim_submission_approvals").select("status,approved_at,expires_at,generation").eq("claim_id", claim.id).eq("user_id", claim.user_id).maybeSingle(), "Review approval lookup");
    if (error) throw error;
    if (!data) return null;
    const expired = data.status === "approved" && (!data.expires_at || new Date(data.expires_at).getTime() <= now().getTime());
    return { ...data, status: expired ? "expired" : data.status, stored_status: data.status };
  }

  async function detailsFor(claim) {
    if ((claim.claim_type || "delay_repay") !== "delay_repay") throw fail(409, "unsupported_claim_type", "This review supports ordinary Greater Anglia Delay Repay claims only.");
    const { data: delay, error } = await read(supabase.from("detected_delays").select("*").eq("id", claim.detected_delay_id).eq("user_id", claim.user_id).maybeSingle(), "Review journey lookup");
    if (error) throw error;
    if (!delay || delay.user_id !== claim.user_id || normalizedOperator(delay.operator) !== "greateranglia") throw fail(409, "unsupported_journey", "A Greater Anglia journey is required.");
    if (isCancelledService(delay.service_status)) throw fail(409, "unsupported_claim_type", "Cancelled journeys require their separate claim route.");
    if (delay.passenger_confirmation_status !== "confirmed") throw fail(409, "travel_confirmation_required", "Confirm that you travelled before reviewing this claim.");
    const deadline = evaluateGreaterAngliaClaimDeadline({ serviceDate: delay.service_date || delay.delay_date, now: now() });
    if (!deadline.eligible) throw fail(409, deadline.reason, deadline.valid ? deadlineExpiredMessage : "A valid journey date is required before approval.");
    const context = await loadClaimSubmissionContext({ claim, detectedDelay: delay });
    const validation = validateSubmissionContext(context);
    if (!validation.readyForSubmission) throw fail(409, "claim_details_incomplete", "Claim details need to be checked again before approval.");
    return { context, delay, deadline, hash: buildSubmissionSnapshotHash({ claim, detectedDelay: delay, submissionContext: context }) };
  }

  function prepared(claim) {
    return claim.status === "ready_to_submit" && claim.submission_status === "awaiting_operator_integration" && claim.submission_source === PREPARED_SOURCE && !isSent(claim);
  }

  function publicReview(claim, details) {
    const { context: c, hash, deadline } = details;
    const p = c.passenger || {}, t = c.ticket || {}, j = c.journey || {}, bank = c.paymentDetails || {};
    return {
      claim_id: claim.id, review_hash: hash, operator: "Greater Anglia",
      journey: { date: j.date, scheduled_time: j.scheduledTime, origin: j.originStation, destination: j.destinationStation, delay_minutes: j.delayMinutes },
      passenger: { title: p.title, name: p.fullName, email: p.email, address: [p.addressLine1, p.addressLine2, p.townCity].filter(Boolean), postcode: p.postcode, country: p.country },
      ticket: { type: t.type, price: t.cost, start_date: t.startDate, end_date: t.endDate, smartcard_last4: String(t.smartcardNumber || "").slice(-4) || null },
      payout: { method: bank.preferredPaymentMethod || p.preferredPaymentMethod || "BACS", account_last4: String(bank.accountNumber || "").slice(-4) || null },
      fee_percentage: FEE_RATE_PERCENTAGE, deadline_date: deadline.deadlineDate,
    };
  }

  async function workflow(claim) {
    const approval = await approvalFor(claim);
    const paused = !isFinalSubmitEnabled();
    const pending = claim.submission_status === "approved_for_submission";
    return {
      claim_status: claim.status, submission_status: claim.submission_status,
      submitted: recordedSubmitted(claim), operator_reference: claim.operator_reference || null,
      submission_uncertain: Boolean(claim.operator_reference) && !recordedSubmitted(claim),
      global_pilot_lock_enabled: paused,
      can_approve: prepared(claim) && !paused && !["approved", "consumed"].includes(approval?.stored_status),
      // A missing/old approval may mean the approve RPC is still in flight.
      // Only an atomically revocable approved row permits cancellation/reset.
      can_revoke: !isSent(claim) && claim.status === "ready_to_submit" && (pending || prepared(claim)) && approval?.stored_status === "approved",
      approval_status: approval?.status || null,
      approval_expires_at: approval?.expires_at || null,
    };
  }

  function endpoint(run) {
    return async (req, res) => {
      res.set("Cache-Control", "no-store");
      try { return await run(req, res); }
      catch (error) {
        // Diagnostics contain a code, never the submission context or bank fields.
        const safe = error.customerSafe === true;
        if (!safe) console.error("Claim final review failed:", error.code || "review_service_error");
        return res.status(safe ? error.status : 503).json({ success: false, code: safe ? error.code : "review_service_unavailable", error: safe ? error.message : "Claim review could not be completed. Refresh status before trying again." });
      }
    };
  }

  const review = endpoint(async (req, res) => {
    const claim = await ownedClaim(req);
    const state = await workflow(claim);
    // Approval cancellation must remain available even if details later become
    // incomplete or the journey deadline passes. Never label current details as
    // the approved snapshot once a request has been reserved.
    if (isSent(claim) || ["processing", "approved_for_submission"].includes(claim.submission_status)) return res.json({ success: true, claim_id: claim.id, review: null, workflow: state });
    if (!prepared(claim)) throw fail(409, "claim_not_prepared", "Prepare this claim again before reviewing final submission.");
    const details = await detailsFor(claim);
    return res.json({ success: true, claim_id: claim.id, review: publicReview(claim, details), workflow: state });
  });

  const approve = endpoint(async (req, res) => {
    if (req.body?.confirm_final_submission !== true || req.body?.approval_acknowledgement !== FINAL_SUBMISSION_ACKNOWLEDGEMENT) throw fail(400, "explicit_approval_required", "Explicit final-submission approval is required for this claim.");
    if (!isFinalSubmitEnabled()) throw fail(409, "final_submission_paused", "Final submissions are paused. Your claim has not been approved or queued.");
    if (!/^[a-f0-9]{64}$/.test(String(req.body?.review_hash || ""))) throw fail(400, "review_required", "Open a fresh review before approving this claim.");
    const claim = await ownedClaim(req);
    if (!prepared(claim)) throw fail(409, "claim_status_changed", "This claim is no longer awaiting approval. Refresh status.");
    const existingApproval = await approvalFor(claim);
    if (["approved", "consumed"].includes(existingApproval?.stored_status)) throw fail(409, "approval_already_recorded", "A previous approval must be checked before this claim can be approved again.");
    const details = await detailsFor(claim);
    if (details.hash !== req.body.review_hash) throw fail(409, "review_changed", "Your claim details have changed. Open a fresh review before approving.");

    // Reserve the transition atomically. A replay or concurrent click cannot
    // create a second approval/job. A failed/uncertain RPC stays held for review.
    const { data: reserved, error: reserveError } = await read(supabase.from("claims")
      .update({ submission_status: "approved_for_submission", submission_error: null })
      .eq("id", claim.id).eq("user_id", claim.user_id).eq("status", "ready_to_submit")
      .eq("submission_status", "awaiting_operator_integration").eq("submission_source", PREPARED_SOURCE)
      .is("submitted_at", null).is("operator_reference", null).select("id").maybeSingle(), "Reserve reviewed claim approval");
    if (reserveError) throw reserveError;
    if (!reserved) throw fail(409, "claim_status_changed", "This claim changed while approval was being checked. Refresh status.");

    const approval = await approveClaimFinalSubmission({ supabase, userId: claim.user_id, claimId: claim.id, submissionHash: details.hash });
    // Recheck the separate global lock after persisting the approval as well.
    if (!isFinalSubmitEnabled()) {
      await revokeClaimFinalSubmissionApproval({ supabase, userId: claim.user_id, claimId: claim.id });
      throw fail(409, "final_submission_paused", "Final submissions were paused. Refresh status before continuing.");
    }
    await queueAutomationJob({ userId: claim.user_id, claimId: claim.id, jobType: "claim_submit", force: true });
    return res.json({ success: true, claim_id: claim.id, submitted: false, approval: { status: approval.status, expires_at: approval.expires_at }, message: "Your claim is approved and queued for submission. It has not yet been recorded as submitted." });
  });

  const revoke = endpoint(async (req, res) => {
    const claim = await ownedClaim(req);
    if (isSent(claim) || claim.status !== "ready_to_submit" || (claim.submission_status !== "approved_for_submission" && !prepared(claim))) throw fail(409, "approval_not_cancellable", "This claim is no longer waiting for approval. Refresh status.");
    const approval = await approvalFor(claim);
    if (approval?.status === "consumed") throw fail(409, "approval_already_consumed", "Submission processing has already started. Refresh status to check the result.");
    if (approval?.stored_status !== "approved") throw fail(409, "approval_state_uncertain", "Delai needs to check this approval before another action. Refresh status to check its progress.");
    const revoked = await revokeClaimFinalSubmissionApproval({ supabase, userId: claim.user_id, claimId: claim.id });
    if (!revoked) throw fail(409, "approval_already_consumed", "Approval changed while cancellation was being checked. Refresh status.");
    const { data: reset, error } = await read(supabase.from("claims")
      .update({ submission_status: "awaiting_operator_integration", submission_error: null })
      .eq("id", claim.id).eq("user_id", claim.user_id).eq("status", "ready_to_submit")
      .eq("submission_status", claim.submission_status).is("submitted_at", null).is("operator_reference", null)
      .select("id").maybeSingle(), "Return revoked claim to review");
    if (error) throw error;
    if (!reset) throw fail(409, "claim_status_changed", "The claim has moved on. Refresh status to check it.");
    return res.json({ success: true, claim_id: claim.id, revoked: true, submitted: false, message: "Approval cancelled. The claim is waiting for review again." });
  });
  return { review, approve, revoke };
}
