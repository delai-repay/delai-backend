import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  approveClaimFinalSubmission,
  consumeClaimFinalSubmissionApproval,
  resolveFinalSubmitGate,
  revokeClaimFinalSubmissionApproval,
} from "../src/operators/submissionApprovalService.js";

const approval = {
  id: "approval-1",
  status: "approved",
  generation: 1,
  submission_hash: "a".repeat(64),
};
const rpcCalls = [];
const supabase = {
  rpc: async (name, args) => {
    rpcCalls.push({ name, args });
    if (name === "consume_claim_final_submission_approval") {
      return { data: [approval], error: null };
    }
    if (name === "revoke_claim_final_submission_approval") {
      return { data: [{ ...approval, status: "revoked" }], error: null };
    }
    return { data: [approval], error: null };
  },
};

assert.deepEqual(resolveFinalSubmitGate({}), {
  enabled: false,
  globalGate: false,
  claimGate: false,
  reason: "global_pilot_lock",
});
assert.equal(
  resolveFinalSubmitGate({ globalEnabled: true }).reason,
  "claim_approval_required"
);
assert.equal(
  resolveFinalSubmitGate({
    globalEnabled: false,
    claimApproval: { authorized: true },
  }).enabled,
  false
);
assert.equal(
  resolveFinalSubmitGate({
    globalEnabled: true,
    claimApproval: { authorized: true },
  }).enabled,
  true
);

await approveClaimFinalSubmission({
  supabase,
  userId: "user-1",
  claimId: "claim-1",
  submissionHash: "a".repeat(64),
});
const consumed = await consumeClaimFinalSubmissionApproval({
  supabase,
  userId: "user-1",
  claimId: "claim-1",
  jobId: "job-1",
  submissionHash: "a".repeat(64),
});
assert.equal(consumed.authorized, true);
await revokeClaimFinalSubmissionApproval({
  supabase,
  userId: "user-1",
  claimId: "claim-1",
});

assert.equal(rpcCalls[0].name, "approve_claim_final_submission");
assert.equal(rpcCalls[0].args.p_expires_in_minutes, 15);
assert.equal(rpcCalls[1].name, "consume_claim_final_submission_approval");
assert.equal(rpcCalls[1].args.p_submission_hash, "a".repeat(64));
assert.equal(rpcCalls[2].name, "revoke_claim_final_submission_approval");

const emptySupabase = {
  rpc: async () => ({ data: [], error: null }),
};
const missing = await consumeClaimFinalSubmissionApproval({
  supabase: emptySupabase,
  userId: "user-1",
  claimId: "claim-1",
  jobId: "job-2",
  submissionHash: "b".repeat(64),
});
assert.equal(missing.authorized, false);
assert.equal(missing.reason, "claim_approval_required");

const serverSource = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
const adapterSource = await readFile(
  new URL("../src/operators/greaterAngliaOperatorAdapter.js", import.meta.url),
  "utf8"
);
const cancellationExecutorSource = await readFile(
  new URL(
    "../src/cancellations/greaterAngliaCancellationPlaywrightExecutor.js",
    import.meta.url
  ),
  "utf8"
);
const migrationSource = await readFile(
  new URL(
    "../supabase/migrations/20260902_release2a_claim_submission_approvals.sql",
    import.meta.url
  ),
  "utf8"
);

assert.match(serverSource, /"\/approve-claim-final-submit"/);
assert.match(serverSource, /"\/revoke-claim-final-submit"/);
assert.match(serverSource, /confirm_final_submission !== true/);
assert.match(serverSource, /buildSubmissionSnapshotHash/);
assert.match(serverSource, /consumeClaimFinalSubmissionApproval/);
assert.match(adapterSource, /globalEnabled: isGreaterAngliaFinalSubmitEnabled\(\)/);
assert.match(adapterSource, /claimApproval: finalSubmitAuthorization/);
assert.match(adapterSource, /const finalSubmitEnabled = finalSubmitGate\.enabled/);
assert.match(cancellationExecutorSource, /const CANCELLATION_FINAL_SUBMIT_IMPLEMENTED = false;/);
assert.match(migrationSource, /enable row level security/i);
assert.match(migrationSource, /revoke all on table public\.claim_submission_approvals from anon, authenticated/i);
assert.match(migrationSource, /status = 'consumed'/i);
assert.match(migrationSource, /submission_hash = p_submission_hash/i);
assert.match(migrationSource, /expires_at > now\(\)/i);

console.log("Release 2A claim-specific final-submission approval tests passed.");
