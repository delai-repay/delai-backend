import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import vm from "node:vm";
import { chromium } from "playwright";
import {
  readGreaterAngliaPortalPage, selectGreaterAngliaCustomerDeclaration,
  verifyGreaterAngliaCustomerDeclaration,
} from "../src/operators/greaterAngliaConfirmationNavigation.js";

// Real Chromium with synthetic localhost pages. Any external request is blocked.
let passed = 0;
let beforeEach;
async function test(name, run) {
  try { if (beforeEach) await beforeEach(); await run(); passed++; }
  catch (error) { throw new Error(name, { cause: error }); }
}
let sameLoads = 0, receiptPosts = 0, declarationLoads = 0;
let origin;
const fixture = ({ declaration = "native", checked = false, disabled = false, duplicates = false, navigate = false, links = true } = {}) => `<!doctype html><html><head><style>
  body{font:16px sans-serif;padding:24px}button,a,label{display:block;margin:10px;padding:8px}input{width:20px;height:20px}
  </style></head><body><main><h1>Confirm your claim</h1>
  <p>Fraud Act warning: I confirm that this claim is truthful.</p>
  <form method="post" action="${origin}/receipt">
  ${declaration === "native" ? `<label><input id="declaration" type="checkbox" ${checked ? "checked" : ""}> I confirm the information in this claim is correct.</label>` : ""}
  ${declaration === "ambiguous" ? '<label><input type="checkbox"> I confirm these details.</label><label><input type="checkbox"> I agree to this declaration.</label>' : ""}
  ${declaration === "custom" ? '<div role="checkbox" tabindex="0" aria-checked="false" aria-label="I confirm the information is correct">Declaration</div>' : ""}
  ${declaration === "fake-label" ? '<label for="submit">I confirm these details</label>' : ""}
  ${declaration === "hidden" ? '<label><input style="display:none" type="checkbox"> I confirm these details.</label>' : ""}
  ${declaration === "submit-bound" ? '<p>By selecting Submit, you agree to the Delay Repay terms and conditions.</p>' : ''}
  ${declaration === "submit-bound-variant" ? '<p>By clicking the submit button, you are agreeing to these Delay Repay terms and conditions.</p>' : ''}
  ${declaration === "submit-bound-unwrapped" ? 'By selecting Submit, you agree to the Delay Repay terms and conditions.' : ''}
  ${declaration === "hidden-submit-bound" ? '<p hidden>By selecting Submit, you agree to the Delay Repay terms and conditions.</p>' : ''}
  ${declaration === "irrelevant-submit-bound" ? '<p>By selecting Submit, you agree to privacy terms and conditions.</p>' : ''}
  ${links ? '<a id="agreement" href="#">I agree</a><a href="#">Terms and conditions</a>' : ''}
  <button id="submit" ${disabled ? "disabled" : ""}>Submit</button>
  ${duplicates ? '<button id="duplicate">Submit claim</button>' : ""}
  </form></main><script>(()=>{
    window.submitClicks=0;window.declarationClicks=0;window.linkClicks=0;
    document.querySelectorAll('button').forEach(button=>button.onclick=event=>{window.submitClicks++;${navigate ? "" : "event.preventDefault();"}});
    document.querySelectorAll('a').forEach(link=>link.onclick=event=>{event.preventDefault();window.linkClicks++;});
    document.querySelectorAll('input[type=checkbox]').forEach(box=>box.onclick=()=>window.declarationClicks++);
    const custom=document.querySelector('[role=checkbox]');if(custom)custom.onclick=()=>window.declarationClicks++;
  })();</script></body></html>`;
