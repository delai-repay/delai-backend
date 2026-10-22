// Address selection is deliberately separate from the portal's submission gates.
// This module never clicks Continue, a declaration, or Submit.
const CONTROL_ATTR = "data-delai-address-control";
const OPTION_ATTR = "data-delai-address-option";
const LOOKUP_ATTR = "data-delai-address-lookup";

export function normaliseAddressText(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function postalCodes(text) {
  return [...String(text || "").toUpperCase().matchAll(
    /\b(?:GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/g
  )].map(([code]) => code.replace(/\s+/g, ""));
}

function expectedKey(passenger) {
  return [passenger.addressLine1, passenger.addressLine2, passenger.townCity,
    String(passenger.postcode || "").replace(/\s+/g, "")]
    .map(normaliseAddressText).join("|");
}

function containsPhrase(text, phrase) {
  return !phrase || (` ${text} `).includes(` ${phrase} `);
}

export function matchAddressText(text, passenger) {
  const actual = normaliseAddressText(text);
  const first = normaliseAddressText(passenger.addressLine1);
  const second = normaliseAddressText(passenger.addressLine2);
  const town = normaliseAddressText(passenger.townCity);
  const expectedPostal = String(passenger.postcode || "").toUpperCase().replace(/\s+/g, "");
  const foundPostal = postalCodes(text);
  // Prefix + word boundaries distinguish 1, 11, 111, 11A, flats, and ranges.
  const lineMatched = Boolean(first) && (actual === first || actual.startsWith(`${first} `));
  return {
    lineMatched,
    localityMatched: containsPhrase(actual, second) && containsPhrase(actual, town),
    postalPresent: foundPostal.length > 0,
    postalMatched: Boolean(expectedPostal) && foundPostal.length > 0 &&
      foundPostal.every((code) => code === expectedPostal),
  };
}

function addressError(code, message, diagnostic = {}) {
  const error = new Error(message);
  error.code = code;
  // Only non-personal evidence belongs in logs/audit diagnostics.
  error.diagnostic = { ...diagnostic, ok: false };
  return error;
}

export function chooseExactAddressOption(options, passenger) {
  const matches = options.filter((option) => {
    if (option.disabled || (option.kind === "native" && !option.value)) return false;
    const check = matchAddressText(option.text, passenger);
    return check.lineMatched && check.localityMatched && check.postalMatched;
  });
  if (matches.length !== 1) {
    throw addressError(matches.length ? "address_option_ambiguous" : "address_option_not_found",
      matches.length
        ? "Greater Anglia returned more than one exact address option. Address selection needs review."
        : "Greater Anglia did not return an exact match for the saved address and postcode.",
      { exactMatchCount: matches.length, optionCount: options.length });
  }
  return matches[0];
}

// Playwright serializes this function into the browser. Keep it self-contained:
// no imports/closures, no synthetic events, and no access to framework internals.
export function inspectGreaterAngliaAddressDom({ mode, controlToken = null }) {
  const controlAttr = "data-delai-address-control";
  const optionAttr = "data-delai-address-option";
  const lookupAttr = "data-delai-address-lookup";
  const optionSelector = 'mat-option, [role="option"], .mat-option, .mat-mdc-option, ' +
    '.ng-option, .select2-results__option, [role="listbox"] li, .ui-autocomplete .ui-menu-item';
  const comboSelector = 'mat-select, [role="combobox"], .mat-select, .mat-mdc-select, .ng-select, .select2-container';
  const text = (element) => String(element?.innerText || element?.textContent || "")
    .replace(/\s+/g, " ").trim();
  const visible = (element) => {
    if (!element || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" &&
      Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const enabled = (element) => !element.disabled && element.getAttribute("aria-disabled") !== "true";
  const label = (element) => {
    const referenced = String(element.getAttribute("aria-labelledby") || "").split(/\s+/)
      .map((id) => text(document.getElementById(id)));
    const container = element.closest("mat-form-field, .form-group, .form-field, .field");
    return [element.getAttribute("aria-label"), element.getAttribute("name"),
      element.getAttribute("id"), element.getAttribute("formcontrolname"),
      ...Array.from(element.labels || []).map(text), ...referenced,
      ...Array.from(container?.querySelectorAll("mat-label, label, legend") || []).map(text)]
      .filter(Boolean).join(" ");
  };
  const postalInputs = () => Array.from(document.querySelectorAll('input:not([type="hidden"])'))
    .filter(visible).filter((element) => /post\s*code|postcode|postal\s*code/i.test(label(element)))
    .map((element) => String(element.value || "").trim()).filter(Boolean);

  if (mode === "selected") {
    const control = document.querySelector(`[${controlAttr}="${controlToken}"]`);
    if (!control || !visible(control)) return { found: false };
    if (control.tagName === "SELECT") {
      const selected = Array.from(control.selectedOptions || []);
      return { found: true, closed: true, selectedCount: selected.length,
        selectedText: selected.length === 1 ? text(selected[0]) : "", postalValues: postalInputs() };
    }
    const expanded = control.getAttribute("aria-expanded") === "true" ||
      Boolean(control.querySelector('[aria-expanded="true"]'));
    const owns = [control.getAttribute("aria-controls"), control.getAttribute("aria-owns")]
      .filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
    const openList = owns.some((id) => visible(document.getElementById(id))) ||
      Array.from(control.querySelectorAll(optionSelector)).some(visible);
    // A popup's list text is not evidence of the selected value.
    if (expanded || openList) return { found: true, closed: false };
    const valueElement = control.querySelector(
      '.mat-select-value-text, .mat-mdc-select-value-text, .mat-select-value, ' +
      '.mat-mdc-select-value, .ng-value-label, .select2-selection__rendered'
    );
    const selectedText = control.matches("input") ? String(control.value || "")
      : text(valueElement || control);
    return { found: true, closed: true, selectedCount: 1, selectedText, postalValues: postalInputs() };
  }

  if (mode === "review") {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,[role=heading],p,span,div,strong"))
      .filter(visible).filter((element) => /^your\s+details\s*:?$/i.test(text(element)));
    const regions = [];
    for (const heading of headings) {
      let region = heading.parentElement;
      for (let depth = 0; region && depth < 5; depth++, region = region.parentElement) {
        const regionText = text(region);
        // Stop before reaching the adjacent Ticket/Compensation cards or page body.
        if (/ticket\s+details|compensation\s+details|confirm\s+your\s+claim/i.test(regionText)) break;
        if (regionText.replace(/your\s+details\s*:?/i, "").trim().length < 20) continue;
        if (region.querySelector("input, select, mat-select, [role=combobox]")) continue;
        regions.push(region);
        break;
      }
    }
    // The same heading can have several wrappers; retain only the smallest region.
    const unique = [...new Set(regions)].filter((region, _index, all) =>
      !all.some((other) => other !== region && region.contains(other)));
    if (unique.length !== 1) return { regionCount: unique.length, lines: [] };
    const region = unique[0];
    const blocks = Array.from(region.querySelectorAll("p,li,dd,address"))
      .filter(visible).map(text).filter(Boolean);
    const lines = [...new Set([...blocks, ...String(region.innerText || "").split(/\n+/)
      .map((line) => line.trim()).filter(Boolean)])];
    return { regionCount: 1, lines };
  }

  if (mode !== "scan") throw new Error("Unknown address inspection mode");
  const options = [];
  const controls = [];
  const lookups = [];
  const native = Array.from(document.querySelectorAll("select")).filter(visible).filter(enabled);
  native.forEach((control, index) => {
    const token = `native-${index}`;
    control.setAttribute(controlAttr, token);
    controls.push({ token, kind: "native" });
    Array.from(control.options || []).forEach((option, optionIndex) => {
      options.push({ kind: "native", controlToken: token, index: optionIndex,
        text: text(option), value: option.value,
        disabled: option.disabled || option.parentElement?.disabled === true });
    });
  });
  // Keep only the outer semantic control; never treat arbitrary div/span as an option.
  const combos = Array.from(document.querySelectorAll(comboSelector)).filter(visible).filter(enabled)
    .filter((element) => !element.parentElement?.closest(comboSelector))
    .filter((element) => /address/i.test(`${label(element)} ${element.matches("input") ? "" : text(element)}`));
  combos.forEach((control, index) => {
    const token = `combo-${index}`;
    control.setAttribute(controlAttr, token);
    controls.push({ token, kind: "custom" });
  });
  const customOptions = Array.from(document.querySelectorAll(optionSelector)).filter(visible).filter(enabled)
    .filter((element) => !element.parentElement?.closest(optionSelector));
  customOptions.forEach((option, index) => {
    const token = `option-${index}`;
    option.setAttribute(optionAttr, token);
    const owners = combos.filter((control) => {
      const ids = [control.getAttribute("aria-controls"), control.getAttribute("aria-owns")]
        .filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
      return control.contains(option) || ids.some((id) => document.getElementById(id)?.contains(option));
    });
    const owner = owners.length === 1 ? owners[0] : combos.length === 1 ? combos[0] : null;
    options.push({ kind: "custom", token, controlToken: owner?.getAttribute(controlAttr) || null,
      text: text(option), disabled: false });
  });
  Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a, [role="button"]'))
    .filter(visible).filter(enabled).forEach((element) => {
      const name = [text(element), element.value, label(element)].filter(Boolean).join(" ");
      if (!/find\s*(?:my\s*)?address|look\s*up\s*address|lookup\s*address|search\s*address|get\s*address|select\s*address/i.test(name)) return;
      if (/continue|next|submit|cookie|consent|agree/i.test(name)) return;
      const token = `lookup-${lookups.length}`;
      element.setAttribute(lookupAttr, token);
      lookups.push({ token });
    });
  return { options, controls, lookups };
}

export function assessSelectedAddress(snapshot, passenger) {
  const check = matchAddressText(snapshot.selectedText, passenger);
  const postalValues = snapshot.postalValues || [];
  const expectedPostal = String(passenger.postcode || "").toUpperCase().replace(/\s+/g, "");
  const formPostalMatched = postalValues.length === 1 &&
    postalValues[0].toUpperCase().replace(/\s+/g, "") === expectedPostal;
  const postalConflict = postalValues.some((value) =>
    value.toUpperCase().replace(/\s+/g, "") !== expectedPostal);
  const postalMatched = (check.postalPresent ? check.postalMatched : formPostalMatched) && !postalConflict;
  return { ok: snapshot.found === true && snapshot.closed === true && snapshot.selectedCount === 1 &&
      check.lineMatched && check.localityMatched && postalMatched,
    lineMatched: check.lineMatched, localityMatched: check.localityMatched, postalMatched,
    closed: snapshot.closed === true,
    postalSource: check.postalPresent ? "selected_value" : "personal_details_field" };
}

export function assessReviewAddress(snapshot, passenger, proof) {
  const proofValid = proof?.version === 1 && proof.expectedKey === expectedKey(passenger) &&
    proof.lineMatched === true && proof.postalMatched === true && proof.ok === true;
  const lines = snapshot.lines || [];
  const matches = lines.map((line) => matchAddressText(line, passenger));
  const lineMatched = matches.some((check) => check.lineMatched && check.localityMatched);
  const visiblePostal = lines.flatMap(postalCodes);
  const expectedPostal = String(passenger.postcode || "").toUpperCase().replace(/\s+/g, "");
  const postalMatched = visiblePostal.length > 0
    ? visiblePostal.every((code) => code === expectedPostal) : proofValid;
  // Reject an additional address for the same street even if the correct line appears too.
  const street = normaliseAddressText(passenger.addressLine1).replace(/^\d+[a-z]?\s+/, "");
  const conflictingLine = lines.some((line) => {
    const normalized = normaliseAddressText(line);
    return /^\d/.test(normalized) && containsPhrase(normalized, street) &&
      !matchAddressText(line, passenger).lineMatched;
  });
  return { ok: snapshot.regionCount === 1 && proofValid && lineMatched && postalMatched && !conflictingLine,
    regionCount: snapshot.regionCount, lineMatched, postalMatched, proofValid, conflictingLine,
    postalSource: visiblePostal.length > 0 ? "final_review" : "verified_personal_details" };
}

async function pause(page) { await page.waitForTimeout(200); }

export async function selectAndVerifyGreaterAngliaAddress(page, passenger, { timeoutMs = 10000 } = {}) {
  if (!normaliseAddressText(passenger.addressLine1) || postalCodes(passenger.postcode).length !== 1) {
    throw addressError("address_required_inputs_missing",
      "Greater Anglia needs a saved address line 1 and a valid UK postcode before address selection.");
  }
  let scan = await page.evaluate(inspectGreaterAngliaAddressDom, { mode: "scan" });
  if (!scan.options.some((option) => postalCodes(option.text).length > 0) && scan.lookups.length) {
    if (scan.lookups.length !== 1) throw addressError("address_lookup_ambiguous",
      "Greater Anglia returned more than one postcode lookup control.");
    await page.locator(`[${LOOKUP_ATTR}="${scan.lookups[0].token}"]`).click({ timeout: timeoutMs });
  }
  const deadline = Date.now() + timeoutMs;
  let opened = false;
  while (Date.now() < deadline) {
    scan = await page.evaluate(inspectGreaterAngliaAddressDom, { mode: "scan" });
    // A title select's options do not mean the asynchronous address results are ready.
    const hasPostalOptions = scan.options.some((option) => postalCodes(option.text).length > 0);
    if (hasPostalOptions) break;
    const combos = scan.controls.filter((control) => control.kind === "custom");
    if (!opened && combos.length === 1) {
      await page.locator(`[${CONTROL_ATTR}="${combos[0].token}"]`).click({ timeout: timeoutMs });
      opened = true;
    } else if (combos.length > 1) {
      throw addressError("address_control_ambiguous", "Greater Anglia returned more than one address control.");
    }
    await pause(page);
  }
  const choice = chooseExactAddressOption(scan.options, passenger);
  if (!choice.controlToken) throw addressError("address_control_unverified",
    "Greater Anglia's address option could not be linked to a selection control.");
  if (choice.kind === "native") {
    await page.locator(`[${CONTROL_ATTR}="${choice.controlToken}"]`)
      .selectOption({ index: choice.index }, { timeout: timeoutMs });
  } else {
    await page.locator(`[${OPTION_ATTR}="${choice.token}"]`).click({ timeout: timeoutMs });
  }
  // Verify actual bound state twice after rendering. The clicked label is never proof.
  const readDeadline = Date.now() + Math.min(timeoutMs, 4000);
  let consecutive = 0;
  let check = {};
  do {
    await pause(page);
    const snapshot = await page.evaluate(inspectGreaterAngliaAddressDom,
      { mode: "selected", controlToken: choice.controlToken });
    check = assessSelectedAddress(snapshot, passenger);
    consecutive = check.ok ? consecutive + 1 : 0;
    if (consecutive >= 2) return { ...check, version: 1,
      expectedKey: expectedKey(passenger), method: choice.kind === "native" ? "exact_native_option" : "exact_custom_option" };
  } while (Date.now() < readDeadline);
  throw addressError("address_selection_mismatch",
    "Greater Anglia's selected address does not match the saved address and postcode. The claim was stopped before continuing.", check);
}

export async function verifyGreaterAngliaReviewAddress(page, passenger, proof) {
  const snapshot = await page.evaluate(inspectGreaterAngliaAddressDom, { mode: "review" });
  const check = assessReviewAddress(snapshot, passenger, proof);
  if (!check.ok) throw addressError("final_review_address_mismatch",
    "Greater Anglia's final-review address could not be verified against the saved address. The claim has not been sent.", check);
  return check;
}
