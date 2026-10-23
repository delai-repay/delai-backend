import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  selectAndVerifyGreaterAngliaAddress, verifyGreaterAngliaReviewAddress,
  inspectGreaterAngliaAddressDom,
} from "../src/operators/greaterAngliaAddressVerification.js";

// Real Chromium, local synthetic HTML only: no operator portal or customer data.
const passenger = { addressLine1: "11 Example Road", addressLine2: "Test Village",
  townCity: "Testford", postcode: "AB1 2CD" };
const correct = "11 Example Road Test Village Testford AB1 2CD";
const wrong = "1 Example Road Test Village Testford AB1 2CD";
const style = '<style>body{font:16px sans-serif}select,button,[role=combobox],[role=option]{padding:12px;display:block} [hidden]{display:none!important}</style>';
let count = 0;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const native = ({ broken = false, exact = true, lookup = false } = {}) => style + `
    <label for="title">Title</label><select id="title"><option>Mr</option></select>
    <label for="postal">Postcode</label><input id="postal" value="AB1 2CD">
    ${lookup ? '<button id="find">Find address</button>' : ''}
    <label for="address">Address</label><select id="address" ${lookup ? 'hidden' : ''}>
      <option value="1">${wrong}</option>
      ${exact ? `<option value="11">${correct}</option>` : ''}
      <option value="111">111 Example Road Test Village Testford AB1 2CD</option>
    </select>
    <div>${correct}</div><span>${correct}</span>
    <button id="continue">Continue</button><button id="submit">Submit</button>
    <script>
      window.forbiddenClicks=0;
      for(const id of ['continue','submit']) document.getElementById(id).onclick=()=>window.forbiddenClicks++;
      ${broken ? "document.getElementById('address').onchange=event=>event.target.value='1';" : ''}
      ${lookup ? "document.getElementById('find').onclick=()=>setTimeout(()=>document.getElementById('address').hidden=false,250);" : ''}
    </script>`;

  await page.setContent(native());
  const nativeProof = await selectAndVerifyGreaterAngliaAddress(page, passenger);
  assert.equal(await page.locator("#address").inputValue(), "11");
  assert.equal(nativeProof.ok, true);
  assert.equal(await page.evaluate(() => window.forbiddenClicks), 0);
  count++;

  await page.setContent(native({ broken: true }));
  await assert.rejects(selectAndVerifyGreaterAngliaAddress(page, passenger, { timeoutMs: 500 }),
    { code: "address_selection_mismatch" });
  assert.equal(await page.locator("#address").inputValue(), "1");
  count++;

  await page.setContent(native({ exact: false }));
  // A matching generic container elsewhere must never be clicked as an option.
  await assert.rejects(selectAndVerifyGreaterAngliaAddress(page, passenger), { code: "address_option_not_found" });
  assert.equal(await page.evaluate(() => window.forbiddenClicks), 0);
  count++;

  await page.setContent(native({ lookup: true }));
  const lookupProof = await selectAndVerifyGreaterAngliaAddress(page, passenger);
  assert.equal(lookupProof.ok, true);
  assert.equal(await page.locator("#address").inputValue(), "11");
  count++;

  const custom = (broken = false) => style + `
    <label for="postal">Postcode</label><input id="postal" value="AB1 2CD">
    <div id="combo" role="combobox" tabindex="0" aria-label="Select address"
      aria-expanded="false" aria-controls="postal-options">
      <span class="mat-mdc-select-value-text">${wrong}</span>
    </div>
    <div id="postal-options" role="listbox" hidden>
      <div role="option" data-key="1">${wrong}</div>
      <div role="option" data-key="11">${correct}</div>
    </div>
    <div>${correct}</div>
    <script>
      (()=>{
      const combo=document.getElementById('combo'), list=document.getElementById('postal-options');
      combo.onclick=()=>{list.hidden=false;combo.setAttribute('aria-expanded','true')};
      for(const option of list.children) option.onclick=()=>{
        ${broken ? '' : "combo.querySelector('span').textContent=option.textContent;"}
        combo.setAttribute('aria-expanded','false');list.hidden=true;
      };
      })();
    </script>`;
  await page.setContent(custom());
  const customProof = await selectAndVerifyGreaterAngliaAddress(page, passenger);
  assert.equal(customProof.method, "exact_custom_option");
  assert.equal(await page.locator("#combo").innerText(), correct);
  count++;
  await page.setContent(custom(true));
  await assert.rejects(selectAndVerifyGreaterAngliaAddress(page, passenger, { timeoutMs: 500 }),
    { code: "address_selection_mismatch" });
  count++;

  // Structure observed on the live Tracsis picker, with entirely synthetic data.
  // It has plain div results, no combobox role, and CSS-hidden bound fields.
  const tracsis = ({ broken = false, exact = true, duplicate = false, splitFirstLine = false } = {}) => style + `
    <div id="postcode">
      <label>Post Code</label><input id="txtPostCode" title="Post Code" value="AB1 2CD">
      <div class="address-form" id="autosuggest-form" hidden>
        <div tabindex="1" class="item getFullAddressByID" data-type="Address" data-id="fixture-1">${wrong}</div>
        ${exact ? `<div tabindex="1" class="item getFullAddressByID" data-type="Address" data-id="fixture-11">${correct}</div>` : ''}
        ${duplicate ? `<div tabindex="1" class="item getFullAddressByID" data-type="Address" data-id="fixture-11-copy">${correct}</div>` : ''}
        <div tabindex="1" class="item getFullAddressByID" data-type="Address" data-id="fixture-111">111 Example Road Test Village Testford AB1 2CD</div>
        <a id="manualAddressEnter" class="button address-manual-btn">My address is not listed. let me enter manually</a>
      </div>
      <div id="address-form" style="display:none">
        <input id="txtAddress1" value="1 Example Road">
        <input id="txtAddress2" value="Test Village">
        <input id="txtCityTown" value="Testford">
        <select id="txtcountryname"><option value="">Country</option><option value="United Kingdom (UK)">United Kingdom (UK)</option></select>
      </div>
      <div id="addressDiscription"></div>
    </div>
    <div class="item getFullAddressByID" data-id="unrelated" data-type="Address">${correct}</div>
    <div>${correct}</div><button id="continue">Continue</button><button id="submit">Submit</button>
    <script>
    (()=>{
      window.forbiddenClicks=0;window.lookupKeys=0;window.lookupBlurred=false;
      const postal=document.getElementById('txtPostCode'), results=document.getElementById('autosuggest-form');
      for(const id of ['continue','submit','manualAddressEnter']) document.getElementById(id).onclick=()=>window.forbiddenClicks++;
      postal.onkeyup=()=>{window.lookupKeys++};
      postal.onblur=()=>{window.lookupBlurred=true;if(window.lookupKeys) setTimeout(()=>results.hidden=false,250)};
      for(const option of results.querySelectorAll('.getFullAddressByID')) option.onclick=()=>{
        const chosen=option.textContent;results.replaceChildren();
        document.getElementById('addressDiscription').textContent=chosen;
        setTimeout(()=>{
          document.getElementById('txtAddress1').value=${broken ? "'1 Example Road'" : splitFirstLine ? "'11'" : "'11 Example Road'"};
          document.getElementById('txtAddress2').value=${splitFirstLine ? "'Example Road Test Village'" : "'Test Village'"};
          document.getElementById('txtcountryname').value='United Kingdom (UK)';
        },250);
      };
    })();
    </script>`;

  await page.setContent(tracsis());
  const tracsisProof = await selectAndVerifyGreaterAngliaAddress(page, passenger);
  assert.equal(tracsisProof.ok, true);
  assert.equal(tracsisProof.method, "exact_tracsis_address_option");
  assert.equal(tracsisProof.postalSource, "bound_form_fields");
  assert.ok(await page.evaluate(() => window.lookupKeys > 0 && window.lookupBlurred));
  assert.equal(await page.locator("#txtAddress1").inputValue(), "11 Example Road");
  assert.equal(await page.locator("#txtAddress1").isVisible(), false);
  assert.equal(await page.evaluate(() => window.forbiddenClicks), 0);
  count++;

  await page.setContent(tracsis({ broken: true }));
  await assert.rejects(selectAndVerifyGreaterAngliaAddress(page, passenger, { timeoutMs: 1200 }),
    { code: "address_selection_mismatch" });
  assert.equal(await page.locator("#txtAddress1").inputValue(), "1 Example Road");
  assert.equal(await page.locator("#addressDiscription").innerText(), correct);
  assert.equal(await page.evaluate(() => window.forbiddenClicks), 0);
  count++;

  await page.setContent(tracsis({ exact: false }));
  await assert.rejects(selectAndVerifyGreaterAngliaAddress(page, passenger, { timeoutMs: 1200 }), { code: "address_option_not_found" });
  assert.equal(await page.evaluate(() => window.forbiddenClicks), 0);
  count++;

  await page.setContent(tracsis({ duplicate: true }));
  await assert.rejects(selectAndVerifyGreaterAngliaAddress(page, passenger), { code: "address_option_ambiguous" });
  count++;

  await page.setContent(tracsis({ splitFirstLine: true }));
  await assert.rejects(selectAndVerifyGreaterAngliaAddress(page, passenger, { timeoutMs: 1200 }),
    { code: "address_selection_mismatch" });
  count++;

  const review = (address) => style + `
    <h2>Confirm your claim</h2>
    <div class="row">
      <section class="column"><div><h3>Your Details</h3><button aria-label="Edit personal details">Edit</button></div>
        <div class="card"><p>Example Passenger</p><p>example@example.invalid</p><p>${address}</p></div>
      </section>
      <section class="column"><h3>Ticket details</h3><p>${correct}</p></section>
    </div>
    <section><h3>Compensation Details</h3><p>BACS</p></section>
    <div hidden><h3>Your Details</h3><p>${correct}</p></div>`;
  await page.setContent(review(wrong));
  const inspected = await page.evaluate(inspectGreaterAngliaAddressDom, { mode: "review" });
  assert.equal(inspected.regionCount, 1);
  await assert.rejects(verifyGreaterAngliaReviewAddress(page, passenger, nativeProof),
    { code: "final_review_address_mismatch" });
  count++;

  await page.setContent(review("11 Example Road Test Village Testford United Kingdom (UK)"));
  const verified = await verifyGreaterAngliaReviewAddress(page, passenger, nativeProof);
  assert.equal(verified.ok, true);
  assert.equal(verified.postalSource, "verified_personal_details");
  assert.equal((await verifyGreaterAngliaReviewAddress(page, passenger, tracsisProof)).ok, true);
  await assert.rejects(verifyGreaterAngliaReviewAddress(page, passenger, null), { code: "final_review_address_mismatch" });
  count++;

  await page.setContent(review(correct.replace("AB1 2CD", "AB1 2CE")));
  await assert.rejects(verifyGreaterAngliaReviewAddress(page, passenger, nativeProof),
    { code: "final_review_address_mismatch" });
  count++;
  console.log(`Greater Anglia Chromium address fixtures: ${count} checks passed. No portal was contacted.`);
} finally { await browser.close(); }