const server = http.createServer(async (req, res) => {
  for await (const _chunk of req) { /* Consume local synthetic form body. */ }
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (req.url === "/same") {
    sameLoads++;
    res.end(sameLoads === 1 ? '<h1>Old document</h1>' : '<h1>New document</h1>');
  } else if (req.url === "/declaration-navigation") {
    declarationLoads++;
    const content = fixture({ checked: declarationLoads > 1 });
    res.end(content.replace('</body>', `<script>window.__declarationNavigationSettled=${declarationLoads > 1};document.getElementById("declaration").onchange=()=>location.assign("/declaration-navigation")</script></body>`));
  } else if (req.url === "/receipt" && req.method === "POST") {
    receiptPosts++;
    res.end('<h1>Your claim has been submitted</h1><p>Claim reference number: GA-TEST-123456</p>');
  } else res.end(fixture());
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const externalRequests = [];
  await context.route("**/*", route => {
    if (route.request().url().startsWith(origin + "/")) return route.continue();
    externalRequests.push(route.request().url()); return route.abort();
  });
  let page = await context.newPage();
  beforeEach = async () => { await page.close(); page = await context.newPage(); };
  const counts = () => page.evaluate(() => ({ submit: window.submitClicks, declaration: window.declarationClicks, links: window.linkClicks }));
  await test("only the declaration checkbox is checked", async () => {
    await page.setContent(fixture()); const result = await selectGreaterAngliaCustomerDeclaration(page);
    assert.equal(result.checked, true); assert.deepEqual(await counts(), { submit: 0, declaration: 1, links: 0 });
  });
  await test("an already-checked declaration is preserved", async () => {
    await page.setContent(fixture({ checked: true })); await selectGreaterAngliaCustomerDeclaration(page);
    assert.deepEqual(await counts(), { submit: 0, declaration: 0, links: 0 });
  });
  await test("a Submit button near declaration text is not a declaration", async () => {
    await page.setContent(fixture({ declaration: "none", links: false }));
    await assert.rejects(selectGreaterAngliaCustomerDeclaration(page), { code: "declaration_not_found" });
    assert.deepEqual(await counts(), { submit: 0, declaration: 0, links: 0 });
  });
  await test("an I-agree link cannot substitute for a checkbox", async () => {
    await page.setContent(fixture({ declaration: "none" }));
    await assert.rejects(selectGreaterAngliaCustomerDeclaration(page), { code: "declaration_not_found" });
    assert.deepEqual(await counts(), { submit: 0, declaration: 0, links: 0 });
  });
  await test("a label pointing at Submit is not a checkbox", async () => {
    await page.setContent(fixture({ declaration: "fake-label" }));
    await assert.rejects(selectGreaterAngliaCustomerDeclaration(page), { code: "declaration_not_found" }); assert.equal((await counts()).submit, 0);
  });
  await test("ambiguous checkboxes are not selected", async () => {
    await page.setContent(fixture({ declaration: "ambiguous" }));
    await assert.rejects(selectGreaterAngliaCustomerDeclaration(page), { code: "declaration_ambiguous" }); assert.equal((await counts()).declaration, 0);
  });
  await test("a custom checkbox role cannot disguise an action", async () => {
    await page.setContent(fixture({ declaration: "custom" }));
    await assert.rejects(selectGreaterAngliaCustomerDeclaration(page), { code: "declaration_not_native_checkbox" }); assert.equal((await counts()).declaration, 0);
  });
  await test("a hidden declaration is not force-clicked", async () => {
    await page.setContent(fixture({ declaration: "hidden" }));
    await assert.rejects(selectGreaterAngliaCustomerDeclaration(page), { code: "declaration_not_found" }); assert.equal((await counts()).declaration, 0);
  });
  await test("passive verification cannot check the declaration", async () => {
    await page.setContent(fixture());
    await assert.rejects(verifyGreaterAngliaCustomerDeclaration(page), { code: "declaration_not_checked" }); assert.equal((await counts()).declaration, 0);
  });
  await test("an explicit declaration bound to Submit is verified without clicking", async () => {
    await page.setContent(fixture({ declaration: "submit-bound" }));
    const result = await selectGreaterAngliaCustomerDeclaration(page);
    assert.equal(result.method, "declaration_on_final_submit"); assert.equal(result.actionTaken, false);
    assert.deepEqual(await counts(), { submit: 0, declaration: 0, links: 0 });
  });
  await test("the agreeing wording used by the portal is recognised passively", async () => {
    await page.setContent(fixture({ declaration: "submit-bound-variant" }));
    assert.equal((await selectGreaterAngliaCustomerDeclaration(page)).method, "declaration_on_final_submit"); assert.equal((await counts()).submit, 0);
  });
  await test("a declaration text node does not depend on wrapper markup", async () => {
    await page.setContent(fixture({ declaration: "submit-bound-unwrapped" }));
    assert.equal((await selectGreaterAngliaCustomerDeclaration(page)).method, "declaration_on_final_submit"); assert.equal((await counts()).submit, 0);
  });
  await test("hidden declaration wording is not accepted", async () => {
    await page.setContent(fixture({ declaration: "hidden-submit-bound" }));
    await assert.rejects(selectGreaterAngliaCustomerDeclaration(page), { code: "declaration_not_found" }); assert.equal((await counts()).submit, 0);
  });
  await test("unrelated consent wording cannot authorise a rail declaration", async () => {
    await page.setContent(fixture({ declaration: "irrelevant-submit-bound" }));
    await assert.rejects(selectGreaterAngliaCustomerDeclaration(page), { code: "declaration_not_found" }); assert.equal((await counts()).submit, 0);
  });
  await test("same-URL navigation retries a destroyed read context", async () => {
    await page.goto(origin + "/same", { waitUntil: "domcontentloaded" }); let reads = 0;
    let signal;
    const started = new Promise(resolve => { signal = resolve; });
    await page.exposeFunction("__signalReadStarted", () => signal());
    const reading = readGreaterAngliaPortalPage(page, () => {
      reads++;
      return page.evaluate(async () => {
        if (document.querySelector("h1").textContent === "Old document") {
          await window.__signalReadStarted();
          await new Promise(() => {}); // Navigation destroys this pending read.
        }
        return document.querySelector("h1").textContent;
      });
    });
    await started;
    await page.reload({ waitUntil: "domcontentloaded" });
    const heading = await reading;
    assert.equal(heading, "New document"); assert.ok(reads >= 2); assert.equal(sameLoads, 2);
  });
  await test("a navigating checkbox action is not repeated", async () => {
    await page.goto(origin + "/declaration-navigation", { waitUntil: "domcontentloaded" });
    try { await selectGreaterAngliaCustomerDeclaration(page); }
    catch (error) { assert.equal(error.code, "declaration_result_uncertain"); }
    await page.waitForFunction(() => window.__declarationNavigationSettled === true, null, { timeout: 5000 });
    assert.equal(declarationLoads, 2); assert.equal(receiptPosts, 0);
  });

  const source = (await readFile(new URL("../src/operators/greaterAngliaPlaywrightExecutor.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const deps = {
    readGreaterAngliaPortalPage, selectGreaterAngliaCustomerDeclaration, verifyGreaterAngliaCustomerDeclaration,
    createPortalBlocker: (_ctx, message, details) => Object.assign(new Error(message), { code: details.code }),
    addStep: (ctx, name, details) => ctx.steps.push({ name, ...details }),
    setCheckpoint: (ctx, checkpoint) => { ctx.checkpoint = checkpoint; },
    getFinalSubmissionGateFailures: () => [], hasPassengerTravelConfirmation: () => true,
    verifyFinalReviewAddress: async (_page, ctx) => { ctx.addressChecks = (ctx.addressChecks || 0) + 1; },
  };
  function actual(name) {
    const marker = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
    assert.ok(marker, `Missing production function ${name}`);
    return vm.runInNewContext(`(${source.slice(marker.index, source.indexOf("\n}", marker.index) + 2)})`, deps);
  }
  deps.inspectPortalPanel = actual("inspectPortalPanel");
  deps.inspectFinalSubmitBoundary = actual("inspectFinalSubmitBoundary");
  const prepare = actual("prepareConfirmationStep"), submit = actual("clickFinalSubmitSafely"), reference = actual("extractOperatorReference");
  const plan = { confirmationStep: { customerDeclarationRequired: true, fraudWarningMustBeShownBeforeSubmit: true } };
  const runContext = enabled => ({ finalSubmitEnabled: enabled, steps: [] });
  await test("production final-review path selects a checkbox without submitting", async () => {
    await page.setContent(fixture()); const ctx = runContext(true);
    const result = await prepare(page, ctx, plan, {}, true);
    assert.equal(result.stage, "confirmation"); assert.equal(ctx.addressChecks, 1); assert.equal(ctx.customerDeclarationVerified, true);
    assert.equal((await counts()).submit, 0);
  });
  await test("production final-review path blocks the legacy Submit-as-declaration case", async () => {
    await page.setContent(fixture({ declaration: "none", links: false })); const ctx = runContext(true);
    await assert.rejects(prepare(page, ctx, plan, {}, true), { code: "declaration_not_found" });
    assert.equal((await counts()).submit, 0); assert.equal(ctx.finalSubmitAttempted, undefined);
  });
  await test("dry-run final review does not select a declaration", async () => {
    await page.setContent(fixture()); const ctx = runContext(false);
    assert.equal((await prepare(page, ctx, plan, {}, false)).stage, "confirmation");
    assert.deepEqual(await counts(), { submit: 0, declaration: 0, links: 0 });
  });
  await test("an unexpected receipt stops before any final action", async () => {
    await page.setContent('<h1>Your claim has been submitted</h1><p>Claim reference number: GA-OLD-123456</p>'); const ctx = runContext(true);
    await assert.rejects(prepare(page, ctx, plan, {}, true), { code: "unexpected_receipt_before_final_submit" }); assert.equal(ctx.finalSubmitAttempted, undefined);
  });
  await test("a declaration unchecked after review blocks submission", async () => {
    await page.setContent(fixture()); const ctx = runContext(true); await prepare(page, ctx, plan, {}, true);
    await page.locator("#declaration").uncheck();
    await assert.rejects(submit(page, ctx), { code: "declaration_not_checked" }); assert.equal((await counts()).submit, 0);
  });
  await test("a changed declaration method is held before submission", async () => {
    await page.setContent(fixture({ declaration: "submit-bound" })); const ctx = runContext(true); await prepare(page, ctx, plan, {}, true);
    await page.setContent(fixture({ declaration: "native", checked: true }));
    await assert.rejects(submit(page, ctx), { code: "declaration_changed" }); assert.equal((await counts()).submit, 0);
  });
  await test("duplicate final controls block submission", async () => {
    await page.setContent(fixture({ checked: true, duplicates: true })); const ctx = { ...runContext(true), customerDeclarationRequired: true, customerDeclarationVerified: true };
    await assert.rejects(submit(page, ctx), { code: "final_submit_boundary_changed" }); assert.equal((await counts()).submit, 0);
  });
  await test("the global lock prevents a final click", async () => {
    await page.setContent(fixture({ checked: true }));
    await assert.rejects(submit(page, runContext(false)), { code: "final_submit_safety_lock" }); assert.equal((await counts()).submit, 0);
  });
  await test("an authorised final action navigates once and exposes a receipt", async () => {
    await page.setContent(fixture({ navigate: true })); const ctx = runContext(true);
    await prepare(page, ctx, plan, {}, true); await submit(page, ctx);
    assert.equal(receiptPosts, 1); assert.equal(ctx.finalSubmitAttempted, true);
    assert.equal(await reference(page), "GA-TEST-123456");
    await assert.rejects(submit(page, ctx), { code: "final_submit_already_attempted" }); assert.equal(receiptPosts, 1);
  });
  await test("a Submit-bound declaration reaches only the protected final click", async () => {
    await page.setContent(fixture({ declaration: "submit-bound", navigate: true })); const ctx = runContext(true);
    await prepare(page, ctx, plan, {}, true);
    assert.equal(ctx.customerDeclarationMethod, "declaration_on_final_submit"); assert.equal((await counts()).submit, 0);
    assert.ok(ctx.steps.some(step => step.name === "Verify declaration on final Submit"));
    const before = receiptPosts; await submit(page, ctx);
    assert.equal(receiptPosts, before + 1); assert.equal(await reference(page), "GA-TEST-123456");
    await assert.rejects(submit(page, ctx), { code: "final_submit_already_attempted" }); assert.equal(receiptPosts, before + 1);
  });
  assert.equal(externalRequests.length, 0, "A fixture tried to contact an external service");
  console.log(`Greater Anglia confirmation Chromium fixtures: ${passed} checks passed. No operator portal was contacted.`);
} finally {
  if (browser) await browser.close();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}
