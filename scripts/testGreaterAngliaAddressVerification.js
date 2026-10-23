import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock } from "node:test";
import {
  matchAddressText, chooseExactAddressOption, assessSelectedAddress, assessReviewAddress,
  selectAndVerifyGreaterAngliaAddress, verifyGreaterAngliaReviewAddress,
} from "../src/operators/greaterAngliaAddressVerification.js";

// Synthetic fixtures only. Never put a customer's address or screenshot in tests.
const passenger = { addressLine1: "11 Example Road", addressLine2: "Test Village",
  townCity: "Testford", postcode: "AB1 2CD" };
const correct = "11 Example Road, Test Village, Testford, AB1 2CD";
const wrong = "1 Example Road, Test Village, Testford, AB1 2CD";
const nativeOption = (text, index = 0) => ({ kind: "native", controlToken: "native-0", text, value: String(index + 1), index });
let count = 0;
let fixtureTimeMs = 0;
async function test(name, fn) {
  try { await fn(); count++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
}

class FixturePage {
  constructor({ kind = "native", bindingWorks = true, needsLookup = false } = {}) {
    Object.assign(this, { kind, bindingWorks, needsLookup, lookedUp: !needsLookup,
      opened: false, selectedText: wrong, actions: [], reads: 0,
      lookupTyped: kind !== "tracsis", resultsVisible: false });
  }
  async evaluate(_browserFunction, payload) {
    if (payload.mode === "selected") {
      this.reads++;
      return { found: true, closed: this.kind === "tracsis" ? !this.resultsVisible : !this.opened, selectedCount: 1,
        selectedText: this.selectedText, postalValues: [passenger.postcode],
        ...(this.kind === "tracsis" ? { boundFieldReadback: true,
          boundFirstLine: this.selectedText.split(",")[0] } : {}) };
    }
    if (payload.mode === "review") return { regionCount: 1, lines: [this.reviewText || this.selectedText] };
    const title = { kind: "native", controlToken: "native-0", text: "Mr", value: "mr", index: 0 };
    return {
      // A title dropdown is present even before postcode lookup finishes.
      options: [title, ...(!this.lookedUp || !this.lookupTyped || (this.kind === "custom" && !this.opened) ? [] :
        [wrong, correct].map((text, index) => this.kind === "native"
          ? { ...nativeOption(text, index), controlToken: "native-1" }
          : this.kind === "tracsis"
            ? { kind: "tracsis", controlToken: "tracsis-postcode", token: `tracsis-option-${index}`, text }
            : { kind: "custom", controlToken: "combo-0", token: `option-${index}`, text }))],
      controls: [{ token: "native-0", kind: "native" }, ...(this.lookedUp
        ? [{ token: this.kind === "native" ? "native-1" : this.kind === "tracsis" ? "tracsis-postcode" : "combo-0", kind: this.kind }] : [])],
      lookups: this.needsLookup && !this.lookedUp ? [{ token: "lookup-0" }] : [],
    };
  }
  locator(selector) {
    return {
      fill: async (value) => {
        assert.equal(selector, "#postcode #txtPostCode");
        assert.equal(value, "");
        this.actions.push(["fill", selector, value]);
        this.lookupTyped = false;
      },
      pressSequentially: async (value) => {
        assert.equal(selector, "#postcode #txtPostCode");
        assert.equal(value, passenger.postcode);
        this.actions.push(["pressSequentially", selector, value]);
      },
      press: async (key) => {
        assert.equal(selector, "#postcode #txtPostCode");
        assert.equal(key, "Tab");
        this.actions.push(["press", selector, key]);
        this.lookupTyped = true;
        this.resultsVisible = true;
      },
      click: async () => {
        this.actions.push(["click", selector]);
        if (selector.includes("lookup-0")) this.lookedUp = true;
        else if (selector.includes("combo-0")) this.opened = true;
        else if (selector.includes("option-1")) {
          this.opened = false;
          this.resultsVisible = false;
          if (this.bindingWorks) this.selectedText = correct;
        } else throw new Error("Unexpected or unsafe click");
      },
      selectOption: async ({ index }) => {
        this.actions.push(["selectOption", selector, index]);
        assert.equal(index, 1, "must choose house 11, not the first address");
        if (this.bindingWorks) this.selectedText = correct;
      },
    };
  }
  async waitForTimeout(milliseconds) {
    // Advance the same clock used by the production polling loop. No OS timers:
    // Windows can round a 1 ms sleep beyond the old test's entire 15 ms budget.
    fixtureTimeMs += milliseconds;
  }
}

const originalNow = Date.now;
const clockMock = mock.method(Date, "now", () => fixtureTimeMs);
try {
  await test("whole house/street and postcode match", () => {
    assert.equal(matchAddressText(correct, passenger).lineMatched, true);
    assert.equal(matchAddressText(correct.replace("AB1 2CD", "ab12cd"), passenger).postalMatched, true);
    for (const number of ["1", "111", "11A", "11-13", "Flat 2, 11"]) {
      assert.equal(matchAddressText(correct.replace(/^11/, number), passenger).lineMatched, false, number);
    }
    assert.equal(matchAddressText(correct.replace("Example Road", "Example Roadway"), passenger).lineMatched, false);
    assert.equal(matchAddressText(correct.replace("AB1 2CD", "AB1 2CE"), passenger).postalMatched, false);
    assert.equal(matchAddressText(correct.replace("Test Village", "Other Village"), passenger).localityMatched, false);
  });

  await test("select exact option despite ordering", () => {
    const chosen = chooseExactAddressOption([nativeOption(wrong), nativeOption(correct, 1), nativeOption(correct.replace(/^11/, "111"), 2)], passenger);
    assert.equal(chosen.index, 1);
  });
  await test("near match and ambiguous options block", () => {
    assert.throws(() => chooseExactAddressOption([nativeOption(wrong)], passenger), { code: "address_option_not_found" });
    assert.throws(() => chooseExactAddressOption([nativeOption(correct), nativeOption(correct, 1)], passenger), { code: "address_option_ambiguous" });
    assert.throws(() => chooseExactAddressOption([{ ...nativeOption(correct), disabled: true }], passenger), { code: "address_option_not_found" });
  });
  await test("lookup occurs even with existing title options", async () => {
    const page = new FixturePage({ needsLookup: true });
    const proof = await selectAndVerifyGreaterAngliaAddress(page, passenger);
    assert.equal(proof.ok, true);
    assert.equal(page.actions[0][0], "click");
    assert.match(page.actions[0][1], /lookup-0/);
    assert.ok(page.reads >= 2);
  });
  await test("custom control opens then clicks a semantic option", async () => {
    const page = new FixturePage({ kind: "custom" });
    const proof = await selectAndVerifyGreaterAngliaAddress(page, passenger);
    assert.equal(proof.method, "exact_custom_option");
    assert.match(page.actions[0][1], /combo-0/);
    assert.match(page.actions[1][1], /option-1/);
  });
  await test("clicked label cannot hide wrong bound selection", async () => {
    for (const kind of ["native", "custom", "tracsis"]) {
      const page = new FixturePage({ kind, bindingWorks: false });
      await assert.rejects(selectAndVerifyGreaterAngliaAddress(page, passenger, { timeoutMs: 1000 }),
        { code: "address_selection_mismatch" });
      assert.ok(page.reads >= 2, "must reach repeated bound-state checks, not stop during option lookup");
      assert.ok(page.actions.some(([action, selector]) => kind === "native"
        ? action === "selectOption" : action === "click" && selector.includes("option-1")),
      "must actually select the exact option before checking a broken binding");
    }
  });
  await test("Tracsis lookup receives keyboard events and verifies stored fields", async () => {
    const page = new FixturePage({ kind: "tracsis" });
    const proof = await selectAndVerifyGreaterAngliaAddress(page, passenger);
    assert.equal(proof.method, "exact_tracsis_address_option");
    assert.equal(proof.postalSource, "bound_form_fields");
    assert.deepEqual(page.actions.slice(0, 3).map(([action]) => action), ["fill", "pressSequentially", "press"]);
    assert.match(page.actions[3][1], /tracsis-option-1/);
    assert.ok(page.reads >= 2);
  });
  await test("Tracsis first field must match even if combined text looks correct", () => {
    const snapshot = { found: true, closed: true, selectedCount: 1,
      selectedText: correct, postalValues: [passenger.postcode], boundFieldReadback: true };
    assert.equal(assessSelectedAddress({ ...snapshot, boundFirstLine: "11" }, passenger).ok, false);
    assert.equal(assessSelectedAddress({ ...snapshot, boundFirstLine: "1 Example Road" }, passenger).ok, false);
    assert.equal(assessSelectedAddress({ ...snapshot, boundFirstLine: "11 Example Road" }, passenger).ok, true);
  });
  await test("open popup text and conflicting postcode are not selection proof", () => {
    const state = { found: true, closed: true, selectedCount: 1, selectedText: correct, postalValues: [passenger.postcode] };
    assert.equal(assessSelectedAddress({ ...state, closed: false }, passenger).ok, false);
    assert.equal(assessSelectedAddress({ ...state, selectedText: correct.replace("AB1 2CD", "AB1 2CE") }, passenger).ok, false);
    assert.equal(assessSelectedAddress({ ...state, postalValues: ["AB1 2CE"] }, passenger).ok, false);
    assert.equal(assessSelectedAddress({ ...state, selectedText: "11 Example Road Test Village Testford", postalValues: [] }, passenger).ok, false);
  });

  const page = new FixturePage();
  const proof = await selectAndVerifyGreaterAngliaAddress(page, passenger);
  await test("final review checks house number even after successful selection", async () => {
    page.reviewText = wrong;
    await assert.rejects(verifyGreaterAngliaReviewAddress(page, passenger, proof), { code: "final_review_address_mismatch" });
    page.reviewText = correct;
    assert.equal((await verifyGreaterAngliaReviewAddress(page, passenger, proof)).ok, true);
  });
  await test("omitted review postcode requires earlier verified selection for same details", () => {
    const review = { regionCount: 1, lines: ["11 Example Road Test Village Testford United Kingdom (UK)"] };
    assert.equal(assessReviewAddress(review, passenger, proof).ok, true);
    assert.equal(assessReviewAddress(review, passenger, null).ok, false);
    assert.equal(assessReviewAddress(review, { ...passenger, postcode: "AB1 2CE" }, proof).ok, false);
    assert.equal(assessReviewAddress({ ...review, regionCount: 2 }, passenger, proof).ok, false);
    assert.equal(assessReviewAddress({ regionCount: 1, lines: [correct, wrong] }, passenger, proof).ok, false);
    assert.equal(assessReviewAddress({ regionCount: 1, lines: [correct.replace("AB1 2CD", "AB1 2CE")] }, passenger, proof).ok, false);
  });
  await test("diagnostics do not expose address text", async () => {
    try { chooseExactAddressOption([nativeOption(wrong)], passenger); }
    catch (error) {
      assert.doesNotMatch(JSON.stringify({ message: error.message, diagnostic: error.diagnostic }), /Example Road|AB1 2CD/);
    }
    assert.doesNotMatch(JSON.stringify(assessReviewAddress({ regionCount: 1, lines: [wrong] }, passenger, proof)), /Example Road|AB1 2CD/);
  });

  const executorSource = readFileSync(new URL("../src/operators/greaterAngliaPlaywrightExecutor.js", import.meta.url), "utf8");
  await test("review guard executes before dry-run success", async () => {
    const start = executorSource.indexOf("async function prepareConfirmationStep(");
    const end = executorSource.indexOf("async function clickFinalSubmitSafely(", start);
    assert.ok(start >= 0 && end > start);
    const events = [];
    const compile = new Function("inspectPortalPanel", "setCheckpoint", "inspectFinalSubmitBoundary", "addStep",
      "verifyFinalReviewAddress", "createPortalBlocker", "getFinalSubmissionGateFailures",
      executorSource.slice(start, end) + "\nreturn prepareConfirmationStep;");
    const prepare = compile(async () => ({ stage: "confirmation" }), () => {},
      async () => ({ fraudWarningVisible: true }), () => {},
      async () => { events.push("verify"); throw Object.assign(new Error("mismatch"), { code: "final_review_address_mismatch" }); },
      () => new Error("blocked"), () => { throw new Error("must not reach live gates in a dry run"); });
    await assert.rejects(prepare({}, { steps: [] }, { confirmationStep: {} }, {}, false), { code: "final_review_address_mismatch" });
    assert.deepEqual(events, ["verify"]);
  });
  await test("address guard precedes the final click and safety lock is retained", () => {
    assert.match(executorSource, /await verifyFinalReviewAddress\(page, runContext, portalSubmissionPlan\);\s*await clickFinalSubmitSafely/);
    assert.match(executorSource, /if \(!finalSubmitEnabled\) \{[\s\S]*source: "greater_anglia_playwright_executor_safety_locked"/);
    assert.match(executorSource, /const gateFailures = getFinalSubmissionGateFailures\(\)/);
    assert.match(executorSource, /!hasPassengerTravelConfirmation\(plan, mappedSubmission\)/);
    assert.match(executorSource, /confirmation\.customerDeclarationRequired === true/);
  });
} finally {
  clockMock.mock.restore();
}
assert.equal(Date.now, originalNow, "fixture clock must be restored even when a check fails");
console.log(`Greater Anglia address verification: ${count} checks passed.`);
