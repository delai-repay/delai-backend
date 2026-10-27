import { setTimeout as delay } from "node:timers/promises";

// This retry is restricted to passive reads. Never pass a click, fill, check,
// declaration selection or final submission operation as `read`.
export function isGreaterAngliaNavigationContextError(error) {
  return /execution context was destroyed|cannot find (?:execution )?context with (?:specified )?id|cannot find execution context/i.test(String(error?.message || ""));
}

export async function readGreaterAngliaPortalPage(page, read, {
  timeoutMs = 5000,
  maxAttempts = 12,
  now = Date.now,
  pause = delay,
} = {}) {
  if (typeof read !== "function") throw new TypeError("A passive portal read is required.");
  const startedAt = now();
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (!isGreaterAngliaNavigationContextError(error) || page.isClosed?.() || attempt >= maxAttempts || now() - startedAt >= timeoutMs) throw error;
      let remaining = timeoutMs - (now() - startedAt);
      if (remaining <= 0) throw error;
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: Math.min(1000, remaining) });
      } catch (waitError) {
        if (page.isClosed?.()) throw error;
        if (waitError?.name !== "TimeoutError" && !isGreaterAngliaNavigationContextError(waitError)) throw waitError;
      }
      remaining = timeoutMs - (now() - startedAt);
      if (remaining <= 0) throw error;
      await pause(Math.min(100, remaining));
    }
  }
}

function declarationError(code, message) {
  return Object.assign(new Error(message), { code });
}

// A separate declaration action is a native, accessible checkbox only. An
// explicit declaration bound to final Submit is verified without an action.
async function nativeDeclarationCheckbox(page) {
  const checkbox = page.getByRole("checkbox", { name: /\b(?:i\s+(?:confirm|declare|agree)|declaration)\b/i });
  const count = await readGreaterAngliaPortalPage(page, () => checkbox.count());
  if (count > 1) throw declarationError("declaration_ambiguous", "Greater Anglia returned more than one declaration checkbox. The declaration needs review.");
  if (count === 0) return null;
  const native = await readGreaterAngliaPortalPage(page, () => checkbox.evaluate(element => element.tagName === "INPUT" && element.type === "checkbox"));
  if (!native) throw declarationError("declaration_not_native_checkbox", "Greater Anglia's declaration control needs review.");
  return checkbox;
}

async function verifyDeclarationOnFinalSubmit(page) {
  const evidence = await readGreaterAngliaPortalPage(page, () => page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const clean = value => String(value || "").replace(/\s+/g, " ").trim();
    const body = clean(document.body?.innerText);
    // The current public GA form binds its declaration to the one Submit
    // action. Recognise that explicit statement, never a generic nearby label.
    const statement = /\bby\s+(?:clicking|selecting|pressing)\s+(?:the\s+)?submit(?:\s+button)?\s*,?\s*(?:you\s+)?(?:are\s+)?(?:agree(?:ing)?|confirm(?:ing)?|declar(?:e|ing))\b/i;
    const clauses = body.match(/\bby\s+(?:clicking|selecting|pressing)\b[^.!?]{0,400}/gi) || [];
    const explicitStatement = clauses.some(text => statement.test(text) && /\bterms\s+(?:and|&)\s+conditions\b/i.test(text) && /\bdelay\s+repay\b/i.test(text));
    const finalControls = Array.from(document.querySelectorAll('button,input[type="submit"],input[type="button"],a,[role="button"]'))
      .filter(visible).filter(element => /^(submit|submit claim|submit my claim|confirm and submit|complete claim)$/i.test(clean(element.innerText || element.textContent || element.value || element.getAttribute("aria-label"))));
    return {
      explicitStatement,
      finalReviewVisible: /confirm your claim|review (?:your|the) claim/i.test(body),
      fraudWarningVisible: /fraud act|fraudulent|false or misleading|prosecution/i.test(body),
      singleFinalControl: finalControls.length === 1,
    };
  }));
  if (!evidence.explicitStatement || !evidence.finalReviewVisible || !evidence.fraudWarningVisible || !evidence.singleFinalControl) {
    throw declarationError("declaration_not_found", "Greater Anglia's declaration could not be identified safely. The declaration needs review.");
  }
  return { ok: true, method: "declaration_on_final_submit", actionTaken: false, checked: null };
}

export async function verifyGreaterAngliaCustomerDeclaration(page, { expectedMethod } = {}) {
  const checkbox = await nativeDeclarationCheckbox(page);
  let result;
  if (!checkbox) result = await verifyDeclarationOnFinalSubmit(page);
  else {
    const checked = await readGreaterAngliaPortalPage(page, () => checkbox.isChecked());
    if (checked !== true) throw declarationError("declaration_not_checked", "Greater Anglia's declaration checkbox was not checked.");
    result = { ok: true, method: "native_declaration_checkbox", checked: true };
  }
  if (expectedMethod && result.method !== expectedMethod) throw declarationError("declaration_changed", "Greater Anglia's declaration changed after review. The attempt needs review.");
  return result;
}

export async function selectGreaterAngliaCustomerDeclaration(page) {
  const checkbox = await nativeDeclarationCheckbox(page);
  if (!checkbox) return verifyDeclarationOnFinalSubmit(page);
  const alreadyChecked = await readGreaterAngliaPortalPage(page, () => checkbox.isChecked());
  if (!alreadyChecked) {
    // One action only. A failure could occur after its side effect. Do not retry.
    try {
      await checkbox.setChecked(true, { timeout: 5000 });
    } catch (error) {
      throw declarationError("declaration_result_uncertain", "Greater Anglia's declaration action could not be confirmed. The submission attempt needs review.");
    }
  }
  const checked = await readGreaterAngliaPortalPage(page, () => checkbox.isChecked());
  if (checked !== true) throw declarationError("declaration_not_checked", "Greater Anglia's declaration checkbox was not checked.");
  return { ok: true, method: "native_declaration_checkbox", checked: true, alreadyChecked };
}
