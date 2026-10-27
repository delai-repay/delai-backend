import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  readGreaterAngliaPortalPage,
  selectGreaterAngliaCustomerDeclaration,
  verifyGreaterAngliaCustomerDeclaration,
} from "../src/operators/greaterAngliaConfirmationNavigation.js";

let passed = 0;
async function test(name, run) {
  try { await run(); passed += 1; }
  catch (error) { throw new Error(name, { cause: error }); }
}
const navError = () => new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation");
const passivePage = (overrides = {}) => ({ isClosed: () => false, waitForLoadState: async () => {}, ...overrides });
const fast = { pause: async () => {} };

await test("read succeeds without a wait", async () => {
  let waits = 0;
  assert.equal(await readGreaterAngliaPortalPage(passivePage({ waitForLoadState: async () => waits++ }), async () => "ready", fast), "ready");
  assert.equal(waits, 0);
});
await test("navigation retries the read only", async () => {
  let reads = 0, waits = 0;
  const result = await readGreaterAngliaPortalPage(passivePage({ waitForLoadState: async () => waits++ }), async () => {
    if (++reads < 3) throw navError();
    return "new document";
  }, fast);
  assert.equal(result, "new document"); assert.equal(reads, 3); assert.equal(waits, 2);
});
await test("unrelated evaluation errors are preserved", async () => {
  const original = new Error("ReferenceError: fixture is not defined"); let reads = 0;
  await assert.rejects(readGreaterAngliaPortalPage(passivePage(), async () => { reads++; throw original; }, fast), e => e === original);
  assert.equal(reads, 1);
});
await test("a closed page is never retried", async () => {
  let reads = 0, waits = 0;
  await assert.rejects(readGreaterAngliaPortalPage(passivePage({ isClosed: () => true, waitForLoadState: async () => waits++ }), async () => { reads++; throw navError(); }, fast));
  assert.equal(reads, 1); assert.equal(waits, 0);
});
await test("attempt cap prevents endless navigation retries", async () => {
  let reads = 0;
  await assert.rejects(readGreaterAngliaPortalPage(passivePage(), async () => { reads++; throw navError(); }, { ...fast, maxAttempts: 3 }));
  assert.equal(reads, 3);
});
await test("elapsed-time budget stops retries", async () => {
  let clock = 0, reads = 0;
  await assert.rejects(readGreaterAngliaPortalPage(passivePage(), async () => { reads++; throw navError(); }, { timeoutMs: 10, now: () => clock, pause: async () => { clock += 10; } }));
  assert.equal(reads, 2);
});
await test("load timeout permits another passive read", async () => {
  let reads = 0;
  const page = passivePage({ waitForLoadState: async () => { throw Object.assign(new Error("load timeout"), { name: "TimeoutError" }); } });
  assert.equal(await readGreaterAngliaPortalPage(page, async () => { if (++reads === 1) throw navError(); return "ready"; }, fast), "ready");
});
await test("unexpected wait failures are not hidden", async () => {
  const original = new Error("unexpected protocol failure");
  await assert.rejects(readGreaterAngliaPortalPage(passivePage({ waitForLoadState: async () => { throw original; } }), async () => { throw navError(); }, fast), e => e === original);
});

