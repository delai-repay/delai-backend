import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { readGreaterAngliaPortalPage } from "../src/operators/greaterAngliaConfirmationNavigation.js";

const executor = (await readFile(new URL("../src/operators/greaterAngliaPlaywrightExecutor.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const server = (await readFile(new URL("../src/server.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
function production(source, name) {
  const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(start, `Missing production function ${name}`);
  return source.slice(start.index, source.indexOf("\n}", start.index) + 2);
}
let passed = 0;
async function test(name, run) {
  try { await run(); passed++; }
  catch (error) { throw new Error(name, { cause: error }); }
}
function fixture({ captcha = {}, enabled = true, attempted = false, lateCaptcha = false, gates = [] } = {}) {
  const context = { finalSubmitEnabled: enabled, checkpoint: "final_review", steps: [], customerDeclarationRequired: true, customerDeclarationVerified: true };
  if (attempted) Object.assign(context, { finalSubmitAttempted: true, finalSubmitOutcome: "unknown", checkpoint: "final_submit_attempted" });
  const calls = { click: 0, boundary: 0, declaration: 0, address: 0 };
  const deps = {
    readGreaterAngliaPortalPage,
    setCheckpoint: (ctx, checkpoint) => { ctx.checkpoint = checkpoint; },
    addStep: (ctx, name, details) => ctx.steps.push({ name, ...details }),
    createPortalBlocker: (_ctx, message, details) => Object.assign(new Error(message), details),
    getFinalSubmissionGateFailures: () => gates,
    inspectFinalSubmitBoundary: async () => {
      calls.boundary++;
      return { reached: true, finalReviewVisible: true, fraudWarningVisible: true, readyForClick: true,
        ...captcha, ...(lateCaptcha && calls.boundary > 1 ? { recaptchaVisible: true } : {}) };
    },
    inspectPortalPanel: async () => ({ stage: "confirmation" }),
    verifyFinalReviewAddress: async () => { calls.address++; },
    hasPassengerTravelConfirmation: () => true,
    selectGreaterAngliaCustomerDeclaration: async () => { calls.declaration++; return { ok: true, method: "declaration_on_final_submit" }; },
    verifyGreaterAngliaCustomerDeclaration: async () => {},
  };
  deps.requireGreaterAngliaHumanVerificationAbsent = vm.runInNewContext(`(${production(executor, "requireGreaterAngliaHumanVerificationAbsent")})`, deps);
  const button = { or() { return button; }, count: async () => 1, click: async () => { calls.click++; } };
  const page = { getByRole: () => button };
  return { context, calls, page, guard: deps.requireGreaterAngliaHumanVerificationAbsent,
    submit: vm.runInNewContext(`(${production(executor, "clickFinalSubmitSafely")})`, deps),
    prepare: vm.runInNewContext(`(${production(executor, "prepareConfirmationStep")})`, deps) };
}
for (const [name, captcha] of [
  ["visible CAPTCHA with enabled Submit", { recaptchaVisible: true }],
  ["visible CAPTCHA with disabled Submit", { recaptchaVisible: true, readyForClick: false }],
  ["configured widget still loading", { recaptchaConfigured: true, recaptchaVisible: false }],
  ["explicit portal CAPTCHA error", { recaptchaErrorVisible: true }],
]) {
  await test(`${name} blocks before click intent`, async () => {
    const f = fixture({ captcha });
    await assert.rejects(f.submit(f.page, f.context), { code: "operator_human_verification_required" });
    assert.equal(f.calls.click, 0);
    assert.equal(f.context.finalSubmitAttempted, undefined);
    assert.equal(f.context.checkpoint, "operator_human_verification_required");
    assert.equal(f.context.humanVerification.actionTaken, false);
    assert.equal(f.context.steps.some(step => step.name === "Attempt final Submit"), false);
  });
}
await test("a late CAPTCHA is checked again immediately before click intent", async () => {
  const f = fixture({ lateCaptcha: true });
  await assert.rejects(f.submit(f.page, f.context), { code: "operator_human_verification_required" });
  assert.equal(f.calls.boundary, 2); assert.equal(f.calls.click, 0); assert.equal(f.context.finalSubmitAttempted, undefined);
});
for (const enabled of [false, true]) {
  await test(`preparation detects CAPTCHA with final submission ${enabled ? "enabled" : "paused"}`, async () => {
    const f = fixture({ enabled, captcha: { recaptchaVisible: true } });
    await assert.rejects(f.prepare(f.page, f.context, { confirmationStep: {} }, {}, enabled), { code: "operator_human_verification_required" });
    assert.equal(f.calls.address, 1); assert.equal(f.calls.declaration, 0); assert.equal(f.calls.click, 0);
    assert.equal(f.context.finalSubmitAttempted, undefined);
  });
}
await test("paused preparation without a challenge reaches review without an action", async () => {
  const f = fixture({ enabled: false });
  assert.equal((await f.prepare(f.page, f.context, { confirmationStep: {} }, {}, false)).stage, "confirmation");
  assert.equal(f.calls.click, 0); assert.equal(f.calls.declaration, 0);
});
await test("an already attempted final action stays held and is not retried", async () => {
  const f = fixture({ attempted: true, captcha: { recaptchaVisible: true } });
  await assert.rejects(f.submit(f.page, f.context), { code: "final_submit_already_attempted" });
  assert.equal(f.calls.click, 0); assert.equal(f.context.checkpoint, "final_submit_attempted");
  assert.equal(f.context.humanVerification, undefined);
});
await test("a post-click CAPTCHA observation cannot downgrade uncertain submission", () => {
  const f = fixture({ attempted: true });
  assert.throws(() => f.guard(f.context, { recaptchaErrorVisible: true }), { code: "final_submit_result_uncertain" });
  assert.equal(f.context.checkpoint, "final_submit_attempted"); assert.equal(f.context.finalSubmitOutcome, "unknown");
  assert.equal(f.context.steps.length, 0);
});
await test("the global lock still prevents an otherwise valid action", async () => {
  const f = fixture({ enabled: false });
  await assert.rejects(f.submit(f.page, f.context), { code: "final_submit_safety_lock" }); assert.equal(f.calls.click, 0);
});
await test("other existing live gates are preserved", async () => {
  const f = fixture({ gates: ["missing live gate"] });
  await assert.rejects(f.submit(f.page, f.context), { code: "final_submit_safety_lock" }); assert.equal(f.calls.click, 0);
});
await test("a challenge-free authorised fixture still makes exactly one final action", async () => {
  const f = fixture(); await f.submit(f.page, f.context);
  assert.equal(f.calls.click, 1); assert.equal(f.context.finalSubmitOutcome, "click_returned");
  await assert.rejects(f.submit(f.page, f.context), { code: "final_submit_already_attempted" }); assert.equal(f.calls.click, 1);
});
await test("guard evidence contains booleans and no response token or passenger values", () => {
  const f = fixture();
  assert.throws(() => f.guard(f.context, { recaptchaVisible: true, token: "PRIVATE-RESPONSE", accountNumber: "PRIVATE-ACCOUNT" }));
  assert.doesNotMatch(JSON.stringify(f.context.humanVerification), /PRIVATE|token|accountNumber/);
});

const copy = vm.runInNewContext(`(${production(server, "buildOperatorIntegrationPendingCopy")})`);
const human = { blocker_code: "operator_human_verification_required", source: "greater_anglia_playwright_human_verification_required" };
const args = { submissionContext: { operator: { displayName: "Greater Anglia" } } };
for (const [name, result, expected] of [
  ["human-required code", human, "operator_human_verification_required"],
  ["human-required persisted source", { source: human.source }, "operator_human_verification_required"],
  ["uncertain code", { blocker_code: "final_submit_result_uncertain" }, "submission_uncertain"],
  ["missing operator receipt", { blocker_code: "operator_reference_missing" }, "submission_uncertain"],
  ["unexpected receipt", { blocker_code: "unexpected_receipt_before_final_submit" }, "submission_uncertain"],
  ["attempted Submit takes precedence over CAPTCHA", { ...human, runContext: { finalSubmitAttempted: true } }, "submission_uncertain"],
  ["attempted Submit takes precedence over old safety-lock metadata", { source: "greater_anglia_playwright_executor_safety_locked", runContext: { finalSubmitAttempted: true } }, "submission_uncertain"],
  ["paused preparation", { source: "greater_anglia_playwright_executor_safety_locked" }, "prepared_for_review"],
  ["unclassified executor error", { source: "greater_anglia_playwright_executor_error" }, "manual_review_required"],
  ["unconnected other operator", {}, "operator_submission_pending"],
]) {
  await test(`central backend copy: ${name}`, () => {
    assert.equal(copy({ ...args, submissionResult: result }).customer_status, expected);
  });
}
await test("nested adapter results use the same customer classification", () => {
  assert.equal(copy({ ...args, submissionResult: { submission: human } }).customer_status, "operator_human_verification_required");
});
await test("raw portal errors and payment values are never copied into customer messages", () => {
  const result = copy({ ...args, submissionResult: { ...human, reason: "PRIVATE-DIAGNOSTIC", customer_message: "PRIVATE-ACCOUNT" } });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  assert.match(result.customer_message, /human security check/);
});
await test("customer copy uses the supplied operator without leaking a previous operator", () => {
  assert.match(copy({ detectedDelay: { operator: "Another operator" }, submissionResult: human }).customer_message, /Another operator/);
  assert.doesNotMatch(copy({ detectedDelay: { operator: "Another operator" }, submissionResult: human }).customer_message, /Greater Anglia/);
});

// The existing worker contains unindented control-block braces, so delimit it
// by the next top-level function rather than assuming indentation is syntax.
const workerStart = server.indexOf("async function processClaimSubmitJob(");
const workerEnd = server.indexOf("async function queueAutomationJob(", workerStart);
assert.ok(workerStart >= 0 && workerEnd > workerStart, "Current submission worker must be present");
const worker = server.slice(workerStart, workerEnd);
const start = worker.indexOf("  if (!submissionResult.submitted) {");
const end = worker.indexOf("\n  const { data: submittedClaim", start);
assert.ok(start > 0 && end > start, "Current worker blocked-result branch must be present");
const blockedBranch = worker.slice(start, end);
for (const result of [human, { blocker_code: "final_submit_result_uncertain", runContext: { finalSubmitAttempted: true }, reason: "held", source: "greater_anglia_playwright_executor_error" }]) {
  await test(`actual worker returns and stores the correct hold: ${result.blocker_code}`, async () => {
    const writes = [], filters = [];
    const query = { update(values) { writes.push(values); return this; }, eq(key, value) { filters.push([key, value]); return this; }, then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); } };
    const deps = { submissionResult: result, claim: { id: "claim-a", user_id: "owner-a" }, attemptedAt: "2026-10-27T11:35:14Z", operatorSubmissionAudit: {},
      submissionContext: args.submissionContext, detectedDelay: {}, withTimeout: async promise => await promise,
      supabaseAdmin: { from(table) { assert.equal(table, "claims"); return query; } }, buildOperatorIntegrationPendingCopy: copy };
    const response = await vm.runInNewContext(`(async () => { ${blockedBranch} })()`, deps);
    const expected = result === human ? "operator_human_verification_required" : "submission_uncertain";
    assert.equal(response.blocked, true); assert.equal(response.customer_status, expected);
    assert.equal(response.submission.customer_status, expected);
    assert.doesNotMatch(response.customer_message, /preparing automatic submission/);
    assert.equal(writes.length, 1); assert.equal(writes[0].submission_status, "awaiting_operator_integration");
    assert.equal(writes[0].status, "ready_to_submit");
    assert.deepEqual(filters, [["id", "claim-a"], ["user_id", "owner-a"]]);
    assert.equal(Object.hasOwn(writes[0], "submitted_at"), false);
    assert.equal(Object.hasOwn(writes[0], "operator_reference"), false);
  });
}
console.log(`Greater Anglia human-verification guards and worker messages: ${passed} checks passed. No portal was contacted.`);
