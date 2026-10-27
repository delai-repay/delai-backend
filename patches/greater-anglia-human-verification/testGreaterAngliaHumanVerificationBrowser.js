import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import vm from "node:vm";
import { chromium } from "playwright";
import { readGreaterAngliaPortalPage, selectGreaterAngliaCustomerDeclaration, verifyGreaterAngliaCustomerDeclaration } from "../src/operators/greaterAngliaConfirmationNavigation.js";

// These are synthetic localhost fixtures, not real CAPTCHA challenges. No
// solver, external challenge, token generation or operator endpoint is used.
let passed = 0, posts = 0, origin, browser;
const external = [];
const server = http.createServer(async (req, res) => {
  for await (const _chunk of req) {}
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (req.method === "POST" && req.url === "/receipt") {
    posts++; res.end('<h1>Your claim has been submitted</h1><p>Claim reference number: GA-LOCAL-123456</p>');
  } else res.end('<h1>Local fixture</h1>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;
const source = (await readFile(new URL("../src/operators/greaterAngliaPlaywrightExecutor.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const widget = '<div class="g-recaptcha" data-sitekey="SYNTHETIC-LOCAL-FIXTURE" style="width:300px;height:75px;border:1px solid"><label><input type="checkbox" id="captcha"> I\'m not a robot</label></div>';
const fixture = ({ captcha = "visible", disabled = false, navigate = false } = {}) => `<!doctype html><html><head><style>
body{font:16px sans-serif;padding:24px}button{display:block;padding:12px}iframe{width:300px;height:75px}
</style></head><body><main><h1>Confirm your claim</h1>
<p>Fraud Act warning: knowingly submitting a fraudulent claim could lead to prosecution.</p>
<p>By clicking the submit button, you are agreeing to the terms and conditions of the Delay Repay scheme.</p>
<form method="post" action="${origin}/receipt">
${captcha === "visible" ? widget : ""}
${captcha === "loading" ? '<div class="g-recaptcha" data-sitekey="SYNTHETIC-LOCAL-FIXTURE"></div>' : ""}
${captcha === "iframe" ? '<iframe title="reCAPTCHA" srcdoc="<p>Local fixture only</p>"></iframe>' : ""}
${captcha === "hidden" ? '<div hidden>' + widget + '</div>' : ""}
${captcha === "transparent" ? '<div style="opacity:0">' + widget + '</div>' : ""}
${captcha === "error" ? '<p>Terms &amp; Conditions - Captcha error</p>' : ""}
${captcha === "error-only" ? '<p>Please complete the reCAPTCHA</p>' : ""}
${captcha === "hidden-error" ? '<p hidden>Terms &amp; Conditions - Captcha error</p>' : ""}
${captcha === "faq" ? '<p>What is a CAPTCHA? Visit the help page for more information.</p>' : ""}
<textarea name="g-recaptcha-response" id="response-fixture" hidden></textarea>
<button ${disabled ? "disabled" : ""}>Submit claim</button></form></main>
<script>window.submitClicks=0;window.captchaInteractions=0;window.tokenReads=0;
document.querySelector('button').addEventListener('click',event=>{window.submitClicks++;${navigate ? "" : "event.preventDefault();"}});
document.querySelectorAll('.g-recaptcha input').forEach(box=>box.addEventListener('click',()=>window.captchaInteractions++));
Object.defineProperty(document.getElementById('response-fixture'),'value',{get(){window.tokenReads++;throw new Error('The guard must not read response tokens');}});
</script></body></html>`;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route("**/*", route => {
    if (route.request().url().startsWith(origin + "/")) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const deps = {
    readGreaterAngliaPortalPage, selectGreaterAngliaCustomerDeclaration, verifyGreaterAngliaCustomerDeclaration,
    createPortalBlocker: (_ctx, message, details) => Object.assign(new Error(message), details),
    addStep: (ctx, name, details) => ctx.steps.push({ name, ...details }),
    setCheckpoint: (ctx, checkpoint) => { ctx.checkpoint = checkpoint; },
    getFinalSubmissionGateFailures: () => [], hasPassengerTravelConfirmation: () => true,
    verifyFinalReviewAddress: async () => {},
  };
  function actual(name) {
    const start = new RegExp(`^(?:async )?function ${name}\\(`, "m").exec(source);
    assert.ok(start, `Missing production function ${name}`);
    return vm.runInNewContext(`(${source.slice(start.index, source.indexOf("\n}", start.index) + 2)})`, deps);
  }
  deps.inspectPortalPanel = actual("inspectPortalPanel");
  deps.inspectFinalSubmitBoundary = actual("inspectFinalSubmitBoundary");
  deps.requireGreaterAngliaHumanVerificationAbsent = actual("requireGreaterAngliaHumanVerificationAbsent");
  const prepare = actual("prepareConfirmationStep"), submit = actual("clickFinalSubmitSafely");
  const plan = { confirmationStep: { customerDeclarationRequired: true, fraudWarningMustBeShownBeforeSubmit: true } };
  const context = enabled => ({ finalSubmitEnabled: enabled, steps: [] });
  const counts = () => page.evaluate(() => ({ submit: window.submitClicks, captcha: window.captchaInteractions, tokenReads: window.tokenReads }));
  async function test(name, run) {
    try { await page.goto(origin, { waitUntil: "domcontentloaded" }); await run(); passed++; }
    catch (error) { throw new Error(name, { cause: error }); }
  }
  for (const [name, options] of [
    ["enabled Submit with a visible challenge", {}],
    ["disabled Submit with a visible challenge", { disabled: true }],
    ["configured challenge whose iframe has not loaded", { captcha: "loading" }],
    ["a titled CAPTCHA iframe", { captcha: "iframe" }],
    ["the exact post-submit CAPTCHA error seen in the screenshots", { captcha: "error" }],
    ["an explicit request to complete verification", { captcha: "error-only" }],
  ]) {
    await test(name, async () => {
      await page.setContent(fixture(options)); const ctx = context(true), before = posts;
      await assert.rejects(prepare(page, ctx, plan, {}, true), { code: "operator_human_verification_required" });
      assert.equal(ctx.checkpoint, "operator_human_verification_required");
      assert.equal(ctx.finalSubmitAttempted, undefined); assert.equal(posts, before);
      assert.deepEqual(await counts(), { submit: 0, captcha: 0, tokenReads: 0 });
    });
  }
  await test("paused preparation detects the exception before calling it ready", async () => {
    await page.setContent(fixture()); const ctx = context(false);
    await assert.rejects(prepare(page, ctx, plan, {}, false), { code: "operator_human_verification_required" });
    assert.deepEqual(await counts(), { submit: 0, captcha: 0, tokenReads: 0 });
  });
  await test("the final click boundary independently rejects a challenge", async () => {
    await page.setContent(fixture()); const ctx = { ...context(true), customerDeclarationRequired: true, customerDeclarationVerified: true };
    await assert.rejects(submit(page, ctx), { code: "operator_human_verification_required" });
    assert.equal(ctx.finalSubmitAttempted, undefined); assert.deepEqual(await counts(), { submit: 0, captcha: 0, tokenReads: 0 });
  });
  await test("a challenge inserted after preparation is detected before final click", async () => {
    await page.setContent(fixture({ captcha: "none" })); const ctx = context(true);
    await prepare(page, ctx, plan, {}, true);
    await page.locator("form").evaluate((form, html) => form.insertAdjacentHTML("afterbegin", html), widget);
    await assert.rejects(submit(page, ctx), { code: "operator_human_verification_required" });
    assert.equal(ctx.finalSubmitAttempted, undefined); assert.equal((await counts()).submit, 0);
  });
  await test("a challenge appearing during declaration verification blocks click intent", async () => {
    await page.setContent(fixture({ captcha: "none" })); const ctx = context(true);
    await prepare(page, ctx, plan, {}, true);
    deps.verifyGreaterAngliaCustomerDeclaration = async (...args) => {
      const result = await verifyGreaterAngliaCustomerDeclaration(...args);
      await page.locator("form").evaluate((form, html) => form.insertAdjacentHTML("afterbegin", html), widget);
      return result;
    };
    try {
      await assert.rejects(submit(page, ctx), { code: "operator_human_verification_required" });
      assert.equal(ctx.finalSubmitAttempted, undefined); assert.equal((await counts()).submit, 0);
    } finally { deps.verifyGreaterAngliaCustomerDeclaration = verifyGreaterAngliaCustomerDeclaration; }
  });
  for (const captcha of ["hidden", "transparent", "hidden-error", "faq"]) {
    await test(`inactive template or unrelated wording is not a challenge: ${captcha}`, async () => {
      await page.setContent(fixture({ captcha })); const ctx = context(false);
      assert.equal((await prepare(page, ctx, plan, {}, false)).stage, "confirmation");
      assert.equal(ctx.humanVerification, undefined); assert.deepEqual(await counts(), { submit: 0, captcha: 0, tokenReads: 0 });
    });
  }
  await test("a CAPTCHA-free authorised fixture retains the single protected submission", async () => {
    await page.setContent(fixture({ captcha: "none", navigate: true })); const ctx = context(true), before = posts;
    await prepare(page, ctx, plan, {}, true); await submit(page, ctx);
    assert.equal(posts, before + 1); assert.equal(ctx.finalSubmitAttempted, true);
    await assert.rejects(submit(page, ctx), { code: "final_submit_already_attempted" }); assert.equal(posts, before + 1);
  });
  assert.equal(external.length, 0, "A local fixture attempted an external request");
  console.log(`Greater Anglia human-verification Chromium fixtures: ${passed} checks passed. No CAPTCHA or operator service was contacted.`);
} finally {
  if (browser) await browser.close();
  server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
}