function declarationFixture({ count = 1, native = true, checked = false, setError = null, refusesCheck = false, statement = false, singleFinalControl = true } = {}) {
  const calls = { set: 0 };
  const checkbox = {
    count: async () => count, evaluate: async () => native, isChecked: async () => checked,
    setChecked: async () => { calls.set++; checked = !refusesCheck; if (setError) throw setError; },
  };
  return { page: passivePage({ getByRole: () => checkbox, evaluate: async () => ({ explicitStatement: statement, finalReviewVisible: true, fraudWarningVisible: true, singleFinalControl }) }), calls };
}
await test("a real unchecked checkbox is selected once", async () => {
  const f = declarationFixture(); const result = await selectGreaterAngliaCustomerDeclaration(f.page);
  assert.equal(result.checked, true); assert.equal(f.calls.set, 1);
});
await test("an existing declaration is never toggled", async () => {
  const f = declarationFixture({ checked: true }); const result = await selectGreaterAngliaCustomerDeclaration(f.page);
  assert.equal(result.alreadyChecked, true); assert.equal(f.calls.set, 0);
});
await test("a missing checkbox cannot become a Submit click", async () => {
  const f = declarationFixture({ count: 0 });
  await assert.rejects(selectGreaterAngliaCustomerDeclaration(f.page), { code: "declaration_not_found" }); assert.equal(f.calls.set, 0);
});
await test("ambiguous declarations require review", async () => {
  const f = declarationFixture({ count: 2 });
  await assert.rejects(selectGreaterAngliaCustomerDeclaration(f.page), { code: "declaration_ambiguous" }); assert.equal(f.calls.set, 0);
});
await test("a custom role cannot impersonate the native checkbox", async () => {
  const f = declarationFixture({ native: false });
  await assert.rejects(selectGreaterAngliaCustomerDeclaration(f.page), { code: "declaration_not_native_checkbox" }); assert.equal(f.calls.set, 0);
});
await test("a declaration action with an unknown result is not repeated", async () => {
  const f = declarationFixture({ setError: navError() });
  await assert.rejects(selectGreaterAngliaCustomerDeclaration(f.page), { code: "declaration_result_uncertain" }); assert.equal(f.calls.set, 1);
});
await test("an unchecked result is not accepted", async () => {
  const f = declarationFixture({ refusesCheck: true });
  await assert.rejects(selectGreaterAngliaCustomerDeclaration(f.page), { code: "declaration_not_checked" }); assert.equal(f.calls.set, 1);
});
await test("verification never checks an unchecked declaration", async () => {
  const f = declarationFixture();
  await assert.rejects(verifyGreaterAngliaCustomerDeclaration(f.page), { code: "declaration_not_checked" }); assert.equal(f.calls.set, 0);
});
await test("an explicit Submit-bound declaration is a passive verification", async () => {
  const f = declarationFixture({ count: 0, statement: true });
  const result = await selectGreaterAngliaCustomerDeclaration(f.page);
  assert.equal(result.method, "declaration_on_final_submit"); assert.equal(result.actionTaken, false); assert.equal(f.calls.set, 0);
});
await test("a Submit-bound declaration is rechecked without an action", async () => {
  const f = declarationFixture({ count: 0, statement: true });
  assert.equal((await verifyGreaterAngliaCustomerDeclaration(f.page, { expectedMethod: "declaration_on_final_submit" })).ok, true); assert.equal(f.calls.set, 0);
});
await test("a changed declaration method is held for review", async () => {
  const f = declarationFixture({ count: 0, statement: true });
  await assert.rejects(verifyGreaterAngliaCustomerDeclaration(f.page, { expectedMethod: "native_declaration_checkbox" }), { code: "declaration_changed" });
});
await test("Submit-bound wording does not override ambiguous final controls", async () => {
  const f = declarationFixture({ count: 0, statement: true, singleFinalControl: false });
  await assert.rejects(selectGreaterAngliaCustomerDeclaration(f.page), { code: "declaration_not_found" }); assert.equal(f.calls.set, 0);
});
await test("a textual statement cannot override two declaration checkboxes", async () => {
  const f = declarationFixture({ count: 2, statement: true });
  await assert.rejects(selectGreaterAngliaCustomerDeclaration(f.page), { code: "declaration_ambiguous" }); assert.equal(f.calls.set, 0);
});

const source = (await readFile(new URL("../src/operators/greaterAngliaPlaywrightExecutor.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
function actual(name, deps) {
  const marker = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
  assert.ok(marker, `Missing production function ${name}`);
  const end = source.indexOf("\n}", marker.index) + 2;
  return vm.runInNewContext(`(${source.slice(marker.index, end)})`, deps);
}
function finalFixture({ enabled = true, gates = [], boundary = {}, count = 1, declarationVerified = true, verifyError = null, clickError = null } = {}) {
  const context = { finalSubmitEnabled: enabled, customerDeclarationRequired: true, customerDeclarationVerified: declarationVerified, checkpoint: "final_review", steps: [] };
  const calls = { click: 0 };
  const button = { or() { return button; }, count: async () => count, click: async () => {
    calls.click++;
    assert.equal(context.finalSubmitAttempted, true);
    assert.equal(context.steps.at(-1).name, "Attempt final Submit");
    if (clickError) throw clickError;
  } };
  const deps = {
    readGreaterAngliaPortalPage, getFinalSubmissionGateFailures: () => gates,
    inspectFinalSubmitBoundary: async () => ({ finalReviewVisible: true, fraudWarningVisible: true, readyForClick: true, ...boundary }),
    verifyGreaterAngliaCustomerDeclaration: async () => { if (verifyError) throw verifyError; },
    createPortalBlocker: (_ctx, message, details) => Object.assign(new Error(message), { code: details.code }),
    setCheckpoint: (ctx, checkpoint) => { ctx.checkpoint = checkpoint; },
    addStep: (ctx, name, details) => ctx.steps.push({ name, ...details }),
  };
  return { run: actual("clickFinalSubmitSafely", deps), context, calls, page: passivePage({ getByRole: () => button }) };
}
await test("global lock blocks final action", async () => {
  const f = finalFixture({ enabled: false });
  await assert.rejects(f.run(f.page, f.context), { code: "final_submit_safety_lock" }); assert.equal(f.calls.click, 0);
});
await test("other required live flags still block", async () => {
  const f = finalFixture({ gates: ["missing live flag"] });
  await assert.rejects(f.run(f.page, f.context), { code: "final_submit_safety_lock" }); assert.equal(f.calls.click, 0);
});
await test("changed review boundary blocks final action", async () => {
  const f = finalFixture({ boundary: { finalReviewVisible: false } });
  await assert.rejects(f.run(f.page, f.context), { code: "final_submit_boundary_changed" }); assert.equal(f.calls.click, 0);
});
await test("fraud warning remains required", async () => {
  const f = finalFixture({ boundary: { fraudWarningVisible: false } });
  await assert.rejects(f.run(f.page, f.context), { code: "final_submit_boundary_changed" }); assert.equal(f.calls.click, 0);
});
await test("disabled Submit remains blocked", async () => {
  const f = finalFixture({ boundary: { readyForClick: false } });
  await assert.rejects(f.run(f.page, f.context), { code: "final_submit_boundary_changed" }); assert.equal(f.calls.click, 0);
});
await test("unverified declaration blocks final action", async () => {
  const f = finalFixture({ declarationVerified: false });
  await assert.rejects(f.run(f.page, f.context), { code: "declaration_not_checked" }); assert.equal(f.calls.click, 0);
});
await test("a declaration changed after review blocks Submit", async () => {
  const f = finalFixture({ verifyError: Object.assign(new Error("changed"), { code: "declaration_not_checked" }) });
  await assert.rejects(f.run(f.page, f.context), { code: "declaration_not_checked" }); assert.equal(f.calls.click, 0);
});
await test("ambiguous final controls are never clicked", async () => {
  const f = finalFixture({ count: 2 });
  await assert.rejects(f.run(f.page, f.context), { code: "final_submit_not_found" }); assert.equal(f.calls.click, 0);
});
await test("final-action intent precedes exactly one click", async () => {
  const f = finalFixture(); assert.equal((await f.run(f.page, f.context)).ok, true);
  assert.equal(f.calls.click, 1); assert.equal(f.context.finalSubmitOutcome, "click_returned");
  await assert.rejects(f.run(f.page, f.context), { code: "final_submit_already_attempted" }); assert.equal(f.calls.click, 1);
});
await test("a lost click response remains uncertain and cannot be replayed", async () => {
  const f = finalFixture({ clickError: navError() });
  await assert.rejects(f.run(f.page, f.context), { code: "final_submit_result_uncertain" });
  assert.equal(f.calls.click, 1); assert.equal(f.context.finalSubmitOutcome, "unknown");
  await assert.rejects(f.run(f.page, f.context), { code: "final_submit_already_attempted" }); assert.equal(f.calls.click, 1);
});

console.log(`Greater Anglia confirmation navigation: ${passed} checks passed. No portal was contacted.`);
