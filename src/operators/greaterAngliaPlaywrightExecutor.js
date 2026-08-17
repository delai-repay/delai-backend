import path from "node:path";
import { mkdir } from "node:fs/promises";

const DEFAULT_TIMEOUT_MS = 45000;
const GREATER_ANGLIA_SMARTCARD_LENGTH = 18;
const GREATER_ANGLIA_TICKET_PANEL_LIMIT = 28;
const GREATER_ANGLIA_COMPENSATION_PANEL_LIMIT = 14;

function cleanText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const cleanedValue = String(value).trim();
  return cleanedValue || null;
}

function getBooleanEnv(name, fallback = false) {
  const value = process.env[name];

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
}

function getNumberEnv(name, fallback) {
  const value = Number(process.env[name]);

  if (Number.isNaN(value) || value <= 0) {
    return fallback;
  }

  return value;
}

function createSafeRunId(prefix = "greater-anglia") {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);

  const randomPart = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${timestamp}-${randomPart}`;
}

function getScreenshotDir() {
  return (
    cleanText(process.env.GREATER_ANGLIA_SCREENSHOT_DIR) ||
    "./operator-run-artifacts"
  );
}

function validateGreaterAngliaPreflight(portalSubmissionPlan) {
  const ticket = portalSubmissionPlan?.ticketStep || {};
  const ticketFormat = cleanText(ticket.ticketFormat)?.toLowerCase() || "";

  if (!/smart\s*card/.test(ticketFormat)) {
    return { valid: true, issues: [] };
  }

  const smartcardNumber = cleanText(ticket.smartcardNumber);

  if (!smartcardNumber) {
    return {
      valid: false,
      issues: [
        {
          code: "missing_smartcard_number",
          field: "smartcard number",
          message: "A Greater Anglia Smartcard Number is required.",
        },
      ],
    };
  }

  if (smartcardNumber.length !== GREATER_ANGLIA_SMARTCARD_LENGTH) {
    return {
      valid: false,
      issues: [
        {
          code: "invalid_smartcard_number",
          field: "smartcard number",
          message: `Greater Anglia requires an ${GREATER_ANGLIA_SMARTCARD_LENGTH}-character Smartcard Number. The mapped value has ${smartcardNumber.length} characters.`,
          expectedLength: GREATER_ANGLIA_SMARTCARD_LENGTH,
          actualLength: smartcardNumber.length,
        },
      ],
    };
  }

  return { valid: true, issues: [] };
}

function getScreenshotMode() {
  const mode = cleanText(process.env.GREATER_ANGLIA_SCREENSHOT_MODE)?.toLowerCase();
  return ["all", "milestones", "errors"].includes(mode) ? mode : "milestones";
}

function shouldCaptureScreenshot(name) {
  const mode = getScreenshotMode();
  const normalisedName = String(name || "").toLowerCase();

  if (mode === "all") {
    return true;
  }

  if (mode === "errors") {
    return /error|failed|blocked|missing|safety_lock/.test(normalisedName);
  }

  return new Set([
    "01_portal_opened",
    "02_after_personal_details_step",
    "03_after_journey_step",
    "04_after_ticket_step",
    "05_before_final_confirmation",
    "05_safety_lock_final_submit_disabled",
    "06_after_final_submit",
    "99_error_state",
  ]).has(normalisedName);
}

function addLog(runContext, message, details = {}) {
  const logEntry = {
    message,
    at: new Date().toISOString(),
    ...details,
  };

  runContext.logs.push(logEntry);
  console.log(`[Greater Anglia Playwright] ${message}`, details);
}

function normaliseDateForInput(value) {
  const cleanValue = cleanText(value);

  if (!cleanValue) {
    return null;
  }

  const isoMatch = cleanValue.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const date = new Date(cleanValue);

  if (Number.isNaN(date.getTime())) {
    return cleanValue;
  }

  return date.toISOString().split("T")[0];
}

function createRunContext({ mappedSubmission = null, finalSubmitEnabled = false } = {}) {
  return {
    runId: createSafeRunId(),
    executorVersion: "greater-anglia-end-to-end-3.2",
    operator: "Greater Anglia",
    operatorKey: "greater_anglia",
    claimId: mappedSubmission?.claim?.id || null,
    detectedDelayId: mappedSubmission?.claim?.detectedDelayId || null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    finalSubmitEnabled: finalSubmitEnabled === true,
    screenshotMode: getScreenshotMode(),
    screenshotDir: getScreenshotDir(),
    checkpoint: "initialising",
    diagnostic: null,
    steps: [],
    warnings: [],
    screenshots: [],
    logs: [],
  };
}

function addStep(runContext, name, details = {}) {
  runContext.steps.push({
    name,
    at: new Date().toISOString(),
    ...details,
  });
}

function addWarning(runContext, warning, details = {}) {
  runContext.warnings.push({
    warning,
    at: new Date().toISOString(),
    ...details,
  });
}

async function loadPlaywright() {
  try {
    const playwright = await import("playwright");
    return playwright;
  } catch (error) {
    throw new Error(
      "Playwright is not installed. Run: npm install playwright && npx playwright install chromium"
    );
  }
}

async function captureScreenshot(page, runContext, name) {
  if (!getBooleanEnv("GREATER_ANGLIA_CAPTURE_SCREENSHOTS", true)) {
    return null;
  }

  if (!shouldCaptureScreenshot(name)) {
    return null;
  }

  if (!page) {
    addWarning(runContext, "Screenshot could not be captured because no page exists yet.", {
      name,
    });

    return null;
  }

  const screenshotDir = runContext.screenshotDir || getScreenshotDir();
  const safeName = name.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
  const filePath = path.join(
    screenshotDir,
    `${runContext.runId}-${safeName}.png`
  );

  try {
    await mkdir(screenshotDir, { recursive: true });
    const fullPage =
      getBooleanEnv("GREATER_ANGLIA_SCREENSHOT_FULL_PAGE", false) ||
      /error|failed|blocked|missing/.test(safeName);

    await page.screenshot({ path: filePath, fullPage });

    const screenshotRecord = {
      name,
      path: filePath,
      url: typeof page.url === "function" ? page.url() : null,
      capturedAt: new Date().toISOString(),
    };

    runContext.screenshots.push(screenshotRecord);
    addLog(runContext, "Screenshot saved.", screenshotRecord);

    return filePath;
  } catch (error) {
    addWarning(runContext, "Screenshot could not be captured.", {
      name,
      path: filePath,
      error: error.message,
    });

    return null;
  }
}

async function tryLocatorAction(runContext, label, candidates, action) {
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const locator = candidate.locator();
      const count = await locator.count();

      if (count === 0) {
        continue;
      }

      const first = locator.first();
      await first.waitFor({ state: "visible", timeout: 2500 });
      await action(first, candidate);

      addStep(runContext, label, {
        selector: candidate.description,
      });

      return true;
    } catch (error) {
      lastError = error;
    }
  }

  addWarning(runContext, `${label} could not be completed.`, {
    lastError: lastError?.message || null,
    tried: candidates.map((candidate) => candidate.description),
  });

  return false;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldCandidates(page, labelRegex, cssSelectors = [], placeholderRegexes = []) {
  return [
    {
      description: `label ${labelRegex}`,
      locator: () => page.getByLabel(labelRegex),
    },
    ...placeholderRegexes.map((placeholderRegex) => ({
      description: `placeholder ${placeholderRegex}`,
      locator: () => page.getByPlaceholder(placeholderRegex),
    })),
    ...cssSelectors.map((selector) => ({
      description: selector,
      locator: () => page.locator(selector),
    })),
  ];
}

function labelCandidates(page, labelRegex, cssSelectors = []) {
  return fieldCandidates(page, labelRegex, cssSelectors, []);
}

async function fillField(
  page,
  runContext,
  label,
  value,
  labelRegex,
  cssSelectors = [],
  placeholderRegexes = []
) {
  const cleanValue = cleanText(value);

  if (!cleanValue) {
    addWarning(runContext, `${label} skipped because no value was provided.`);
    return false;
  }

  return tryLocatorAction(
    runContext,
    `Fill ${label}`,
    fieldCandidates(page, labelRegex, cssSelectors, placeholderRegexes),
    async (locator) => {
      await locator.fill(cleanValue);
    }
  );
}

async function selectField(
  page,
  runContext,
  label,
  value,
  labelRegex,
  cssSelectors = [],
  placeholderRegexes = []
) {
  const cleanValue = cleanText(value);

  if (!cleanValue) {
    addWarning(runContext, `${label} skipped because no value was provided.`);
    return false;
  }

  return tryLocatorAction(
    runContext,
    `Select ${label}`,
    fieldCandidates(page, labelRegex, cssSelectors, placeholderRegexes),
    async (locator) => {
      try {
        await locator.selectOption({ label: cleanValue });
        return;
      } catch {
        // Some operator portals style select boxes as custom dropdowns.
        // Fall back to clicking the field and choosing the matching visible option.
      }

      await locator.click();
      const optionRegex = new RegExp(`^${escapeRegExp(cleanValue)}$`, "i");

      const optionCandidates = [
        {
          description: `role option ${optionRegex}`,
          locator: () => page.getByRole("option", { name: optionRegex }),
        },
        {
          description: `text option ${optionRegex}`,
          locator: () => page.getByText(optionRegex),
        },
      ];

      const clicked = await tryLocatorAction(
        runContext,
        `Choose ${label} option`,
        optionCandidates,
        async (optionLocator) => {
          await optionLocator.last().click();
        }
      );

      if (!clicked) {
        throw new Error(`Could not choose ${label} option: ${cleanValue}`);
      }
    }
  );
}

async function getBodyText(page) {
  try {
    return await page.locator("body").innerText({ timeout: 5000 });
  } catch {
    return "";
  }
}

function completeRunContext(runContext) {
  runContext.completedAt = new Date().toISOString();
  const startedAtMs = Date.parse(runContext.startedAt);
  const completedAtMs = Date.parse(runContext.completedAt);
  runContext.durationMs =
    Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
      ? Math.max(0, completedAtMs - startedAtMs)
      : null;
}

function setCheckpoint(runContext, checkpoint, details = {}) {
  runContext.checkpoint = checkpoint;
  addStep(runContext, `Checkpoint: ${checkpoint}`, details);
}

function createPortalBlocker(runContext, message, {
  code = "portal_blocked",
  missingData = [],
  diagnostic = null,
} = {}) {
  if (diagnostic) {
    runContext.diagnostic = diagnostic;
  }

  const error = new Error(message);
  error.code = code;
  error.checkpoint = runContext.checkpoint;
  error.missingData = missingData;
  error.diagnostic = diagnostic;
  return error;
}

async function getPortalFingerprint(page) {
  return page.evaluate(() => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    const text = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, legend, form, main, section")
    )
      .filter(visible)
      .map((element) => String(element.innerText || element.textContent || ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1600);

    const controls = Array.from(
      document.querySelectorAll("input, select, textarea, button, a")
    )
      .filter(visible)
      .map((element) =>
        [
          element.tagName,
          element.id,
          element.getAttribute("name"),
          element.getAttribute("type"),
          element.checked ? "checked" : "",
          String(element.innerText || element.value || "").replace(/\s+/g, " ").trim(),
        ].join(":")
      )
      .join("|")
      .slice(0, 1600);

    return `${text}||${controls}`;
  });
}

async function waitForPortalChange(page, previousFingerprint, timeout = 6500) {
  if (!previousFingerprint) {
    await page.waitForTimeout(250).catch(() => {});
    return true;
  }

  const changed = await page
    .waitForFunction(
      (previous) => {
        function visible(element) {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || 1) !== 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        }

        const text = Array.from(
          document.querySelectorAll("h1, h2, h3, h4, legend, form, main, section")
        )
          .filter(visible)
          .map((element) => String(element.innerText || element.textContent || ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1600);

        const controls = Array.from(
          document.querySelectorAll("input, select, textarea, button, a")
        )
          .filter(visible)
          .map((element) =>
            [
              element.tagName,
              element.id,
              element.getAttribute("name"),
              element.getAttribute("type"),
              element.checked ? "checked" : "",
              String(element.innerText || element.value || "")
                .replace(/\s+/g, " ")
                .trim(),
            ].join(":")
          )
          .join("|")
          .slice(0, 1600);

        return `${text}||${controls}` !== previous;
      },
      previousFingerprint,
      { timeout }
    )
    .then(() => true)
    .catch(() => false);

  await page.waitForTimeout(150).catch(() => {});
  return changed;
}

async function inspectPortalPanel(page) {
  return page.evaluate(() => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    // The Tracsis select skin deliberately gives an unselected .styledSelect
    // opacity: 0 while the real <select> has visibility: hidden. Both controls
    // still occupy the active panel. Treat that layout as active so an empty
    // dropdown can be inspected and filled before its wrapper gains .filled.
    function layoutVisible(element) {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.disabled
      );
    }

    function normalise(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    function visibleSelectWidget(select) {
      if (select.tagName !== "SELECT") return null;

      const wrapper = select.parentElement;
      const candidates = [
        select.nextElementSibling?.matches?.(".styledSelect")
          ? select.nextElementSibling
          : null,
        wrapper?.querySelector?.(":scope > .styledSelect"),
        wrapper?.querySelector?.(
          ':scope > [role="combobox"], :scope > .select2-selection, :scope > .chosen-container, :scope > .bootstrap-select'
        ),
      ].filter(Boolean);

      return candidates.find(layoutVisible) || null;
    }

    function labelFor(element) {
      const parts = [
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
      ];

      if (element.id) {
        document
          .querySelectorAll(`label[for="${CSS.escape(element.id)}"]`)
          .forEach((label) => parts.push(label.innerText || label.textContent));
      }

      let current = element.parentElement;
      for (let depth = 0; depth < 3 && current; depth += 1) {
        const directLabel = current.querySelector(":scope > label, :scope > legend");
        if (directLabel) {
          parts.push(directLabel.innerText || directLabel.textContent);
        }
        current = current.parentElement;
      }

      return normalise(parts.filter(Boolean).join(" "));
    }

    const visibleText = Array.from(
      document.querySelectorAll("main, form, h1, h2, h3, h4, legend, section, article")
    )
      .filter(visible)
      .map((element) => normalise(element.innerText || element.textContent))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const heading = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, legend")
    )
      .filter(visible)
      .map((element) => normalise(element.innerText || element.textContent))
      .find(Boolean) || null;

    const fields = Array.from(
      document.querySelectorAll("input, select, textarea")
    )
      // Tracsis replaces native selects with a visible styledSelect and hides
      // the real form control. Retain the active hidden select so diagnostics,
      // required-field checks and the ticket filler can see its real options.
      .filter(
        (element) =>
          visible(element) ||
          (element.tagName === "SELECT" &&
            (layoutVisible(element) || Boolean(visibleSelectWidget(element))))
      )
      .filter((element) => (element.getAttribute("type") || "").toLowerCase() !== "hidden")
      .map((element) => {
        const type = (element.getAttribute("type") || element.tagName || "").toLowerCase();
        const label = labelFor(element);
        const styledWidget = visibleSelectWidget(element);
        const descriptor = normalise([
          label,
          element.id,
          element.getAttribute("name"),
          element.getAttribute("placeholder"),
          element.getAttribute("aria-label"),
          styledWidget?.innerText || styledWidget?.textContent,
        ].filter(Boolean).join(" "));
        const isChoice = ["radio", "checkbox"].includes(type);
        const valuePresent = isChoice
          ? Boolean(element.checked)
          : Boolean(normalise(element.value));
        const required =
          Boolean(element.required) ||
          element.getAttribute("aria-required") === "true" ||
          /\brequired\b/i.test(`${element.className || ""} ${label}`);

        return {
          tag: element.tagName.toLowerCase(),
          type,
          id: element.id || null,
          name: element.getAttribute("name") || null,
          label: label || null,
          descriptor: descriptor.slice(0, 220),
          placeholder: element.getAttribute("placeholder") || null,
          required,
          valuePresent,
          checked: isChoice ? Boolean(element.checked) : null,
          nativeVisible: visible(element),
          styledWidgetVisible: Boolean(styledWidget),
          selectedText:
            element.tagName === "SELECT"
              ? normalise(element.options?.[element.selectedIndex]?.textContent)
              : null,
          options:
            element.tagName === "SELECT"
              ? Array.from(element.options || []).slice(0, 40).map((option) =>
                  normalise(option.textContent || option.value)
                )
              : null,
        };
      });

    const actions = Array.from(
      document.querySelectorAll(
        'button, a, label, input[type="button"], input[type="submit"], [role="button"], [role="radio"]'
      )
    )
      .filter(visible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        text: normalise(
          element.innerText ||
            element.textContent ||
            element.value ||
            element.getAttribute("aria-label")
        ),
      }))
      .filter((item) => item.text)
      .filter((item) => !/cookie consent|accessibility tools|frequently asked/i.test(item.text))
      .slice(0, 50);

    const validationErrors = Array.from(
      document.querySelectorAll(
        '.error, .field-validation-error, .invalid-feedback, [role="alert"], label.error'
      )
    )
      .filter(visible)
      .map((element) => normalise(element.innerText || element.textContent))
      .filter(Boolean)
      .slice(0, 20);

    const text = visibleText.toLowerCase();
    const hasTicketContinue = actions.some((action) =>
      /^tdnxtbutton\d*$/i.test(action.id || "")
    );
    let stage = "unknown";

    if (
      /thank you|claim (?:has been|was) submitted|claim reference number|your claim reference/.test(text)
    ) {
      stage = "submitted";
    } else if (
      /confirm (?:your|the) claim|review (?:your|the) claim|confirm (?:your|the) details|customer declaration|\bdeclaration\b|submit claim|fraud (?:warning|act)|terms (?:&|and) conditions/.test(text)
    ) {
      stage = "confirmation";
    } else if (
      /select (?:a )?payment|payment method|how would you like.*(?:paid|payment)|bank transfer|\bbacs\b|paypal|rail travel voucher|account holder|account number|sort ?code/.test(text)
    ) {
      stage = "compensation";
    } else if (
      /does your ticket|more than 1 ticket|how many tickets|select ticket format|smartcard details|smart card details|ticket type|ticket price|ticket time|date from|date until|upload.*ticket|ticket reference|could not find your ticket|complete additional ticket details|purchase your ticket today|is this your ticket|check each ticket detail|get your ticket details overnight/.test(text) ||
      hasTicketContinue
    ) {
      stage = "ticket";
    } else if (
      /length of delay|select your journey|boarding station|destination station|date of journey/.test(text)
    ) {
      stage = "journey";
    } else if (/full name|confirm email|post ?code|personal details/.test(text)) {
      stage = "personal";
    }

    return {
      stage,
      heading,
      url: window.location.href,
      visibleTextPreview: visibleText.slice(0, 2400),
      fields,
      actions,
      validationErrors,
    };
  });
}

async function fillVisibleControlByPatterns(
  page,
  runContext,
  label,
  value,
  positivePatterns,
  negativePatterns = [],
  { allowReadOnly = false } = {}
) {
  const cleanValue = cleanText(value);
  if (!cleanValue) {
    return { ok: false, reason: "mapped_value_missing" };
  }

  const result = await page.evaluate(
    ({ value, positivePatterns, negativePatterns, allowReadOnly }) => {
      const positives = positivePatterns.map((pattern) => new RegExp(pattern, "i"));
      const negatives = negativePatterns.map((pattern) => new RegExp(pattern, "i"));

      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled &&
          (!element.readOnly || allowReadOnly)
        );
      }

      function normalise(input) {
        return String(input || "").replace(/\s+/g, " ").trim();
      }

      function contextFor(element) {
        const parts = [
          element.id,
          element.getAttribute("name"),
          element.getAttribute("placeholder"),
          element.getAttribute("aria-label"),
        ];

        if (element.id) {
          document
            .querySelectorAll(`label[for="${CSS.escape(element.id)}"]`)
            .forEach((candidate) => parts.push(candidate.innerText || candidate.textContent));
        }

        let current = element.parentElement;
        for (let depth = 0; depth < 3 && current; depth += 1) {
          const directLabel = current.querySelector(":scope > label, :scope > legend");
          if (directLabel) {
            parts.push(directLabel.innerText || directLabel.textContent);
          }
          current = current.parentElement;
        }

        return normalise(parts.filter(Boolean).join(" "));
      }

      const candidates = Array.from(document.querySelectorAll("input, select, textarea"))
        .filter(visible)
        .filter((element) => {
          const type = (element.getAttribute("type") || "").toLowerCase();
          return !["hidden", "radio", "checkbox", "submit", "button", "file"].includes(type);
        })
        .map((element) => {
          const context = contextFor(element);
          if (negatives.some((regex) => regex.test(context))) {
            return null;
          }

          const score = positives.reduce(
            (total, regex) => total + (regex.test(context) ? 20 : 0),
            0
          );
          return { element, context, score };
        })
        .filter(Boolean)
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

      const chosen = candidates[0];
      if (!chosen) {
        return { ok: false, reason: "no_visible_matching_control" };
      }

      const element = chosen.element;
      if (element.tagName === "SELECT") {
        const desired = normalise(value).toLowerCase();
        const option = Array.from(element.options || []).find((candidate) => {
          const text = normalise(candidate.textContent).toLowerCase();
          const optionValue = normalise(candidate.value).toLowerCase();
          return text === desired || optionValue === desired || text.includes(desired);
        });

        if (!option) {
          return {
            ok: false,
            reason: "matching_select_option_missing",
            descriptor: chosen.context.slice(0, 180),
          };
        }

        element.value = option.value;
      } else {
        const prototype =
          element.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (setter) setter.call(element, value);
        else element.value = value;
      }

      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));
      element.dispatchEvent(new Event("focusout", { bubbles: true }));

      return {
        ok: true,
        id: element.id || null,
        name: element.getAttribute("name") || null,
        type: element.getAttribute("type") || element.tagName.toLowerCase(),
        descriptor: chosen.context.slice(0, 180),
        valueLength: String(value).length,
      };
    },
    { value: cleanValue, positivePatterns, negativePatterns, allowReadOnly }
  );

  if (result?.ok) {
    addStep(runContext, `Fill ${label}`, result);
  }

  return result;
}

async function selectVisibleChoice(page, runContext, label, expectedTexts, contextPatterns = []) {
  const texts = expectedTexts.map((value) => cleanText(value)).filter(Boolean);
  if (texts.length === 0) {
    return { ok: false, reason: "mapped_choice_missing" };
  }

  const result = await page.evaluate(
    ({ texts, contextPatterns }) => {
      const expected = texts.map((text) => text.toLowerCase());
      const contexts = contextPatterns.map((pattern) => new RegExp(pattern, "i"));

      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled
        );
      }

      function normalise(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
      }

      function clickElement(element) {
        const linkedId = element.getAttribute("for");
        const linked = linkedId ? document.getElementById(linkedId) : null;
        const target = linked || element;
        target.scrollIntoView({ block: "center", inline: "center" });
        target.click();
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return target;
      }

      const candidates = Array.from(
        document.querySelectorAll(
          'label, button, a, input[type="radio"], input[type="checkbox"], [role="button"], [role="radio"]'
        )
      )
        .filter(visible)
        .map((element) => {
          const text = normalise(
            element.innerText ||
              element.textContent ||
              element.value ||
              element.getAttribute("aria-label")
          );
          let context = text;
          let current = element.parentElement;
          for (let depth = 0; depth < 3 && current; depth += 1) {
            context += ` ${normalise(current.innerText || current.textContent).slice(0, 400)}`;
            current = current.parentElement;
          }

          const lowerText = text.toLowerCase();
          let score = 0;
          expected.forEach((choice) => {
            if (lowerText === choice) score += 500;
            else if (lowerText.includes(choice)) score += 180;
          });
          contexts.forEach((regex) => {
            if (regex.test(context)) score += 70;
          });

          return { element, text, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

      const chosen = candidates[0];
      if (!chosen) {
        return { ok: false, reason: "no_visible_matching_choice" };
      }

      const target = clickElement(chosen.element);
      return {
        ok: true,
        text: chosen.text,
        id: target.id || chosen.element.id || null,
        tag: chosen.element.tagName.toLowerCase(),
        checked:
          target.matches?.('input[type="radio"], input[type="checkbox"]')
            ? Boolean(target.checked)
            : null,
        score: chosen.score,
      };
    },
    { texts, contextPatterns }
  );

  if (result?.ok) {
    addStep(runContext, `Select ${label}`, result);
  }

  return result;
}

async function selectActivePortalSelectByAliases(
  page,
  runContext,
  label,
  expectedTexts,
  contextPatterns = []
) {
  const texts = expectedTexts.map((value) => cleanText(value)).filter(Boolean);
  if (texts.length === 0) {
    return { ok: false, reason: "mapped_choice_missing" };
  }

  const result = await page.evaluate(
    ({ texts, contextPatterns }) => {
      const contexts = contextPatterns.map((pattern) => new RegExp(pattern, "i"));

      function visible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled
        );
      }

      // Tracsis hides the native select with visibility:hidden and starts the
      // custom .styledSelect at opacity:0 until a choice has been made. The
      // active control therefore needs a layout check as well as a visual one.
      function layoutVisible(element) {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled
        );
      }

      function normalise(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
      }

      function comparable(value) {
        return normalise(value)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
      }

      function styledWidgetFor(select) {
        const wrapper = select.parentElement;
        const candidates = [
          select.nextElementSibling?.matches?.(".styledSelect")
            ? select.nextElementSibling
            : null,
          wrapper?.querySelector?.(":scope > .styledSelect"),
          wrapper?.querySelector?.(
            ':scope > [role="combobox"], :scope > .select2-selection, :scope > .chosen-container, :scope > .bootstrap-select'
          ),
        ].filter(Boolean);

        return candidates.find(layoutVisible) || null;
      }

      function labelFor(select) {
        const parts = [
          select.id,
          select.name,
          select.getAttribute("aria-label"),
          select.getAttribute("data-placeholder"),
        ];

        if (select.id) {
          document
            .querySelectorAll(`label[for="${CSS.escape(select.id)}"]`)
            .forEach((candidate) =>
              parts.push(candidate.innerText || candidate.textContent)
            );
        }

        let current = select.parentElement;
        for (let depth = 0; depth < 3 && current; depth += 1) {
          const directLabel = current.querySelector(":scope > label, :scope > legend");
          if (directLabel) {
            parts.push(directLabel.innerText || directLabel.textContent);
          }
          current = current.parentElement;
        }

        return normalise(parts.filter(Boolean).join(" "));
      }

      const expected = texts.map(comparable).filter(Boolean);
      const candidates = Array.from(document.querySelectorAll("select"))
        .map((select, selectIndex) => {
          const styledWidget = styledWidgetFor(select);
          if (!visible(select) && !layoutVisible(select) && !styledWidget) {
            return null;
          }

          const descriptor = normalise(
            [
              labelFor(select),
              styledWidget?.innerText || styledWidget?.textContent,
            ]
              .filter(Boolean)
              .join(" ")
          );

          const optionCandidates = Array.from(select.options || [])
            .map((option, optionIndex) => {
              const optionText = normalise(option.textContent || option.value);
              const optionComparable = comparable(optionText);
              const optionValueComparable = comparable(option.value);
              if (!optionComparable || /^(select|choose|please select)$/.test(optionComparable)) {
                return null;
              }

              let score = 0;
              expected.forEach((choice, aliasIndex) => {
                const aliasWeight = Math.max(0, 40 - aliasIndex * 2);
                if (optionComparable === choice || optionValueComparable === choice) {
                  score = Math.max(score, 900 + aliasWeight);
                } else if (
                  optionComparable.includes(choice) ||
                  choice.includes(optionComparable) ||
                  optionValueComparable.includes(choice)
                ) {
                  score = Math.max(score, 620 + aliasWeight);
                }
              });

              return { option, optionIndex, optionText, score };
            })
            .filter(Boolean)
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score || a.optionIndex - b.optionIndex);

          const optionMatch = optionCandidates[0];
          if (!optionMatch) return null;

          let score = optionMatch.score;
          contexts.forEach((regex) => {
            if (regex.test(descriptor)) score += 80;
          });

          return {
            select,
            selectIndex,
            styledWidget,
            descriptor,
            optionMatch,
            score,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || a.selectIndex - b.selectIndex);

      const chosen = candidates[0];
      if (!chosen) {
        const activeSelects = Array.from(document.querySelectorAll("select"))
          .map((select, index) => ({
            select,
            index,
            styledWidget: styledWidgetFor(select),
          }))
          .filter(
            (entry) =>
              visible(entry.select) ||
              layoutVisible(entry.select) ||
              entry.styledWidget
          )
          .map((entry) => ({
            index: entry.index,
            id: entry.select.id || null,
            name: entry.select.name || null,
            descriptor: labelFor(entry.select).slice(0, 180),
            options: Array.from(entry.select.options || [])
              .slice(0, 40)
              .map((option) => normalise(option.textContent || option.value)),
          }));

        return {
          ok: false,
          reason: "no_active_select_option_matched",
          expectedTexts: texts,
          activeSelects,
        };
      }

      const { select, optionMatch, styledWidget } = chosen;
      const existingSelection = Array.from(select.options || []).find(
        (option) => option.selected
      );
      const alreadySelected = Boolean(
        existingSelection === optionMatch.option &&
          select.value === optionMatch.option.value
      );

      if (alreadySelected) {
        if (styledWidget?.matches?.(".styledSelect")) {
          styledWidget.textContent = optionMatch.optionText;
          styledWidget.closest(".form-wrap")?.classList.add("filled");
        }

        return {
          ok: true,
          id: select.id || null,
          name: select.name || null,
          selectIndex: chosen.selectIndex,
          descriptor: chosen.descriptor.slice(0, 220),
          selectedText: normalise(existingSelection?.textContent),
          selectedValue: normalise(select.value),
          styledWidgetFound: Boolean(styledWidget),
          customOptionClicked: false,
          alreadySelected: true,
          optionTexts: Array.from(select.options || [])
            .slice(0, 40)
            .map((option) => normalise(option.textContent || option.value)),
          score: chosen.score,
        };
      }

      // The portal's dependent manual-ticket fields are populated by handlers
      // attached to the custom options <li>, not by the native select's change
      // event. Click that exact generated option when it exists so Type reveals
      // Format and Format reveals the mapped ticket fields just as a user click
      // would. The native fallback remains for other select implementations.
      const customOptions = Array.from(
        select.parentElement?.querySelectorAll?.(":scope > ul.options > li") || []
      );
      const matchingCustomOption = customOptions.find((item) => {
        const itemValue = normalise(item.getAttribute("rel"));
        const itemText = normalise(item.innerText || item.textContent);
        return (
          itemValue === normalise(optionMatch.option.value) ||
          comparable(itemText) === comparable(optionMatch.optionText)
        );
      });

      if (matchingCustomOption) {
        matchingCustomOption.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          })
        );
      } else {
        select.value = optionMatch.option.value;
        Array.from(select.options || []).forEach((option) => {
          option.selected = option === optionMatch.option;
        });
      }

      // Keep the native value authoritative in case a portal handler rebuilt
      // the visual widget but did not retain the selected option itself.
      select.value = optionMatch.option.value;
      Array.from(select.options || []).forEach((option) => {
        option.selected = option === optionMatch.option;
      });

      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.dispatchEvent(new Event("blur", { bubbles: true }));

      if (window.jQuery) {
        try {
          window.jQuery(select).val(optionMatch.option.value).trigger("change");
        } catch {
          // Native value and events above remain authoritative.
        }
      }

      if (styledWidget?.matches?.(".styledSelect")) {
        styledWidget.textContent = optionMatch.optionText;
        styledWidget.closest(".form-wrap")?.classList.add("filled");
      }

      const selected = Array.from(select.options || []).find(
        (option) => option.selected
      );

      return {
        ok: selected === optionMatch.option && select.value === optionMatch.option.value,
        id: select.id || null,
        name: select.name || null,
        selectIndex: chosen.selectIndex,
        descriptor: chosen.descriptor.slice(0, 220),
        selectedText: normalise(selected?.textContent),
        selectedValue: normalise(select.value),
        styledWidgetFound: Boolean(styledWidget),
        customOptionClicked: Boolean(matchingCustomOption),
        alreadySelected: false,
        optionTexts: Array.from(select.options || [])
          .slice(0, 40)
          .map((option) => normalise(option.textContent || option.value)),
        score: chosen.score,
      };
    },
    { texts, contextPatterns }
  );

  if (result?.ok) {
    addStep(runContext, `Select ${label}`, result);
  } else {
    addLog(runContext, `Greater Anglia ${label} select did not match.`, result || {});
  }

  if (result?.ok && result?.customOptionClicked) {
    // Type and Format launch chained AJAX requests. Waiting for the network to
    // settle prevents the loop from pressing Continue before the new fields
    // have been inserted and exposed.
    await page
      .waitForLoadState("networkidle", { timeout: 4000 })
      .catch(() => {});
  }

  await page.waitForTimeout(result?.customOptionClicked ? 250 : 150).catch(() => {});
  return result;
}


async function dismissCookieConsent(page, runContext) {
  // Greater Anglia/Tracsis often shows a modal with the exact yellow button:
  // "Ok, I agree". Use DOM-level clicking first because the modal overlay can
  // confuse ordinary role/text locators.
  const domResult = await page.evaluate(() => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    const candidates = Array.from(
      document.querySelectorAll('button, input[type="button"], input[type="submit"], a, [role="button"]')
    ).filter(visible);

    const exact = candidates.find((element) => {
      const text = `${element.innerText || ""} ${element.value || ""} ${element.getAttribute("aria-label") || ""}`
        .replace(/\s+/g, " ")
        .trim();
      return /^ok,?\s*i\s*agree$/i.test(text);
    });

    if (!exact) {
      return { ok: false, reason: "Ok, I agree button not visible" };
    }

    exact.scrollIntoView({ block: "center", inline: "center" });
    exact.click();
    exact.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    exact.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    exact.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    return {
      ok: true,
      text: `${exact.innerText || ""} ${exact.value || ""}`.trim(),
    };
  });

  if (domResult?.ok) {
    addStep(runContext, "Accept cookie consent", {
      selector: "dom_exact_ok_i_agree",
      text: domResult.text,
    });
    await page.waitForTimeout(1000).catch(() => {});
    return true;
  }

  const okAgreeRegex = /^ok,?\s*i\s*agree$/i;

  const candidates = [
    {
      description: "button Ok, I agree",
      locator: () => page.getByRole("button", { name: okAgreeRegex }),
    },
    {
      description: 'button:has-text("Ok, I agree")',
      locator: () => page.locator('button:has-text("Ok, I agree")'),
    },
    {
      description: 'input[value="Ok, I agree"]',
      locator: () => page.locator('input[value="Ok, I agree"]'),
    },
    {
      description: "exact text Ok, I agree",
      locator: () => page.getByText(okAgreeRegex),
    },
  ];

  for (const candidate of candidates) {
    try {
      const locator = candidate.locator();
      const count = await locator.count();

      if (count === 0) {
        continue;
      }

      const first = locator.first();
      await first.waitFor({ state: "visible", timeout: 1200 });
      await first.click({ timeout: 2500, force: true });
      addStep(runContext, "Accept cookie consent", {
        selector: candidate.description,
      });
      await page.waitForTimeout(1000).catch(() => {});
      return true;
    } catch {
      // Try the next exact cookie candidate.
    }
  }

  addLog(runContext, "Cookie consent was not visible or already accepted.");
  return false;
}

async function fillInputByDomHeuristic(
  page,
  runContext,
  label,
  value,
  positivePatterns,
  negativePatterns = []
) {
  const cleanValue = cleanText(value);

  if (!cleanValue) {
    addWarning(runContext, `${label} skipped because no value was provided.`);
    return false;
  }

  const result = await page.evaluate(
    ({ label, value, positivePatterns, negativePatterns }) => {
      const positives = positivePatterns.map((pattern) => new RegExp(pattern, "i"));
      const negatives = negativePatterns.map((pattern) => new RegExp(pattern, "i"));

      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
          style &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled &&
          !element.readOnly
        );
      }

      function normalise(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
      }

      function nearbyText(element) {
        const chunks = [
          element.getAttribute("placeholder"),
          element.getAttribute("aria-label"),
          element.getAttribute("name"),
          element.getAttribute("id"),
          element.getAttribute("formcontrolname"),
          element.getAttribute("data-placeholder"),
        ];

        if (element.id) {
          document
            .querySelectorAll(`label[for="${CSS.escape(element.id)}"]`)
            .forEach((labelElement) => chunks.push(labelElement.innerText));
        }

        let current = element;
        for (let depth = 0; depth < 6 && current; depth += 1) {
          if (
            current.matches?.(
              "mat-form-field, .mat-form-field, .form-group, .field, .input-field, .form-control-wrapper, li, td, div"
            )
          ) {
            chunks.push(current.innerText);
          }
          current = current.parentElement;
        }

        return normalise(chunks.filter(Boolean).join(" "));
      }

      const fields = Array.from(document.querySelectorAll("input, textarea"))
        .filter(visible)
        .filter((element) => {
          const type = (element.getAttribute("type") || "text").toLowerCase();
          return !["hidden", "checkbox", "radio", "submit", "button"].includes(type);
        });

      const scored = fields
        .map((element) => {
          const directText = normalise([
            element.getAttribute("placeholder"),
            element.getAttribute("aria-label"),
            element.getAttribute("name"),
            element.getAttribute("id"),
            element.getAttribute("formcontrolname"),
            element.getAttribute("data-placeholder"),
          ].filter(Boolean).join(" "));
          const contextText = nearbyText(element);
          const combinedText = `${directText} ${contextText}`;

          if (negatives.some((regex) => regex.test(combinedText))) {
            return null;
          }

          let score = 0;
          positives.forEach((regex) => {
            if (regex.test(directText)) score += 10;
            if (regex.test(contextText)) score += 4;
          });

          return {
            element,
            score,
            descriptor: directText || contextText.slice(0, 120),
          };
        })
        .filter(Boolean)
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

      const chosen = scored[0];

      if (!chosen) {
        return {
          ok: false,
          reason: `No visible input matched ${label}.`,
          visibleInputCount: fields.length,
        };
      }

      const element = chosen.element;
      element.focus();

      const prototype =
        element.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

      if (valueSetter) {
        valueSetter.call(element, value);
      } else {
        element.value = value;
      }

      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));

      return {
        ok: true,
        descriptor: chosen.descriptor,
        score: chosen.score,
        valueLength: String(value).length,
      };
    },
    {
      label,
      value: cleanValue,
      positivePatterns,
      negativePatterns,
    }
  );

  if (result?.ok) {
    addStep(runContext, `Fill ${label}`, {
      selector: "dom_heuristic",
      descriptor: result.descriptor,
      score: result.score,
    });
    return true;
  }

  addWarning(runContext, `Fill ${label} could not be completed.`, result || {});
  return false;
}


async function scanGreaterAngliaPersonalFields(page, runContext) {
  const fields = await page.evaluate(() => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.disabled &&
        !element.readOnly
      );
    }

    return Array.from(document.querySelectorAll("input, textarea, select, [role='combobox'], mat-select"))
      .filter(visible)
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        return {
          index,
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute("type"),
          name: element.getAttribute("name"),
          id: element.getAttribute("id"),
          placeholder: element.getAttribute("placeholder"),
          ariaLabel: element.getAttribute("aria-label"),
          formControlName: element.getAttribute("formcontrolname"),
          value: element.value || null,
          text: (element.innerText || "").replace(/\s+/g, " ").trim().slice(0, 120),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  });

  addLog(runContext, "Greater Anglia personal fields scan.", {
    fields: fields.slice(0, 20),
  });

  return fields;
}

async function fillInputByDirectAttributes(
  page,
  runContext,
  label,
  value,
  positivePatterns,
  negativePatterns = []
) {
  const cleanValue = cleanText(value);

  if (!cleanValue) {
    addWarning(runContext, `${label} skipped because no value was provided.`);
    return false;
  }

  const result = await page.evaluate(
    ({ label, value, positivePatterns, negativePatterns }) => {
      const positives = positivePatterns.map((pattern) => new RegExp(pattern, "i"));
      const negatives = negativePatterns.map((pattern) => new RegExp(pattern, "i"));

      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled &&
          !element.readOnly
        );
      }

      function normalise(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
      }

      function setValue(element, nextValue) {
        element.focus();
        const prototype =
          element.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

        if (valueSetter) {
          valueSetter.call(element, nextValue);
        } else {
          element.value = nextValue;
        }

        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
      }

      const fields = Array.from(document.querySelectorAll("input, textarea"))
        .filter(visible)
        .filter((element) => {
          const type = (element.getAttribute("type") || "text").toLowerCase();
          return !["hidden", "checkbox", "radio", "submit", "button"].includes(type);
        });

      const scored = fields
        .map((element) => {
          const directText = normalise([
            element.getAttribute("placeholder"),
            element.getAttribute("aria-label"),
            element.getAttribute("name"),
            element.getAttribute("id"),
            element.getAttribute("formcontrolname"),
            element.getAttribute("data-placeholder"),
          ].filter(Boolean).join(" "));

          if (!directText) {
            return null;
          }

          if (negatives.some((regex) => regex.test(directText))) {
            return null;
          }

          let score = 0;
          positives.forEach((regex) => {
            if (regex.test(directText)) score += 20;
          });

          return {
            element,
            score,
            descriptor: directText,
          };
        })
        .filter(Boolean)
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

      const chosen = scored[0];

      if (!chosen) {
        return { ok: false, reason: `No direct attribute input matched ${label}.` };
      }

      setValue(chosen.element, value);

      return {
        ok: true,
        descriptor: chosen.descriptor,
        score: chosen.score,
      };
    },
    {
      label,
      value: cleanValue,
      positivePatterns,
      negativePatterns,
    }
  );

  if (result?.ok) {
    addStep(runContext, `Fill ${label}`, {
      selector: "direct_attribute_match",
      descriptor: result.descriptor,
      score: result.score,
    });
    return true;
  }

  addLog(runContext, `Direct ${label} match was unavailable; using the verified visible-field fallback.`);
  return false;
}

async function fillVisibleInputByOrder(page, runContext, label, value, orderIndex) {
  const cleanValue = cleanText(value);

  if (!cleanValue) {
    addWarning(runContext, `${label} skipped because no value was provided.`);
    return false;
  }

  const result = await page.evaluate(
    ({ label, value, orderIndex }) => {
      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled &&
          !element.readOnly
        );
      }

      function setValue(element, nextValue) {
        element.scrollIntoView({ block: "center", inline: "center" });
        element.focus();
        const prototype =
          element.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

        if (valueSetter) {
          valueSetter.call(element, nextValue);
        } else {
          element.value = nextValue;
        }

        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
      }

      const fields = Array.from(document.querySelectorAll("input, textarea"))
        .filter(visible)
        .filter((element) => {
          const type = (element.getAttribute("type") || "text").toLowerCase();
          return !["hidden", "checkbox", "radio", "submit", "button"].includes(type);
        })
        .sort((a, b) => {
          const rectA = a.getBoundingClientRect();
          const rectB = b.getBoundingClientRect();
          return rectA.top - rectB.top || rectA.left - rectB.left;
        });

      const chosen = fields[orderIndex];

      if (!chosen) {
        return {
          ok: false,
          reason: `No visible input exists at order index ${orderIndex} for ${label}.`,
          visibleInputCount: fields.length,
        };
      }

      const rect = chosen.getBoundingClientRect();
      setValue(chosen, value);

      return {
        ok: true,
        orderIndex,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        descriptor: [
          chosen.getAttribute("placeholder"),
          chosen.getAttribute("aria-label"),
          chosen.getAttribute("name"),
          chosen.getAttribute("id"),
          chosen.getAttribute("formcontrolname"),
        ].filter(Boolean).join(" ") || `visible input ${orderIndex}`,
      };
    },
    { label, value: cleanValue, orderIndex }
  );

  if (result?.ok) {
    addStep(runContext, `Fill ${label}`, {
      selector: "visible_input_order",
      ...result,
    });
    return true;
  }

  addWarning(runContext, `Order fill ${label} could not be completed.`, result || {});
  return false;
}

async function fillGreaterAngliaPersonalInput(
  page,
  runContext,
  label,
  value,
  orderIndex,
  positivePatterns,
  negativePatterns = []
) {
  return (
    (await fillInputByDirectAttributes(
      page,
      runContext,
      label,
      value,
      positivePatterns,
      negativePatterns
    )) ||
    (await fillVisibleInputByOrder(page, runContext, label, value, orderIndex))
  );
}

async function normaliseTitleForGreaterAnglia(title) {
  const cleanTitleValue = cleanText(title);

  if (!cleanTitleValue) {
    return null;
  }

  const titleMap = new Map([
    ["mister", "Mr"],
    ["mr", "Mr"],
    ["mr.", "Mr"],
    ["missus", "Mrs"],
    ["mrs", "Mrs"],
    ["mrs.", "Mrs"],
    ["miss", "Miss"],
    ["ms", "Ms"],
    ["ms.", "Ms"],
    ["doctor", "Dr"],
    ["dr", "Dr"],
    ["dr.", "Dr"],
    ["mx", "Mx"],
  ]);

  return titleMap.get(cleanTitleValue.toLowerCase()) || cleanTitleValue;
}

async function inspectGreaterAngliaTitleSelect(page, expectedTitle = null) {
  const cleanExpectedTitle = cleanText(expectedTitle);

  return page.locator("select").evaluateAll((selects, expectedTitleValue) => {
    function norm(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function escapeRegex(value) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    const titleOptionNames = ["Mrs", "Mr", "Mx", "Ms", "Miss", "Dr"];

    const candidates = selects
      .map((select, index) => {
        const options = Array.from(select.options || []).map((option) => ({
          text: norm(option.textContent),
          value: option.value,
          selected: option.selected,
        }));
        const optionTexts = options.map((option) => option.text);
        const titleOptionMatchCount = titleOptionNames.filter((name) =>
          optionTexts.some((text) => new RegExp(`^${name}\\.?$`, "i").test(text))
        ).length;
        const hasOtherTitle = optionTexts.some((text) => /other.*specify/i.test(text));
        const descriptor = norm(
          [
            select.getAttribute("name"),
            select.getAttribute("id"),
            select.getAttribute("aria-label"),
            select.getAttribute("data-placeholder"),
          ]
            .filter(Boolean)
            .join(" ")
        );

        let score = titleOptionMatchCount * 20;
        if (hasOtherTitle) score += 80;
        if (/\btitle\b/i.test(descriptor)) score += 100;

        return { select, index, options, descriptor, score };
      })
      .filter((entry) => entry.score >= 80)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    const chosen = candidates[0];

    if (!chosen) {
      return {
        found: false,
        expectedTitle: expectedTitleValue || null,
        selectCount: selects.length,
      };
    }

    const selectedOption = chosen.options.find((option) => option.selected) || null;
    const expectedOption = expectedTitleValue
      ? chosen.options.find((option) =>
          new RegExp(`^${escapeRegex(expectedTitleValue)}\\.?$`, "i").test(option.text)
        ) || null
      : null;

    return {
      found: true,
      index: chosen.index,
      descriptor: chosen.descriptor,
      score: chosen.score,
      selectedText: selectedOption?.text || null,
      selectedValue: selectedOption?.value || null,
      expectedOptionText: expectedOption?.text || null,
      expectedOptionValue: expectedOption?.value ?? null,
      expectedTitle: expectedTitleValue || null,
      optionTexts: chosen.options.map((option) => option.text).slice(0, 12),
    };
  }, cleanExpectedTitle);
}

async function verifyTitleForGreaterAnglia(page, runContext, title) {
  const cleanTitleValue = await normaliseTitleForGreaterAnglia(title);

  if (!cleanTitleValue) {
    addWarning(runContext, "Greater Anglia title verification skipped because no title was provided.");
    return false;
  }

  const nativeState = await inspectGreaterAngliaTitleSelect(page, cleanTitleValue);

  if (nativeState?.found) {
    const selectedText = cleanText(nativeState.selectedText);
    const matches = Boolean(
      selectedText &&
        new RegExp(`^${escapeRegExp(cleanTitleValue)}\\.?$`, "i").test(selectedText)
    );

    addLog(runContext, "Greater Anglia title verification checked native select.", {
      title: cleanTitleValue,
      matches,
      state: nativeState,
    });

    return matches;
  }

  // Custom-widget fallback. Only inspect visible elements inside the known title-field
  // area; do not accept hidden option text elsewhere on the page as proof of selection.
  const customState = await page.evaluate((titleValue) => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function norm(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function escapeRegex(value) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    const expectedRegex = new RegExp(`^${escapeRegex(titleValue)}\\.?$`, "i");
    const elements = Array.from(
      document.querySelectorAll(
        "[role='combobox'], mat-select, .mat-select, .mat-mdc-select, .select2-selection, .chosen-container, .bootstrap-select, button, div, span"
      )
    )
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = norm(element.innerText || element.textContent);
        return { element, rect, text };
      })
      .filter((entry) =>
        entry.rect.top >= 235 &&
        entry.rect.top <= 340 &&
        entry.rect.left >= 120 &&
        entry.rect.left <= 440 &&
        entry.rect.width >= 80 &&
        entry.rect.width <= 360
      )
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);

    const selected = elements.find((entry) => expectedRegex.test(entry.text));
    const selectPlaceholder = elements.find((entry) => /^select$/i.test(entry.text));

    return {
      foundSelectedTitle: Boolean(selected),
      selectedText: selected?.text || null,
      stillShowsSelect: Boolean(selectPlaceholder),
      candidates: elements.slice(0, 12).map((entry) => ({
        text: entry.text.slice(0, 80),
        x: Math.round(entry.rect.x),
        y: Math.round(entry.rect.y),
        width: Math.round(entry.rect.width),
        height: Math.round(entry.rect.height),
      })),
    };
  }, cleanTitleValue);

  const matches = customState?.foundSelectedTitle === true && customState?.stillShowsSelect !== true;

  addLog(runContext, "Greater Anglia title verification checked custom control.", {
    title: cleanTitleValue,
    matches,
    state: customState,
  });

  return matches;
}

async function selectTitleForGreaterAnglia(page, runContext, title) {
  const cleanTitleValue = await normaliseTitleForGreaterAnglia(title);

  if (!cleanTitleValue) {
    addWarning(runContext, "title skipped because no value was provided.");
    return false;
  }

  // Identify the Title field by its unique option set, not by generic
  // visible text. Tracsis can visually style a native <select> while the actual
  // select element is hidden, so the old visible-only scan could click a parent
  // div/span and report success without changing the form value.
  const nativeState = await inspectGreaterAngliaTitleSelect(page, cleanTitleValue);

  if (nativeState?.found && nativeState.expectedOptionValue !== null) {
    try {
      const titleSelect = page.locator("select").nth(nativeState.index);

      // Tracsis hides the real select with class "s-hidden". Playwright's
      // selectOption() waits for visibility, so it times out even though this
      // is the actual field submitted by the form. Set the real hidden select
      // value in the page instead, then fire the same events the form/plugin
      // expects.
      const setResult = await titleSelect.evaluate(
        (select, selection) => {
          const { value, text } = selection;

          const matchingOption = Array.from(select.options || []).find(
            (option) => option.value === value
          );

          if (!matchingOption) {
            return {
              ok: false,
              reason: "Expected title option was not found on hidden select.",
              value,
            };
          }

          // Set the actual form control.
          select.value = value;
          Array.from(select.options || []).forEach((option) => {
            option.selected = option === matchingOption;
          });

          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
          select.dispatchEvent(new Event("blur", { bubbles: true }));

          // If jQuery owns the styled dropdown, trigger its change handlers too.
          if (window.jQuery) {
            try {
              window.jQuery(select).val(value).trigger("change");
            } catch {
              // Native value/events above remain authoritative.
            }
          }

          // The Greater Anglia form currently uses the common s-hidden /
          // styledSelect pattern. Keep its visible label in sync when present.
          const wrapper = select.parentElement;
          const styled =
            select.nextElementSibling?.matches?.(".styledSelect")
              ? select.nextElementSibling
              : wrapper?.querySelector?.(".styledSelect");

          if (styled) {
            styled.textContent = text;
          }

          return {
            ok: select.value === value,
            value: select.value,
            selectedText:
              Array.from(select.options || []).find((option) => option.selected)
                ?.textContent?.trim() || null,
            className: select.className || null,
            id: select.id || null,
            name: select.name || null,
            styledSelectFound: Boolean(styled),
          };
        },
        {
          value: nativeState.expectedOptionValue,
          text: nativeState.expectedOptionText || cleanTitleValue,
        }
      );

      await page.waitForTimeout(250).catch(() => {});

      const verified = await verifyTitleForGreaterAnglia(
        page,
        runContext,
        cleanTitleValue
      );

      if (setResult?.ok && verified) {
        addStep(runContext, "Select title", {
          selector: "hidden_native_title_select_dom_value",
          title: cleanTitleValue,
          selectIndex: nativeState.index,
          selectedValue: nativeState.expectedOptionValue,
          selectedText: nativeState.expectedOptionText,
          descriptor: nativeState.descriptor,
          setResult,
        });
        return true;
      }

      addWarning(runContext, "Hidden Greater Anglia title select did not verify after DOM assignment.", {
        title: cleanTitleValue,
        state: nativeState,
        setResult,
      });
    } catch (error) {
      addWarning(runContext, "Native Greater Anglia title select attempt failed.", {
        title: cleanTitleValue,
        state: nativeState,
        error: error.message,
      });
    }
  } else {
    addLog(runContext, "No native Greater Anglia title select was identified.", {
      title: cleanTitleValue,
      state: nativeState,
    });
  }

  // Custom-widget fallback: click only a compact, visible control in the Title
  // field area. Generic page-level div/span text is deliberately excluded from
  // being treated as the control.
  const customOpenResult = await page.evaluate(() => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.disabled
      );
    }

    function textFor(element) {
      return String(
        [
          element.innerText,
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("data-placeholder"),
          element.getAttribute("title"),
        ]
          .filter(Boolean)
          .join(" ")
      )
        .replace(/\s+/g, " ")
        .trim();
    }

    const selectors = [
      "[role='combobox']",
      "mat-select",
      ".mat-select",
      ".mat-mdc-select",
      ".select2-selection",
      ".styledSelect",
      ".select .styledSelect",
      ".chosen-container",
      ".bootstrap-select button",
      "button.dropdown-toggle",
      "select",
    ].join(", ");

    const candidates = Array.from(document.querySelectorAll(selectors))
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = textFor(element);
        let score = 0;

        if (rect.top >= 235 && rect.top <= 340) score += 100;
        if (rect.left >= 120 && rect.left <= 440) score += 100;
        if (rect.width >= 150 && rect.width <= 320) score += 40;
        if (/\btitle\b/i.test(text)) score += 80;
        if (/\bselect\b/i.test(text)) score += 30;

        return { element, rect, text, score };
      })
      .filter((entry) => entry.score >= 200)
      .sort((a, b) => b.score - a.score || a.rect.width * a.rect.height - b.rect.width * b.rect.height);

    const chosen = candidates[0];

    if (!chosen) {
      return { ok: false, reason: "No compact interactive title control found" };
    }

    chosen.element.scrollIntoView({ block: "center", inline: "center" });
    chosen.element.click();

    return {
      ok: true,
      text: chosen.text.slice(0, 120),
      rect: {
        x: Math.round(chosen.rect.x),
        y: Math.round(chosen.rect.y),
        width: Math.round(chosen.rect.width),
        height: Math.round(chosen.rect.height),
      },
    };
  });

  if (customOpenResult?.ok) {
    await page.waitForTimeout(450).catch(() => {});

    const optionRegex = new RegExp(`^${escapeRegExp(cleanTitleValue)}\\.?$`, "i");
    const optionCandidates = [
      page.getByRole("option", { name: optionRegex }),
      page.locator("mat-option, .mat-option, .mat-mdc-option").filter({ hasText: optionRegex }),
      page.locator("li").filter({ hasText: optionRegex }),
      page.getByText(optionRegex),
    ];

    for (const locator of optionCandidates) {
      try {
        const count = await locator.count();
        if (count === 0) continue;

        const visibleOptions = [];
        for (let index = 0; index < count; index += 1) {
          const candidate = locator.nth(index);
          if (await candidate.isVisible().catch(() => false)) {
            visibleOptions.push(candidate);
          }
        }

        if (visibleOptions.length === 0) continue;

        await visibleOptions[0].click({ timeout: 3000, force: true });
        await page.waitForTimeout(350).catch(() => {});

        if (await verifyTitleForGreaterAnglia(page, runContext, cleanTitleValue)) {
          addStep(runContext, "Select title", {
            selector: "custom_title_control_exact_visible_option",
            title: cleanTitleValue,
            control: customOpenResult,
          });
          return true;
        }
      } catch {
        // Try the next exact visible option locator.
      }
    }
  }

  addWarning(runContext, "Greater Anglia title selection did not verify.", {
    title: cleanTitleValue,
    nativeState,
    customOpenResult,
  });

  return false;
}

async function clickPostcodeLookupIfVisible(page, runContext) {
  const result = await page.evaluate(() => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.disabled
      );
    }

    function textFor(element) {
      return String(
        [
          element.innerText,
          element.textContent,
          element.value,
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          element.getAttribute("name"),
          element.getAttribute("id"),
        ]
          .filter(Boolean)
          .join(" ")
      )
        .replace(/\s+/g, " ")
        .trim();
    }

    function clickElement(element) {
      element.scrollIntoView({ block: "center", inline: "center" });
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }

    const controls = Array.from(
      document.querySelectorAll('button, input[type="button"], input[type="submit"], a, [role="button"]')
    )
      .filter(visible)
      .map((element) => ({ element, text: textFor(element) }))
      .filter((entry) => entry.text.length > 0);

    const lookupControl = controls
      .map((entry) => {
        let score = 0;
        if (/find\s*address|lookup\s*address|look\s*up\s*address|search\s*address|get\s*address|select\s*address/i.test(entry.text)) score += 100;
        if (/address/i.test(entry.text)) score += 20;
        if (/continue|next|submit|cookie|agree/i.test(entry.text)) score -= 80;
        return { ...entry, score };
      })
      .filter((entry) => entry.score > 30)
      .sort((a, b) => b.score - a.score)[0];

    if (!lookupControl) {
      return { ok: false, reason: "No postcode lookup button visible" };
    }

    clickElement(lookupControl.element);
    return {
      ok: true,
      method: "postcode_lookup_button",
      text: lookupControl.text.slice(0, 120),
      score: lookupControl.score,
    };
  });

  if (result?.ok) {
    addStep(runContext, "Click postcode address lookup", result);
    await page.waitForTimeout(1800).catch(() => {});
    return true;
  }

  addLog(runContext, "No postcode lookup button needed or visible.", result || {});
  return false;
}

async function selectGreaterAngliaAddress(page, runContext, passenger) {
  const addressLine1 = cleanText(passenger.addressLine1);
  const addressLine2 = cleanText(passenger.addressLine2);
  const townCity = cleanText(passenger.townCity);
  const postcode = cleanText(passenger.postcode);

  if (!postcode) {
    addWarning(runContext, "Address selection skipped because no postcode was provided.");
    return false;
  }

  await page.waitForTimeout(900).catch(() => {});
  await clickPostcodeLookupIfVisible(page, runContext);
  await page.waitForTimeout(1800).catch(() => {});

  const result = await page.evaluate(
    ({ addressLine1, addressLine2, townCity, postcode }) => {
      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled
        );
      }

      function norm(text) {
        return String(text || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function rawText(element) {
        return String(
          [
            element.innerText,
            element.textContent,
            element.value,
            element.getAttribute("aria-label"),
            element.getAttribute("placeholder"),
            element.getAttribute("name"),
            element.getAttribute("id"),
            element.getAttribute("formcontrolname"),
          ]
            .filter(Boolean)
            .join(" ")
        )
          .replace(/\s+/g, " ")
          .trim();
      }

      function nearbyText(element) {
        const chunks = [rawText(element)];

        if (element.id) {
          document
            .querySelectorAll(`label[for="${CSS.escape(element.id)}"]`)
            .forEach((labelElement) => chunks.push(labelElement.innerText));
        }

        let current = element;
        for (let depth = 0; depth < 5 && current; depth += 1) {
          chunks.push(current.innerText || current.textContent || "");
          current = current.parentElement;
        }

        return chunks.join(" ").replace(/\s+/g, " ").trim();
      }

      function clickElement(element) {
        element.scrollIntoView({ block: "center", inline: "center" });
        element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }

      function addressScore(text) {
        const normalised = norm(text);
        let score = 0;

        if (!normalised) return -999;
        if (/select|choose|address|postcode|post code/.test(normalised)) score += 5;
        if (/my address is not listed|enter manually|not listed/.test(normalised)) score -= 90;
        if (/cookie|privacy|terms|accessibility|frequently asked questions|continue|next|submit/.test(normalised)) score -= 90;
        if (postcode && normalised.includes(norm(postcode))) score += 45;
        if (addressLine1 && normalised.includes(norm(addressLine1))) score += 120;
        if (addressLine2 && normalised.includes(norm(addressLine2))) score += 25;
        if (townCity && normalised.includes(norm(townCity))) score += 35;

        const houseNumber = String(addressLine1 || "").match(/\b\d+[a-z]?\b/i)?.[0];
        if (houseNumber && normalised.includes(norm(houseNumber))) score += 25;

        const addressWords = norm(addressLine1 || "")
          .split(" ")
          .filter((word) => word.length >= 4);

        for (const word of addressWords) {
          if (normalised.includes(word)) score += 12;
        }

        return score;
      }

      // 1) Native address select/dropdown. This is common after postcode lookup.
      const selectMatches = Array.from(document.querySelectorAll("select"))
        .filter(visible)
        .map((select) => {
          const selectText = nearbyText(select);
          const options = Array.from(select.options || [])
            .map((option) => ({ option, text: rawText(option), value: option.value }))
            .filter((entry) => entry.value && !/select|choose|please/i.test(entry.text));

          const bestOption = options
            .map((entry) => ({ ...entry, score: addressScore(entry.text) }))
            .sort((a, b) => b.score - a.score)[0];

          let selectScore = addressScore(selectText);
          if (/address|postcode|post code/i.test(selectText)) selectScore += 40;
          if (/title/i.test(selectText)) selectScore -= 120;
          if (bestOption?.score) selectScore += bestOption.score;

          return { select, selectText, bestOption, score: selectScore };
        })
        .filter((entry) => entry.bestOption && entry.score > 15)
        .sort((a, b) => b.score - a.score);

      if (selectMatches[0]) {
        const { select, bestOption, selectText, score } = selectMatches[0];
        select.value = bestOption.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        select.dispatchEvent(new Event("blur", { bubbles: true }));

        return {
          ok: true,
          method: "native_address_select",
          selectedText: bestOption.text.slice(0, 180),
          selectText: selectText.slice(0, 180),
          score,
        };
      }

      // 2) Custom combobox/dropdown: open the address control if visible.
      const combo = Array.from(
        document.querySelectorAll("mat-select, [role='combobox'], .mat-select, .mat-mdc-select, input, button, div")
      )
        .filter(visible)
        .map((element) => {
          const text = nearbyText(element);
          const rect = element.getBoundingClientRect();
          let score = addressScore(text);
          if (/address|postcode|post code/i.test(text)) score += 25;
          if (/title/i.test(text)) score -= 120;
          if (element.matches("mat-select, [role='combobox'], .mat-select, .mat-mdc-select")) score += 30;
          return { element, text, rect, score };
        })
        .filter((entry) => entry.score > 25)
        .sort((a, b) => b.score - a.score)[0];

      if (combo) {
        clickElement(combo.element);
      }

      // 3) Click the best visible address option from the opened dropdown/list.
      const clickables = Array.from(
        document.querySelectorAll("mat-option, .mat-option, .mat-mdc-option, [role='option'], li, button, a, div, span")
      )
        .filter(visible)
        .map((element) => ({ element, text: rawText(element), score: addressScore(rawText(element)) }))
        .filter((entry) => entry.text.length > 2)
        .sort((a, b) => b.score - a.score);

      const bestAddress = clickables.find((entry) => entry.score > 35);

      if (bestAddress) {
        clickElement(bestAddress.element);
        return {
          ok: true,
          method: "matched_visible_address_option",
          selectedText: bestAddress.text.slice(0, 180),
          score: bestAddress.score,
        };
      }

      const manual = clickables.find((entry) => /my address is not listed|enter manually|not listed/i.test(entry.text));

      if (manual) {
        clickElement(manual.element);
        return {
          ok: true,
          method: "manual_address_selected",
          selectedText: manual.text.slice(0, 180),
        };
      }

      return {
        ok: false,
        method: "no_address_option_found",
        postcode,
        sampleSelects: Array.from(document.querySelectorAll("select"))
          .filter(visible)
          .slice(0, 5)
          .map((select) => ({
            text: nearbyText(select).slice(0, 160),
            options: Array.from(select.options || []).slice(0, 8).map((option) => rawText(option).slice(0, 120)),
          })),
        sampleOptions: clickables.slice(0, 12).map((entry) => ({
          text: entry.text.slice(0, 120),
          score: entry.score,
        })),
      };
    },
    { addressLine1, addressLine2, townCity, postcode }
  );

  if (result?.ok) {
    addStep(runContext, "Select postcode address", result);
    await page.waitForTimeout(1200).catch(() => {});

    if (result.method === "manual_address_selected") {
      await fillManualAddressFields(page, runContext, passenger);
    }

    return true;
  }

  addWarning(runContext, "Postcode address selection could not be completed.", result || {});
  return false;
}

async function fillManualAddressFields(page, runContext, passenger) {
  await fillField(
    page,
    runContext,
    "manual address line 1",
    passenger.addressLine1,
    /address line 1|address 1|house|street/i,
    ['input[name*="address"]', 'input[id*="address"]']
  );

  await fillField(
    page,
    runContext,
    "manual address line 2",
    passenger.addressLine2,
    /address line 2|address 2|area|building/i,
    ['input[name*="address2"]', 'input[id*="address2"]']
  );

  await fillField(
    page,
    runContext,
    "manual town or city",
    passenger.townCity,
    /town|city/i,
    ['input[name*="town"]', 'input[name*="city"]', 'input[id*="town"]']
  );

  await fillField(
    page,
    runContext,
    "manual postcode",
    passenger.postcode,
    /postcode|post code|postal code/i,
    ['input[name*="post"]', 'input[id*="post"]']
  );
}

async function throwIfStillOnPersonalDetailsWithErrors(page, runContext) {
  const bodyText = await getBodyText(page);

  if (
    /fill out your contact details/i.test(bodyText) &&
    /required field|please select a title|confirm email/i.test(bodyText)
  ) {
    addWarning(runContext, "Greater Anglia personal details step did not validate.", {
      bodyTextPreview: bodyText.slice(0, 1000),
    });

    throw new Error(
      "Greater Anglia personal details step did not validate. Check title, full name, email, confirm email, postcode and address selection mapping."
    );
  }
}

function getPassengerTitle(passenger = {}) {
  return (
    cleanText(passenger.title) ||
    cleanText(passenger.salutation) ||
    cleanText(process.env.GREATER_ANGLIA_DEFAULT_TITLE)
  );
}

async function clickByText(page, runContext, label, textRegex, extraSelectors = []) {
  const candidates = [
    {
      description: `role button ${textRegex}`,
      locator: () => page.getByRole("button", { name: textRegex }),
    },
    {
      description: `text ${textRegex}`,
      locator: () => page.getByText(textRegex),
    },
    ...extraSelectors.map((selector) => ({
      description: selector,
      locator: () => page.locator(selector),
    })),
  ];

  return tryLocatorAction(runContext, `Click ${label}`, candidates, async (locator) => {
    await locator.click();
  });
}

async function continueIfAvailable(page, runContext, stepName) {
  const clicked = await clickByText(
    page,
    runContext,
    `Continue after ${stepName}`,
    /continue|next/i,
    [
      'input[type="submit"]',
      'button[type="submit"]',
      'a:has-text("Continue")',
    ]
  );

  if (clicked) {
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  }

  return clicked;
}


function normaliseGreaterAngliaJourneyDate(value) {
  const normalised = normaliseDateForInput(value);

  if (!normalised) {
    return null;
  }

  return normalised.replace(/-/g, "/");
}

async function selectGreaterAngliaJourneyDate(page, runContext, value) {
  const targetDate = normaliseDateForInput(value);

  if (!targetDate) {
    throw new Error("Greater Anglia journey date is missing.");
  }

  const result = await page.evaluate(async (targetDateValue) => {
    function pad(value) {
      return String(value).padStart(2, "0");
    }

    function canonicalDate(value) {
      const text = String(value || "").trim();

      // YYYY-MM-DD or YYYY/MM/DD.
      let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);

      if (match) {
        return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
      }

      // DD-MM-YYYY or DD/MM/YYYY.
      match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);

      if (match) {
        return `${match[3]}-${pad(match[2])}-${pad(match[1])}`;
      }

      return text;
    }

    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.disabled
      );
    }

    function normaliseText(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function wait(milliseconds) {
      return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    }

    function nearbyText(element) {
      const chunks = [
        element.getAttribute("id"),
        element.getAttribute("name"),
        element.getAttribute("placeholder"),
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("class"),
      ];

      if (element.id) {
        document
          .querySelectorAll(`label[for="${CSS.escape(element.id)}"]`)
          .forEach((label) => chunks.push(label.innerText || label.textContent));
      }

      let current = element.parentElement;
      for (let depth = 0; depth < 5 && current; depth += 1) {
        chunks.push(current.innerText || current.textContent || "");
        current = current.parentElement;
      }

      return normaliseText(chunks.filter(Boolean).join(" "));
    }

    function setInputValue(input, nextValue) {
      input.scrollIntoView({ block: "center", inline: "center" });
      input.focus();

      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;

      if (valueSetter) {
        valueSetter.call(input, nextValue);
      } else {
        input.value = nextValue;
      }

      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    function selectRadio(radio) {
      radio.scrollIntoView({ block: "center", inline: "center" });
      radio.checked = true;
      radio.dispatchEvent(new Event("input", { bubbles: true }));
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      radio.click();

      if (window.jQuery) {
        try {
          window
            .jQuery(radio)
            .prop("checked", true)
            .trigger("change")
            .trigger("click");
        } catch {
          // Native events above remain authoritative.
        }
      }
    }

    const targetCanonicalDate = canonicalDate(targetDateValue);
    const [year, month, day] = targetCanonicalDate.split("-");
    const ukDisplayDate = `${day}/${month}/${year}`;
    const dateObject = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      12,
      0,
      0
    );

    const radios = Array.from(
      document.querySelectorAll(
        'input[type="radio"][name="delay-date"], input.datepick[type="radio"], input.jpsticky[type="radio"]'
      )
    );

    // The portal exposes five quick-date radio buttons. Use one when the exact
    // date is available because this follows the portal's normal interaction.
    const quickDateRadio = radios.find(
      (radio) => canonicalDate(radio.value) === targetCanonicalDate
    );

    if (quickDateRadio) {
      selectRadio(quickDateRadio);

      return {
        ok: quickDateRadio.checked === true,
        mode: "quick_date_radio",
        requestedDate: targetDateValue,
        canonicalDate: targetCanonicalDate,
        selectedRawValue: quickDateRadio.value,
        id: quickDateRadio.id || null,
        name: quickDateRadio.name || null,
        checked: quickDateRadio.checked === true,
      };
    }

    // Older journeys within the 28-day claim window are entered through the
    // sixth/custom date option. On the current Tracsis form this radio reports
    // value="on", so matching only radio values can never select the date.
    const customDateCandidates = radios
      .map((radio, index) => {
        const context = nearbyText(radio);
        let score = 0;

        if (/^on$/i.test(String(radio.value || ""))) score += 120;
        if (/^date5$/i.test(String(radio.id || ""))) score += 140;
        if (/date of journey/i.test(context)) score += 100;
        if (/within last 28 days/i.test(context)) score += 120;
        if (index === radios.length - 1) score += 30;

        return { radio, index, context, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const customDateChoice = customDateCandidates[0];

    if (!customDateChoice) {
      return {
        ok: false,
        reason: "No custom journey-date option was found.",
        targetDate: targetDateValue,
        targetCanonicalDate,
        availableDates: radios.map((radio) => ({
          raw: radio.value,
          canonical: canonicalDate(radio.value),
          id: radio.id || null,
        })),
      };
    }

    selectRadio(customDateChoice.radio);

    // The custom-date field is injected/revealed only after the radio button's
    // change handlers have completed. Querying for it in the same JavaScript
    // tick makes the executor report that no date was selected even though the
    // correct custom-date option was clicked.
    await wait(900);

    const customRadioRect = customDateChoice.radio.getBoundingClientRect();

    const dateInputs = Array.from(
      document.querySelectorAll(
        'input:not([type="radio"]):not([type="hidden"]):not([type="checkbox"]):not([type="submit"]):not([type="button"])'
      )
    )
      .filter(visible)
      .map((input, index) => {
        const rect = input.getBoundingClientRect();
        const direct = normaliseText(
          [
            input.id,
            input.name,
            input.type,
            input.placeholder,
            input.getAttribute("aria-label"),
            input.getAttribute("title"),
            input.className,
          ]
            .filter(Boolean)
            .join(" ")
        );
        const context = nearbyText(input);
        let score = 0;

        if (input.type === "date") score += 180;
        if (/date|journey/i.test(direct)) score += 130;
        if (/within last 28 days/i.test(direct)) score += 200;
        if (/date of journey/i.test(context)) score += 140;
        if (/within last 28 days/i.test(context)) score += 180;

        const verticalDistance = Math.abs(rect.top - customRadioRect.top);
        if (verticalDistance <= 120) score += 100;
        if (verticalDistance <= 60) score += 80;

        if (/email|postcode|post code|name|station|ticket|price|cost/i.test(direct)) {
          score -= 200;
        }

        return {
          input,
          index,
          direct,
          context: context.slice(0, 220),
          rect,
          score,
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top);

    const dateInputChoice = dateInputs[0];

    if (!dateInputChoice) {
      return {
        ok: false,
        reason: "The custom journey-date input did not become visible.",
        targetDate: targetDateValue,
        targetCanonicalDate,
        customRadio: {
          id: customDateChoice.radio.id || null,
          name: customDateChoice.radio.name || null,
          value: customDateChoice.radio.value || null,
          checked: customDateChoice.radio.checked === true,
          context: customDateChoice.context.slice(0, 220),
        },
      };
    }

    const dateInput = dateInputChoice.input;
    const valueForInput = dateInput.type === "date" ? targetCanonicalDate : ukDisplayDate;

    // Use the portal's date-picker plugin when present, then dispatch native
    // events as a fallback. This covers both jQuery UI and jquery-datepick.
    if (window.jQuery) {
      const jqueryInput = window.jQuery(dateInput);

      try {
        if (typeof jqueryInput.datepicker === "function") {
          jqueryInput.datepicker("setDate", dateObject);
        }
      } catch {
        // Continue with the other available date-setting methods.
      }

      try {
        if (typeof jqueryInput.datepick === "function") {
          jqueryInput.datepick("setDate", dateObject);
        }
      } catch {
        // Continue with direct value assignment.
      }
    }

    setInputValue(dateInput, valueForInput);

    if (window.jQuery) {
      try {
        window
          .jQuery(dateInput)
          .val(valueForInput)
          .trigger("input")
          .trigger("change")
          .trigger("blur");
      } catch {
        // Native events above remain authoritative.
      }
    }

    // Allow the portal's date-picker and validation handlers to synchronise
    // their visible and hidden values before we verify the result.
    await wait(350);

    // Some versions of the form reformat the field during the first blur. If
    // that process cleared the requested date, assign it once more and wait for
    // the final change handlers before reading the stored value.
    if (canonicalDate(dateInput.value) !== targetCanonicalDate) {
      setInputValue(dateInput, valueForInput);
      await wait(250);
    }

    const inputCanonicalDate = canonicalDate(dateInput.value);
    const matchingDateValues = Array.from(document.querySelectorAll("input"))
      .map((input) => ({
        id: input.id || null,
        name: input.name || null,
        type: input.type || null,
        value: input.value || null,
        canonical: canonicalDate(input.value),
      }))
      .filter((entry) => entry.canonical === targetCanonicalDate);

    return {
      ok:
        customDateChoice.radio.checked === true &&
        (inputCanonicalDate === targetCanonicalDate || matchingDateValues.length > 0),
      mode: "custom_date_input",
      requestedDate: targetDateValue,
      canonicalDate: targetCanonicalDate,
      ukDisplayDate,
      customRadio: {
        id: customDateChoice.radio.id || null,
        name: customDateChoice.radio.name || null,
        value: customDateChoice.radio.value || null,
        checked: customDateChoice.radio.checked === true,
        score: customDateChoice.score,
      },
      dateInput: {
        id: dateInput.id || null,
        name: dateInput.name || null,
        type: dateInput.type || null,
        className: dateInput.className || null,
        placeholder: dateInput.placeholder || null,
        assignedValue: valueForInput,
        finalValue: dateInput.value || null,
        canonicalValue: inputCanonicalDate,
        score: dateInputChoice.score,
      },
      matchingDateValues: matchingDateValues.slice(0, 8),
      availableDates: radios.map((radio) => ({
        raw: radio.value,
        canonical: canonicalDate(radio.value),
        id: radio.id || null,
      })),
    };
  }, targetDate);

  if (!result?.ok) {
    addLog(
      runContext,
      "Greater Anglia journey-date selection diagnostics.",
      result || {}
    );

    await captureScreenshot(
      page,
      runContext,
      "03a_journey_date_selection_failed"
    );

    addWarning(
      runContext,
      "Greater Anglia journey date could not be selected.",
      result || {}
    );

    throw new Error(
      `Greater Anglia journey date was not selected. Requested date: ${targetDate}`
    );
  }

  addStep(runContext, "Select journey date", result);

  const datePickerDismissal = await page.evaluate(() => {
    const hiddenSelectors = [];
    const dateInput = document.querySelector(
      '#datePickerValue, input[name="date"], input[placeholder*="last 28 days" i]'
    );

    if (dateInput && window.jQuery) {
      const jqueryInput = window.jQuery(dateInput);

      try {
        if (typeof jqueryInput.datepicker === "function") {
          jqueryInput.datepicker("hide");
        }
      } catch {
        // The portal may use jquery-datepick instead.
      }

      try {
        if (typeof jqueryInput.datepick === "function") {
          jqueryInput.datepick("hide");
        }
      } catch {
        // Native blur and the targeted popup fallback below still apply.
      }
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    document
      .querySelectorAll("#ui-datepicker-div, .ui-datepicker, .datepick-popup")
      .forEach((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        if (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        ) {
          element.style.display = "none";
          hiddenSelectors.push(
            element.id ? `#${element.id}` : `.${String(element.className).trim()}`
          );
        }
      });

    return {
      ok: true,
      hiddenPopupCount: hiddenSelectors.length,
      hiddenSelectors,
    };
  });

  addStep(runContext, "Close journey date picker", datePickerDismissal);

  await page.waitForTimeout(150).catch(() => {});

  return true;
}

async function setGreaterAngliaStyledSelect(page, runContext, label, value, kind) {
  const cleanValue = cleanText(value);

  if (!cleanValue) {
    throw new Error(`Greater Anglia ${label} is missing.`);
  }

  const result = await page.evaluate(
    ({ labelValue, desiredValue, selectKind }) => {
      function norm(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
      }

      function nearbyText(element) {
        const chunks = [
          element.getAttribute("id"),
          element.getAttribute("name"),
          element.getAttribute("title"),
          element.getAttribute("aria-label"),
        ];

        let current = element.parentElement;
        for (let depth = 0; depth < 4 && current; depth += 1) {
          chunks.push(current.innerText || current.textContent || "");
          current = current.parentElement;
        }

        return norm(chunks.filter(Boolean).join(" "));
      }

      const selects = Array.from(document.querySelectorAll("select"));

      const candidates = selects
        .map((select, index) => {
          const optionTexts = Array.from(select.options || []).map((option) =>
            norm(option.textContent)
          );
          const direct = norm(
            [
              select.id,
              select.name,
              select.title,
              select.getAttribute("aria-label"),
            ]
              .filter(Boolean)
              .join(" ")
          );
          const context = nearbyText(select);
          let score = 0;

          if (selectKind === "hour") {
            if (/hour/i.test(direct)) score += 150;
            if (/hour/i.test(context)) score += 60;
            if (optionTexts.includes("00") && optionTexts.includes("23")) score += 80;
            if (optionTexts.length >= 24 && optionTexts.length <= 30) score += 80;
            if (optionTexts.includes("59")) score -= 150;
          }

          if (selectKind === "minute") {
            if (/minute|min/i.test(direct)) score += 150;
            if (/minute/i.test(context)) score += 60;
            if (optionTexts.includes("00") && optionTexts.includes("59")) score += 120;
            if (optionTexts.length >= 55) score += 80;
          }

          const option = Array.from(select.options || []).find(
            (candidate) =>
              norm(candidate.textContent) === desiredValue ||
              norm(candidate.value) === desiredValue
          );

          if (option) score += 40;

          return {
            select,
            index,
            direct,
            context: context.slice(0, 180),
            optionTexts,
            option,
            score,
          };
        })
        .filter((entry) => entry.option && entry.score > 0)
        .sort((a, b) => b.score - a.score);

      const chosen = candidates[0];

      if (!chosen) {
        return {
          ok: false,
          reason: `No ${selectKind} select matched.`,
          desiredValue,
          selectCount: selects.length,
        };
      }

      const { select, option } = chosen;
      select.value = option.value;

      Array.from(select.options || []).forEach((candidate) => {
        candidate.selected = candidate === option;
      });

      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      select.dispatchEvent(new Event("blur", { bubbles: true }));

      if (window.jQuery) {
        try {
          window.jQuery(select).val(option.value).trigger("change");
        } catch {
          // Native value/events above remain authoritative.
        }
      }

      const styled =
        select.nextElementSibling?.matches?.(".styledSelect")
          ? select.nextElementSibling
          : select.parentElement?.querySelector?.(".styledSelect");

      if (styled) {
        styled.textContent = norm(option.textContent);
      }

      const selected = Array.from(select.options || []).find(
        (candidate) => candidate.selected
      );

      return {
        ok:
          norm(selected?.textContent) === desiredValue ||
          norm(select.value) === desiredValue ||
          norm(option.value) === norm(select.value),
        label: labelValue,
        kind: selectKind,
        index: chosen.index,
        id: select.id || null,
        name: select.name || null,
        className: select.className || null,
        selectedText: norm(selected?.textContent),
        selectedValue: norm(select.value),
        styledSelectFound: Boolean(styled),
        score: chosen.score,
      };
    },
    {
      labelValue: label,
      desiredValue: cleanValue,
      selectKind: kind,
    }
  );

  if (!result?.ok) {
    addWarning(runContext, `Greater Anglia ${label} could not be selected.`, result || {});
    throw new Error(`Greater Anglia ${label} was not selected.`);
  }

  addStep(runContext, `Select ${label}`, result);
  await page.waitForTimeout(250).catch(() => {});
  return true;
}

async function clickGreaterAngliaVisibleContinue(page, runContext, stepName) {
  const result = await page.evaluate(() => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.disabled
      );
    }

    function textFor(element) {
      return String(
        element.innerText ||
          element.textContent ||
          element.value ||
          element.getAttribute("aria-label") ||
          ""
      )
        .replace(/\s+/g, " ")
        .trim();
    }

    const candidates = Array.from(
      document.querySelectorAll(
        'button, a, input[type="submit"], input[type="button"], [role="button"]'
      )
    )
      .filter(visible)
      .map((element) => ({
        element,
        text: textFor(element),
        rect: element.getBoundingClientRect(),
      }))
      .filter((entry) => /^(continue|next)$/i.test(entry.text))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    const chosen = candidates[0];

    if (!chosen) {
      return {
        ok: false,
        reason: "No visible Continue/Next control was found.",
      };
    }

    chosen.element.scrollIntoView({ block: "center", inline: "center" });
    chosen.element.click();

    return {
      ok: true,
      text: chosen.text,
      tag: chosen.element.tagName.toLowerCase(),
      id: chosen.element.id || null,
      className: chosen.element.className || null,
      x: Math.round(chosen.rect.x),
      y: Math.round(chosen.rect.y),
    };
  });

  if (!result?.ok) {
    addWarning(runContext, `Visible Continue after ${stepName} could not be clicked.`, result || {});
    throw new Error(`Greater Anglia could not continue after ${stepName}.`);
  }

  addStep(runContext, `Click visible Continue after ${stepName}`, result);
  await page.waitForTimeout(300).catch(() => {});
  return true;
}

async function waitForGreaterAngliaVisibleText(page, textRegexSource, timeout = 10000) {
  await page.waitForFunction(
    (source) => {
      const regex = new RegExp(source, "i");

      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      }

      return Array.from(
        document.querySelectorAll("h1, h2, h3, h4, h5, legend, p, label, div")
      ).some((element) => {
        if (!visible(element)) return false;
        const text = String(element.innerText || element.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        return regex.test(text);
      });
    },
    textRegexSource,
    { timeout }
  );
}

async function fillGreaterAngliaJourneyStation(
  page,
  runContext,
  station,
  orderIndex,
  label
) {
  const cleanStation = cleanText(station);

  if (!cleanStation) {
    throw new Error(`Greater Anglia ${label} station is missing.`);
  }

  const target = await page.evaluate(
    ({ orderIndexValue, labelValue }) => {
      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const type = (element.getAttribute("type") || "text").toLowerCase();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled &&
          !element.readOnly &&
          !["hidden", "radio", "checkbox", "submit", "button"].includes(type)
        );
      }

      function norm(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
      }

      function contextText(element) {
        const chunks = [
          element.id,
          element.name,
          element.placeholder,
          element.title,
          element.getAttribute("aria-label"),
        ];

        let current = element.parentElement;
        for (let depth = 0; depth < 3 && current; depth += 1) {
          chunks.push(current.innerText || current.textContent || "");
          current = current.parentElement;
        }

        return norm(chunks.filter(Boolean).join(" "));
      }

      const inputs = Array.from(document.querySelectorAll("input"))
        .filter(visible)
        .map((element) => ({
          element,
          rect: element.getBoundingClientRect(),
          context: contextText(element),
        }))
        .filter((entry) => entry.rect.top > 200)
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

      // On the Journey Start and End Stations panel the portal exposes
      // exactly two visible editable station inputs in top-to-bottom order:
      // 0 = From, 1 = To.
      //
      // Do NOT use broad surrounding-text matching here. Both controls share a
      // parent container whose text contains "Journey Start and End Stations",
      // "From" and "To", so context matching can resolve both calls to the same
      // first input. That is what caused the destination to overwrite From.
      const chosen = inputs[orderIndexValue];

      if (!chosen) {
        return {
          ok: false,
          reason: `No visible ${labelValue} station input was found.`,
          visibleInputCount: inputs.length,
          sample: inputs.slice(0, 8).map((entry) => ({
            id: entry.element.id || null,
            name: entry.element.name || null,
            context: entry.context.slice(0, 140),
          })),
        };
      }

      return {
        ok: true,
        id: chosen.element.id || null,
        name: chosen.element.name || null,
        type: chosen.element.type || null,
        context: chosen.context.slice(0, 180),
      };
    },
    {
      orderIndexValue: orderIndex,
      labelValue: label,
    }
  );

  if (!target?.ok || (!target.id && !target.name)) {
    addWarning(runContext, `Greater Anglia ${label} station input could not be identified.`, target || {});
    throw new Error(`Greater Anglia ${label} station input was not found.`);
  }

  const locator = target.id
    ? page.locator(`#${target.id}`)
    : page.locator(`input[name="${target.name}"]`).filter({ visible: true });

  await locator.first().fill(cleanStation);
  await locator.first().dispatchEvent("input").catch(() => {});
  await locator.first().dispatchEvent("keyup").catch(() => {});
  await page.waitForTimeout(900).catch(() => {});

  const suggestion = await page.evaluate((stationValue) => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function norm(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    const stationNorm = norm(stationValue).toLowerCase();
    const candidates = Array.from(
      document.querySelectorAll(
        '[role="option"], .ui-autocomplete li, .autocomplete-suggestion, .typeahead li, ul li, li a'
      )
    )
      .filter(visible)
      .map((element) => ({
        element,
        text: norm(element.innerText || element.textContent),
        rect: element.getBoundingClientRect(),
      }))
      .filter((entry) => {
        const text = entry.text.toLowerCase();
        return (
          text === stationNorm ||
          text.startsWith(`${stationNorm} `) ||
          text.includes(stationNorm)
        );
      })
      .sort((a, b) => {
        const aExact = a.text.toLowerCase() === stationNorm ? 1 : 0;
        const bExact = b.text.toLowerCase() === stationNorm ? 1 : 0;
        return bExact - aExact || a.rect.top - b.rect.top;
      });

    const chosen = candidates[0];

    if (!chosen) {
      return { ok: false };
    }

    chosen.element.scrollIntoView({ block: "center", inline: "nearest" });
    chosen.element.click();

    return {
      ok: true,
      text: chosen.text.slice(0, 160),
      tag: chosen.element.tagName.toLowerCase(),
    };
  }, cleanStation);

  if (!suggestion?.ok) {
    // Common autocomplete fallback.
    await locator.first().press("ArrowDown").catch(() => {});
    await locator.first().press("Enter").catch(() => {});
  }

  await page.waitForTimeout(500).catch(() => {});

  addStep(runContext, `Fill ${label} station`, {
    station: cleanStation,
    target,
    suggestion,
  });

  return true;
}



async function verifyGreaterAngliaJourneyStations(page, runContext, journey) {
  const expectedFrom = cleanText(journey.fromStation);
  const expectedTo = cleanText(journey.toStation);

  const state = await page.evaluate(
    ({ expectedFromValue, expectedToValue }) => {
      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const type = (element.getAttribute("type") || "text").toLowerCase();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled &&
          !element.readOnly &&
          !["hidden", "radio", "checkbox", "submit", "button"].includes(type)
        );
      }

      function norm(text) {
        return String(text || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      const inputs = Array.from(document.querySelectorAll("input"))
        .filter(visible)
        .map((element) => ({
          element,
          rect: element.getBoundingClientRect(),
        }))
        .filter((entry) => entry.rect.top > 200)
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

      const fromValue = inputs[0]?.element?.value || "";
      const toValue = inputs[1]?.element?.value || "";

      const fromMatches =
        norm(fromValue) === norm(expectedFromValue) ||
        norm(fromValue).includes(norm(expectedFromValue));

      const toMatches =
        norm(toValue) === norm(expectedToValue) ||
        norm(toValue).includes(norm(expectedToValue));

      return {
        ok: Boolean(inputs[0] && inputs[1] && fromMatches && toMatches),
        visibleInputCount: inputs.length,
        from: {
          id: inputs[0]?.element?.id || null,
          name: inputs[0]?.element?.name || null,
          value: fromValue,
          expected: expectedFromValue,
          matches: fromMatches,
        },
        to: {
          id: inputs[1]?.element?.id || null,
          name: inputs[1]?.element?.name || null,
          value: toValue,
          expected: expectedToValue,
          matches: toMatches,
        },
      };
    },
    {
      expectedFromValue: expectedFrom,
      expectedToValue: expectedTo,
    }
  );

  addLog(runContext, "Greater Anglia journey station verification.", state || {});

  if (!state?.ok) {
    await captureScreenshot(
      page,
      runContext,
      "03c_journey_station_verification_failed"
    );

    throw new Error(
      "Greater Anglia journey stations were not populated correctly."
    );
  }

  addStep(runContext, "Verify journey stations", state);
  return true;
}

function normaliseTimeForComparison(hour, minute) {
  const cleanHour = cleanText(hour);
  const cleanMinute = cleanText(minute);

  if (!cleanHour || !cleanMinute) {
    return null;
  }

  const hourNumber = Number(cleanHour);
  const minuteNumber = Number(cleanMinute);

  if (
    !Number.isInteger(hourNumber) ||
    !Number.isInteger(minuteNumber) ||
    hourNumber < 0 ||
    hourNumber > 23 ||
    minuteNumber < 0 ||
    minuteNumber > 59
  ) {
    return null;
  }

  return `${String(hourNumber).padStart(2, "0")}:${String(minuteNumber).padStart(2, "0")}`;
}

async function selectGreaterAngliaJourneyTrain(page, runContext, journey) {
  const fromStation = cleanText(journey.fromStation);
  const toStation = cleanText(journey.toStation);
  const scheduledTime = normaliseTimeForComparison(
    journey.scheduledDepartureHour,
    journey.scheduledDepartureMinute
  );

  if (!fromStation || !toStation || !scheduledTime) {
    throw new Error(
      "Greater Anglia train selection requires the journey stations and exact scheduled departure time."
    );
  }

  const result = await page.evaluate(
    ({ fromStationValue, toStationValue, scheduledTimeValue }) => {
      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled
        );
      }

      function displayText(element) {
        return String(
          element.innerText ||
            element.textContent ||
            element.value ||
            element.getAttribute("aria-label") ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim();
      }

      function normalise(text) {
        return String(text || "")
          .toLowerCase()
          .replace(/&/g, " and ")
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function timeToMinutes(value) {
        const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);

        if (!match) return null;

        const hours = Number(match[1]);
        const minutes = Number(match[2]);

        if (hours > 23 || minutes > 59) return null;
        return hours * 60 + minutes;
      }

      function unique(values) {
        return values.filter(
          (value, index, allValues) => allValues.indexOf(value) === index
        );
      }

      const expectedFrom = normalise(fromStationValue);
      const expectedTo = normalise(toStationValue);
      const expectedDepartureMinutes = timeToMinutes(scheduledTimeValue);

      const viewControls = Array.from(
        document.querySelectorAll(
          'button, a, input[type="submit"], input[type="button"], [role="button"]'
        )
      )
        .filter(visible)
        .filter((element) => /^view this journey$/i.test(displayText(element)));

      const candidates = viewControls.map((control, controlIndex) => {
        let current = control.parentElement;
        let chosenContainer = null;
        let fallbackContainer = null;

        // Choose the smallest ancestor that contains this single journey's
        // route and times. Avoid a larger results wrapper containing every
        // "View this Journey" control.
        for (let depth = 0; depth < 9 && current; depth += 1) {
          const currentText = displayText(current);
          const currentNormalised = normalise(currentText);
          const routeMatches =
            currentNormalised.includes(expectedFrom) &&
            currentNormalised.includes(expectedTo);

          if (routeMatches && !fallbackContainer) {
            fallbackContainer = current;
          }

          const viewCount = Array.from(
            current.querySelectorAll(
              'button, a, input[type="submit"], input[type="button"], [role="button"]'
            )
          )
            .filter(visible)
            .filter((element) =>
              /^view this journey$/i.test(displayText(element))
            ).length;

          const timeCount = (currentText.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) || [])
            .length;

          if (routeMatches && viewCount === 1 && timeCount >= 2) {
            chosenContainer = current;
            break;
          }

          current = current.parentElement;
        }

        const container = chosenContainer || fallbackContainer || control.parentElement;
        const cardText = displayText(container);
        const cardNormalised = normalise(cardText);
        const times = unique(
          cardText.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) || []
        );

        const timeCandidates = times
          .map((time) => ({
            time,
            minutes: timeToMinutes(time),
          }))
          .filter((entry) => entry.minutes !== null)
          .map((entry) => ({
            ...entry,
            differenceMinutes: Math.abs(
              entry.minutes - expectedDepartureMinutes
            ),
          }))
          .sort(
            (a, b) =>
              a.differenceMinutes - b.differenceMinutes ||
              a.minutes - b.minutes
          );

        const departure = timeCandidates[0] || null;
        const fromMatches = cardNormalised.includes(expectedFrom);
        const toMatches = cardNormalised.includes(expectedTo);
        const routeMatches = fromMatches && toMatches;
        const rect = control.getBoundingClientRect();

        return {
          control,
          controlIndex,
          routeMatches,
          fromMatches,
          toMatches,
          departureTime: departure?.time || null,
          differenceMinutes: departure?.differenceMinutes ?? 9999,
          times,
          cardText: cardText.slice(0, 600),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
        };
      });

      const ranked = candidates
        .filter(
          (candidate) =>
            candidate.routeMatches && candidate.departureTime !== null
        )
        .sort(
          (a, b) =>
            a.differenceMinutes - b.differenceMinutes ||
            a.y - b.y ||
            a.controlIndex - b.controlIndex
        );

      const chosen = ranked[0];

      const diagnostics = candidates.map((candidate) => ({
        controlIndex: candidate.controlIndex,
        routeMatches: candidate.routeMatches,
        fromMatches: candidate.fromMatches,
        toMatches: candidate.toMatches,
        departureTime: candidate.departureTime,
        differenceMinutes: candidate.differenceMinutes,
        times: candidate.times,
        cardText: candidate.cardText,
        x: candidate.x,
        y: candidate.y,
      }));

      if (!chosen) {
        return {
          ok: false,
          reason: "No matching journey result could be identified.",
          expected: {
            fromStation: fromStationValue,
            toStation: toStationValue,
            scheduledTime: scheduledTimeValue,
          },
          viewControlCount: viewControls.length,
          candidates: diagnostics,
        };
      }

      chosen.control.scrollIntoView({ block: "center", inline: "center" });
      chosen.control.click();

      return {
        ok: true,
        expected: {
          fromStation: fromStationValue,
          toStation: toStationValue,
          scheduledTime: scheduledTimeValue,
        },
        selected: {
          controlIndex: chosen.controlIndex,
          departureTime: chosen.departureTime,
          differenceMinutes: chosen.differenceMinutes,
          times: chosen.times,
          cardText: chosen.cardText,
          x: chosen.x,
          y: chosen.y,
        },
        candidates: diagnostics,
      };
    },
    {
      fromStationValue: fromStation,
      toStationValue: toStation,
      scheduledTimeValue: scheduledTime,
    }
  );

  addLog(runContext, "Greater Anglia train-selection diagnostics.", result || {});

  if (!result?.ok) {
    await captureScreenshot(
      page,
      runContext,
      "03e_matching_train_not_found"
    );

    addWarning(
      runContext,
      "Greater Anglia matching train could not be selected.",
      result || {}
    );

    throw new Error(
      `Greater Anglia could not identify the ${scheduledTime} ${fromStation} to ${toStation} journey.`
    );
  }

  addStep(runContext, "Open matching train result", result);
  await page.waitForTimeout(1200).catch(() => {});

  await captureScreenshot(
    page,
    runContext,
    "03e_matching_train_opened"
  );

  return result;
}

async function confirmExpandedGreaterAngliaJourneyIfRequired(
  page,
  runContext,
  journey
) {
  const fromStation = cleanText(journey.fromStation);
  const toStation = cleanText(journey.toStation);

  const result = await page.evaluate(
    ({ fromStationValue, toStationValue }) => {
      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled
        );
      }

      function displayText(element) {
        return String(
          element.innerText ||
            element.textContent ||
            element.value ||
            element.getAttribute("aria-label") ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim();
      }

      function normalise(text) {
        return String(text || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      const expectedFrom = normalise(fromStationValue);
      const expectedTo = normalise(toStationValue);
      const controls = Array.from(
        document.querySelectorAll(
          'button, a, input[type="submit"], input[type="button"], [role="button"]'
        )
      )
        .filter(visible)
        .map((element, index) => {
          const text = displayText(element);
          let current = element.parentElement;
          let context = "";

          for (let depth = 0; depth < 6 && current; depth += 1) {
            const currentText = displayText(current);
            const currentNormalised = normalise(currentText);

            if (
              currentNormalised.includes(expectedFrom) &&
              currentNormalised.includes(expectedTo)
            ) {
              context = currentText;
              break;
            }

            current = current.parentElement;
          }

          const routeContext = normalise(context);
          const routeMatches =
            routeContext.includes(expectedFrom) &&
            routeContext.includes(expectedTo);
          let score = 0;
          let confirmationLabelMatches = false;

          if (/^select this journey$/i.test(text)) {
            score += 500;
            confirmationLabelMatches = true;
          } else if (/^select journey$/i.test(text)) {
            score += 480;
            confirmationLabelMatches = true;
          } else if (/^choose this journey$/i.test(text)) {
            score += 470;
            confirmationLabelMatches = true;
          } else if (/^use this journey$/i.test(text)) {
            score += 460;
            confirmationLabelMatches = true;
          } else if (/^this is my journey$/i.test(text)) {
            score += 450;
            confirmationLabelMatches = true;
          } else if (/^claim for this journey$/i.test(text)) {
            score += 440;
            confirmationLabelMatches = true;
          } else if (/^select (?:this )?(?:train|service)$/i.test(text)) {
            score += 430;
            confirmationLabelMatches = true;
          } else if (/^(?:yes,? )?this is (?:my|the correct) journey$/i.test(text)) {
            score += 420;
            confirmationLabelMatches = true;
          } else if (routeMatches && /^(select|continue|confirm)$/i.test(text)) {
            score += 350;
            confirmationLabelMatches = true;
          }

          if (confirmationLabelMatches && routeMatches) score += 200;

          return {
            element,
            index,
            text,
            routeMatches,
            context: context.slice(0, 500),
            confirmationLabelMatches,
            score,
          };
        })
        .filter((entry) => entry.confirmationLabelMatches && entry.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index);

      const chosen = controls[0];

      if (!chosen) {
        return {
          ok: true,
          clicked: false,
          reason:
            "No secondary journey-confirmation control was visible; the first click may have selected the train directly.",
        };
      }

      chosen.element.scrollIntoView({ block: "center", inline: "center" });
      chosen.element.click();

      return {
        ok: true,
        clicked: true,
        text: chosen.text,
        routeMatches: chosen.routeMatches,
        context: chosen.context,
        score: chosen.score,
      };
    },
    {
      fromStationValue: fromStation,
      toStationValue: toStation,
    }
  );

  if (result?.clicked) {
    addStep(runContext, "Confirm expanded matching train", result);
    await page.waitForTimeout(1200).catch(() => {});
  } else {
    addLog(
      runContext,
      "No secondary Greater Anglia journey confirmation was required.",
      result || {}
    );
  }

  return result;
}

async function selectGreaterAngliaJourneyDelayDetails(
  page,
  runContext,
  journey
) {
  const delayBand = cleanText(journey.delayBand) || "15+ Mins";
  const delayType = cleanText(journey.delayType) || "Delayed";

  // The Tracsis portal renders these choices as large cards backed by native
  // radio controls. Click the smallest visible matching control/label so this
  // continues to work whether the card itself or its hidden input receives the
  // event in a later portal release.
  const result = await page.evaluate(
    ({ delayBandValue, delayTypeValue }) => {
      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled
        );
      }

      function displayText(element) {
        return String(
          element.innerText ||
            element.textContent ||
            element.value ||
            element.getAttribute("aria-label") ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim();
      }

      function normalise(text) {
        return String(text || "")
          .toLowerCase()
          .replace(/\+/g, " plus ")
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function getLinkedInput(element) {
        if (element.matches('input[type="radio"], input[type="checkbox"]')) {
          return element;
        }

        if (element.tagName === "LABEL") {
          const forId = element.getAttribute("for");

          if (forId) {
            const linked = document.getElementById(forId);
            if (linked) return linked;
          }

          const nested = element.querySelector(
            'input[type="radio"], input[type="checkbox"]'
          );
          if (nested) return nested;
        }

        return element.querySelector?.(
          'input[type="radio"], input[type="checkbox"]'
        ) || null;
      }

      function clickChoice(targetText) {
        const expected = normalise(targetText);
        const selector = [
          "button",
          "a",
          "label",
          'input[type="radio"]',
          'input[type="button"]',
          '[role="button"]',
          '[role="radio"]',
          "[data-value]",
        ].join(",");

        const candidates = Array.from(document.querySelectorAll(selector))
          .filter((element) => visible(element) || element.matches('input[type="radio"]'))
          .map((element, index) => {
            const text = displayText(element);
            const value = String(element.value || element.getAttribute("data-value") || "");
            const ariaLabel = String(element.getAttribute("aria-label") || "");
            const linkedInput = getLinkedInput(element);
            const exactText = normalise(text) === expected;
            const exactValue = normalise(value) === expected;
            const exactAriaLabel = normalise(ariaLabel) === expected;
            const rect = element.getBoundingClientRect();
            let score = 0;

            if (exactText) score += 500;
            if (exactValue) score += 480;
            if (exactAriaLabel) score += 470;
            if (element.tagName === "LABEL") score += 80;
            if (element.matches('button, [role="button"], [role="radio"]')) {
              score += 70;
            }
            if (linkedInput) score += 40;
            if (visible(element)) score += 30;

            return {
              element,
              linkedInput,
              index,
              text,
              value,
              ariaLabel,
              exactText,
              exactValue,
              exactAriaLabel,
              score,
              area: Math.max(1, rect.width * rect.height),
              tag: element.tagName.toLowerCase(),
              id: element.id || null,
              className: String(element.className || ""),
            };
          })
          .filter(
            (candidate) =>
              candidate.exactText ||
              candidate.exactValue ||
              candidate.exactAriaLabel
          )
          .sort(
            (a, b) =>
              b.score - a.score ||
              a.area - b.area ||
              a.index - b.index
          );

        const chosen = candidates[0];

        if (!chosen) {
          return {
            ok: false,
            targetText,
            reason: "No visible matching delay choice was found.",
          };
        }

        chosen.element.scrollIntoView({ block: "center", inline: "center" });
        chosen.element.click();

        const linkedInput = chosen.linkedInput;
        const selected = Boolean(
          linkedInput?.checked ||
            chosen.element.getAttribute("aria-checked") === "true" ||
            chosen.element.getAttribute("aria-pressed") === "true" ||
            /selected|active|checked/i.test(
              `${chosen.element.className || ""} ${chosen.element.parentElement?.className || ""}`
            )
        );

        return {
          ok: true,
          targetText,
          selected,
          text: chosen.text,
          value: chosen.value,
          tag: chosen.tag,
          id: chosen.id,
          className: chosen.className,
          linkedInput: linkedInput
            ? {
                id: linkedInput.id || null,
                name: linkedInput.name || null,
                value: linkedInput.value || null,
                checked: Boolean(linkedInput.checked),
              }
            : null,
          candidateCount: candidates.length,
        };
      }

      const delayBandResult = clickChoice(delayBandValue);
      const delayTypeResult = clickChoice(delayTypeValue);

      return {
        ok: Boolean(delayBandResult.ok && delayTypeResult.ok),
        delayBand: delayBandResult,
        delayType: delayTypeResult,
      };
    },
    {
      delayBandValue: delayBand,
      delayTypeValue: delayType,
    }
  );

  addLog(runContext, "Greater Anglia journey delay-detail selection.", {
    expectedDelayBand: delayBand,
    expectedDelayType: delayType,
    ...(result || {}),
  });

  if (!result?.ok) {
    await captureScreenshot(
      page,
      runContext,
      "03g_journey_delay_details_selection_failed"
    );

    throw new Error(
      `Greater Anglia journey delay details could not select ${delayBand} and ${delayType}.`
    );
  }

  addStep(runContext, "Select journey delay details", {
    expectedDelayBand: delayBand,
    expectedDelayType: delayType,
    ...result,
  });

  await page.waitForTimeout(500).catch(() => {});
  return result;
}

async function selectGreaterAngliaTicketBarcodePath(
  page,
  runContext,
  ticket
) {
  const hasBarcode = ticket.hasBarcode === true;
  const expectedChoice = hasBarcode
    ? "Barcode"
    : "My Ticket does NOT have a Barcode";

  // Ticket Details starts with two large image cards rather than a
  // conventional labelled input. Select only the exact mapped card and prefer
  // the smallest visible matching element so an outer page container cannot
  // accidentally receive the click.
  const result = await page.evaluate(
    ({ expectedChoiceValue, hasBarcodeValue }) => {
      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled
        );
      }

      function normalise(text) {
        return String(text || "")
          .toLowerCase()
          .replace(/[’']/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function displayText(element) {
        return String(
          element.innerText ||
            element.textContent ||
            element.value ||
            element.getAttribute("aria-label") ||
            element.querySelector("img")?.getAttribute("alt") ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim();
      }

      function linkedInputFor(element) {
        if (element.matches('input[type="radio"], input[type="checkbox"]')) {
          return element;
        }

        if (element.tagName === "LABEL") {
          const forId = element.getAttribute("for");
          if (forId) {
            const linked = document.getElementById(forId);
            if (linked) return linked;
          }
        }

        return (
          element.querySelector?.(
            'input[type="radio"], input[type="checkbox"]'
          ) || null
        );
      }

      const expected = normalise(expectedChoiceValue);
      const allElements = Array.from(document.querySelectorAll("body *"));
      const candidates = allElements
        .filter(visible)
        .map((element, index) => {
          const text = displayText(element);
          const value = String(element.value || "");
          const ariaLabel = String(element.getAttribute("aria-label") || "");
          const rect = element.getBoundingClientRect();
          const exactText = normalise(text) === expected;
          const exactValue = normalise(value) === expected;
          const exactAria = normalise(ariaLabel) === expected;
          const linkedInput = linkedInputFor(element);
          const isInteractive = element.matches(
            'button, a, label, input, [role="button"], [role="radio"], [onclick]'
          );
          let score = 0;

          if (exactText) score += 600;
          if (exactValue) score += 580;
          if (exactAria) score += 570;
          if (isInteractive) score += 120;
          if (element.tagName === "LABEL") score += 100;
          if (linkedInput) score += 80;
          if (/barcode|ticket/i.test(`${element.id} ${element.className}`)) {
            score += 30;
          }

          return {
            element,
            linkedInput,
            index,
            text,
            value,
            ariaLabel,
            exactText,
            exactValue,
            exactAria,
            isInteractive,
            score,
            area: Math.max(1, rect.width * rect.height),
            tag: element.tagName.toLowerCase(),
            id: element.id || null,
            className: String(element.className || ""),
          };
        })
        .filter(
          (candidate) =>
            candidate.exactText || candidate.exactValue || candidate.exactAria
        )
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.area - b.area ||
            a.index - b.index
        );

      const chosen = candidates[0];

      if (!chosen) {
        return {
          ok: false,
          expectedChoice: expectedChoiceValue,
          hasBarcode: hasBarcodeValue,
          reason: "No exact visible ticket barcode card was found.",
        };
      }

      chosen.element.scrollIntoView({ block: "center", inline: "center" });
      chosen.element.click();

      return {
        ok: true,
        clicked: true,
        expectedChoice: expectedChoiceValue,
        hasBarcode: hasBarcodeValue,
        selectedText: chosen.text,
        selectedValue: chosen.value,
        tag: chosen.tag,
        id: chosen.id,
        className: chosen.className,
        linkedInput: chosen.linkedInput
          ? {
              id: chosen.linkedInput.id || null,
              name: chosen.linkedInput.name || null,
              value: chosen.linkedInput.value || null,
              checked: Boolean(chosen.linkedInput.checked),
            }
          : null,
        candidateCount: candidates.length,
      };
    },
    {
      expectedChoiceValue: expectedChoice,
      hasBarcodeValue: hasBarcode,
    }
  );

  addLog(runContext, "Greater Anglia ticket barcode-path selection.", result || {});

  if (!result?.ok) {
    await captureScreenshot(
      page,
      runContext,
      "04a_ticket_barcode_path_selection_failed"
    );

    throw new Error(
      `Greater Anglia could not select the ticket barcode choice: ${expectedChoice}.`
    );
  }

  addStep(runContext, "Select ticket barcode path", result);
  await page.waitForTimeout(1200).catch(() => {});
  return result;
}

async function selectGreaterAngliaTicketFormat(page, runContext, ticket) {
  const mappedTicketFormat = cleanText(ticket.ticketFormat);
  const normalisedMappedFormat = mappedTicketFormat
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const supportedFormats = new Map([
    ["collection reference", "Collection Reference"],
    ["oyster", "Oyster Card"],
    ["oyster card", "Oyster Card"],
    ["smart card", "Smartcard"],
    ["smartcard", "Smartcard"],
    ["contactless", "Other Contactless"],
    ["other contactless", "Other Contactless"],
    ["paper", "Paper"],
    ["paper ticket", "Paper"],
  ]);
  const expectedFormat = supportedFormats.get(normalisedMappedFormat);

  if (!expectedFormat) {
    throw new Error(
      `Greater Anglia cannot safely map ticket format "${mappedTicketFormat || "Not recorded"}" to a verified portal option.`
    );
  }

  // Select the exact mapped Ticket Format card. As with the barcode
  // cards, the live portal uses styled containers around hidden form controls,
  // so prefer an exact visible interactive match and verify any linked input.
  const result = await page.evaluate(
    ({ expectedFormatValue, mappedTicketFormatValue }) => {
      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          !element.disabled
        );
      }

      function normalise(text) {
        return String(text || "")
          .toLowerCase()
          .replace(/[’']/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function displayText(element) {
        return String(
          element.innerText ||
            element.textContent ||
            element.value ||
            element.getAttribute("aria-label") ||
            element.querySelector("img")?.getAttribute("alt") ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim();
      }

      function linkedInputFor(element) {
        if (element.matches('input[type="radio"], input[type="checkbox"]')) {
          return element;
        }

        if (element.tagName === "LABEL") {
          const forId = element.getAttribute("for");
          if (forId) {
            const linked = document.getElementById(forId);
            if (linked) return linked;
          }
        }

        const ownInput = element.querySelector?.(
          'input[type="radio"], input[type="checkbox"]'
        );
        if (ownInput) return ownInput;

        const interactiveParent = element.closest?.(
          'label, a, button, [role="button"], [role="radio"], [onclick]'
        );
        return (
          interactiveParent?.querySelector?.(
            'input[type="radio"], input[type="checkbox"]'
          ) || null
        );
      }

      const expected = normalise(expectedFormatValue);
      const allElements = Array.from(document.querySelectorAll("body *"));
      const candidates = allElements
        .filter(visible)
        .map((element, index) => {
          const text = displayText(element);
          const value = String(element.value || "");
          const ariaLabel = String(element.getAttribute("aria-label") || "");
          const rect = element.getBoundingClientRect();
          const exactText = normalise(text) === expected;
          const exactValue = normalise(value) === expected;
          const exactAria = normalise(ariaLabel) === expected;
          const linkedInput = linkedInputFor(element);
          const isInteractive = element.matches(
            'button, a, label, input, [role="button"], [role="radio"], [onclick]'
          );
          let score = 0;

          if (exactText) score += 600;
          if (exactValue) score += 580;
          if (exactAria) score += 570;
          if (isInteractive) score += 120;
          if (element.tagName === "LABEL") score += 100;
          if (linkedInput) score += 80;
          if (/ticket|format|smart|oyster|paper|contactless/i.test(
            `${element.id} ${element.className}`
          )) {
            score += 30;
          }

          return {
            element,
            linkedInput,
            index,
            text,
            value,
            ariaLabel,
            exactText,
            exactValue,
            exactAria,
            score,
            area: Math.max(1, rect.width * rect.height),
            tag: element.tagName.toLowerCase(),
            id: element.id || null,
            className: String(element.className || ""),
          };
        })
        .filter(
          (candidate) =>
            candidate.exactText || candidate.exactValue || candidate.exactAria
        )
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.area - b.area ||
            a.index - b.index
        );

      const chosen = candidates[0];

      if (!chosen) {
        return {
          ok: false,
          expectedFormat: expectedFormatValue,
          mappedTicketFormat: mappedTicketFormatValue,
          reason: "No exact visible ticket-format card was found.",
        };
      }

      chosen.element.scrollIntoView({ block: "center", inline: "center" });
      chosen.element.click();

      const linkedInput = chosen.linkedInput;
      const selected = linkedInput
        ? Boolean(linkedInput.checked)
        : chosen.element.getAttribute("aria-checked") === "true" ||
          chosen.element.classList.contains("active") ||
          chosen.element.classList.contains("selected");

      return {
        ok: true,
        clicked: true,
        selected,
        expectedFormat: expectedFormatValue,
        mappedTicketFormat: mappedTicketFormatValue,
        selectedText: chosen.text,
        selectedValue: chosen.value,
        tag: chosen.tag,
        id: chosen.id,
        className: chosen.className,
        linkedInput: linkedInput
          ? {
              id: linkedInput.id || null,
              name: linkedInput.name || null,
              value: linkedInput.value || null,
              checked: Boolean(linkedInput.checked),
            }
          : null,
        candidateCount: candidates.length,
      };
    },
    {
      expectedFormatValue: expectedFormat,
      mappedTicketFormatValue: mappedTicketFormat,
    }
  );

  addLog(runContext, "Greater Anglia ticket-format selection.", result || {});

  if (!result?.ok) {
    await captureScreenshot(
      page,
      runContext,
      "04c_ticket_format_selection_failed"
    );

    throw new Error(
      `Greater Anglia could not select the mapped ticket format: ${expectedFormat}.`
    );
  }

  addStep(runContext, "Select ticket format", result);
  await page.waitForTimeout(500).catch(() => {});
  return result;
}

async function fillGreaterAngliaSmartcardNumber(page, runContext, ticket) {
  const smartcardNumber = cleanText(ticket.smartcardNumber);

  if (!smartcardNumber) {
    throw new Error(
      "Greater Anglia Smartcard Number is required, but Delai has no mapped smartcard number for this ticket."
    );
  }

  // The live Smartcard control is appended after the journey form
  // controls, so find it from its visible label/context rather than relying on
  // a fixed control index or an unverified portal-specific id.
  const result = await page.evaluate((expectedValue) => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.disabled &&
        !element.readOnly
      );
    }

    function normalise(text) {
      return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function controlValue(element) {
      if (element.matches('[contenteditable="true"]')) {
        return String(element.textContent || "").trim();
      }

      return String(element.value || "").trim();
    }

    function setControlValue(element, value) {
      element.scrollIntoView({ block: "center", inline: "center" });
      element.focus();

      if (element.matches('[contenteditable="true"]')) {
        element.textContent = value;
      } else {
        const prototype =
          element.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

        if (setter) {
          setter.call(element, value);
        } else {
          element.value = value;
        }
      }

      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    function descriptorFor(element) {
      return [
        element.getAttribute("placeholder"),
        element.getAttribute("aria-label"),
        element.getAttribute("name"),
        element.getAttribute("id"),
        element.getAttribute("formcontrolname"),
        element.getAttribute("data-placeholder"),
      ]
        .filter(Boolean)
        .join(" ");
    }

    function labelTextFor(element) {
      const chunks = [];

      if (element.id) {
        document
          .querySelectorAll(`label[for="${CSS.escape(element.id)}"]`)
          .forEach((label) => chunks.push(label.innerText || label.textContent));
      }

      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .forEach((label) => chunks.push(label.innerText || label.textContent));
      }

      const parentLabel = element.closest("label");
      if (parentLabel) {
        chunks.push(parentLabel.innerText || parentLabel.textContent);
      }

      return chunks.filter(Boolean).join(" ");
    }

    function nearbyTextFor(element) {
      const chunks = [];
      let current = element.parentElement;

      for (let depth = 0; depth < 5 && current; depth += 1) {
        if (
          current.matches(
            ".form-group, .form-row, .field, .input-field, .form-control-wrapper, .row, li, td, section, article, div"
          )
        ) {
          chunks.push(current.innerText || current.textContent);
        }
        current = current.parentElement;
      }

      return chunks.filter(Boolean).join(" ");
    }

    const controls = Array.from(
      document.querySelectorAll(
        'input, textarea, [contenteditable="true"]'
      )
    )
      .filter(visible)
      .filter((element) => {
        const type = String(element.getAttribute("type") || "text").toLowerCase();
        return ![
          "hidden",
          "checkbox",
          "radio",
          "submit",
          "button",
          "file",
        ].includes(type);
      });

    const candidates = controls
      .map((element, index) => {
        const descriptor = descriptorFor(element);
        const labelText = labelTextFor(element);
        const nearbyText = nearbyTextFor(element);
        const direct = normalise(descriptor);
        const label = normalise(labelText);
        const nearby = normalise(nearbyText);
        let score = 0;

        if (/smartcard number|smart card number/.test(direct)) score += 500;
        if (/smartcard|smart card/.test(direct)) score += 260;
        if (/card number/.test(direct)) score += 220;
        if (/smartcard number|smart card number/.test(label)) score += 420;
        if (/smartcard number|smart card number/.test(nearby)) score += 160;
        if (/smartcard details|smart card details/.test(nearby)) score += 80;
        if (controls.length === 1) score += 60;

        if (/postcode|post code|email|phone|mobile|account|bank/.test(direct)) {
          score -= 600;
        }

        const rect = element.getBoundingClientRect();

        return {
          element,
          index,
          score,
          descriptor,
          labelText: String(labelText || "").replace(/\s+/g, " ").trim(),
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute("type") || null,
          id: element.id || null,
          name: element.getAttribute("name") || null,
          className: String(element.className || ""),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    const chosen = candidates[0];

    if (!chosen) {
      return {
        ok: false,
        reason: "No visible Smartcard Number control could be identified.",
        visibleEditableControlCount: controls.length,
        visibleEditableControls: controls.slice(0, 20).map((element) => ({
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute("type") || null,
          id: element.id || null,
          name: element.getAttribute("name") || null,
          descriptor: descriptorFor(element),
          labelText: String(labelTextFor(element) || "")
            .replace(/\s+/g, " ")
            .trim(),
        })),
      };
    }

    setControlValue(chosen.element, expectedValue);
    const actualValue = controlValue(chosen.element);
    const expectedDigits = String(expectedValue).replace(/\D/g, "");
    const actualDigits = String(actualValue).replace(/\D/g, "");
    const matches =
      actualValue === expectedValue ||
      (expectedDigits.length > 0 && actualDigits === expectedDigits);

    return {
      ok: matches,
      matches,
      score: chosen.score,
      descriptor: chosen.descriptor,
      labelText: chosen.labelText,
      tag: chosen.tag,
      type: chosen.type,
      id: chosen.id,
      name: chosen.name,
      className: chosen.className,
      x: chosen.x,
      y: chosen.y,
      width: chosen.width,
      height: chosen.height,
      expectedLength: String(expectedValue).length,
      actualLength: actualValue.length,
      lastFour: actualValue.slice(-4),
      candidateCount: candidates.length,
    };
  }, smartcardNumber);

  addLog(runContext, "Greater Anglia Smartcard Number fill and verification.", result || {});

  if (!result?.ok || !result?.matches) {
    await captureScreenshot(
      page,
      runContext,
      "04e_smartcard_number_fill_failed"
    );

    throw new Error(
      "Greater Anglia could not safely fill and verify the mapped Smartcard Number."
    );
  }

  addStep(runContext, "Fill and verify Smartcard Number", result);
  await page.waitForTimeout(500).catch(() => {});
  return result;
}

async function inspectGreaterAngliaTicketState(page) {
  return page.evaluate(() => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    const visibleText = Array.from(
      document.querySelectorAll(
        "main, form, h1, h2, h3, h4, h5, legend, p, label, section, article, .content, .container"
      )
    )
      .filter(visible)
      .map((element) => String(element.innerText || element.textContent || ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const bodyText = String(document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .trim();

    const barcodeChoiceStillVisible =
      /does your ticket have a barcode/i.test(visibleText) &&
      /my ticket does not have a barcode/i.test(visibleText);
    const ticketCountReached =
      /more than one ticket|how many tickets|single ticket|one ticket/i.test(
        visibleText
      );
    const ticketTypeReached =
      /what type of ticket|ticket type|season ticket|annual season|weekly season|monthly season/i.test(
        visibleText
      );
    const ticketFormatReached =
      /select ticket format/i.test(visibleText) &&
      /collection reference|oyster card|smartcard|other contactless|paper/i.test(
        visibleText
      );
    const smartcardNumberReached =
      /smartcard details|smart card details/i.test(visibleText) &&
      /smartcard number|smart card number/i.test(visibleText);
    const ticketFieldsReached =
      /smartcard number|ticket reference|valid from|expiry date|ticket price|standard class/i.test(
        visibleText
      );
    const compensationReached =
      /compensation details|payment method|paypal|rail travel voucher|bank transfer|bacs/i.test(
        visibleText
      );

    const allFormControls = Array.from(
      document.querySelectorAll(
        'input, select, textarea, [contenteditable="true"]'
      )
    ).map((element, index) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const isVisible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 0 &&
          rect.height > 0;

        return {
          index,
          tag: element.tagName.toLowerCase(),
          type:
            element.type ||
            (element.matches('[contenteditable="true"]')
              ? "contenteditable"
              : null),
          id: element.id || null,
          name: element.name || null,
          className: String(element.className || ""),
          placeholder: element.getAttribute("placeholder") || null,
          ariaLabel: element.getAttribute("aria-label") || null,
          value:
            element.value ||
            (element.matches('[contenteditable="true"]')
              ? String(element.textContent || "").trim() || null
              : null),
          checked:
            element.matches('input[type="radio"], input[type="checkbox"]')
              ? Boolean(element.checked)
              : null,
          visible: isVisible,
          optionTexts:
            element.tagName === "SELECT"
              ? Array.from(element.options || [])
                  .slice(0, 40)
                  .map((option) =>
                    String(option.textContent || option.value || "")
                      .replace(/\s+/g, " ")
                      .trim()
                  )
              : null,
        };
      });

    // Dynamically injected ticket controls occur after the earlier journey
    // controls. Keep every visible control plus relevant selected/identified
    // ticket controls, without logging unrelated hidden tokens.
    const formControls = allFormControls
      .filter((control) => {
        const descriptor = `${control.id || ""} ${control.name || ""} ${
          control.placeholder || ""
        } ${control.ariaLabel || ""}`;

        return (
          control.visible ||
          Boolean(control.checked) ||
          /ticket|smart|card|season|class|price|valid|expir|date.?from|utn/i.test(
            descriptor
          )
        );
      })
      .slice(0, 120);

    const visibleActions = Array.from(
      document.querySelectorAll(
        'button, a, label, [role="button"], [role="radio"]'
      )
    )
      .filter(visible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        className: String(element.className || ""),
        text: String(
          element.innerText ||
            element.textContent ||
            element.getAttribute("aria-label") ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim(),
      }))
      .filter((item) => item.text)
      .slice(0, 80);

    let state = "unknown_ticket_panel";

    if (compensationReached) {
      state = "compensation_details_reached";
    } else if (smartcardNumberReached) {
      state = "smartcard_number_reached";
    } else if (ticketFieldsReached) {
      state = "ticket_fields_reached";
    } else if (ticketFormatReached) {
      state = "ticket_format_reached";
    } else if (ticketTypeReached) {
      state = "ticket_type_reached";
    } else if (ticketCountReached) {
      state = "ticket_count_reached";
    } else if (barcodeChoiceStillVisible) {
      state = "barcode_choice_still_visible";
    }

    return {
      state,
      barcodeChoiceStillVisible,
      ticketCountReached,
      ticketTypeReached,
      ticketFormatReached,
      smartcardNumberReached,
      ticketFieldsReached,
      compensationReached,
      formControls,
      visibleActions,
      url: window.location.href,
      visibleTextPreview: visibleText.slice(0, 1800),
      bodyTextPreview: bodyText.slice(0, 1800),
    };
  });
}

async function inspectGreaterAngliaStateAfterTrainSelection(page) {
  return page.evaluate(() => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    const visibleText = Array.from(
      document.querySelectorAll(
        "main, form, h1, h2, h3, h4, h5, legend, p, label, section, article, .content, .container"
      )
    )
      .filter(visible)
      .map((element) => String(element.innerText || element.textContent || ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const bodyText = String(document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .trim();

    const ticketDetailsReached =
      /more than one ticket|how many tickets|ticket.*barcode|details of your ticket|ticket type|smartcard number/i.test(
        visibleText
      );
    const delayDetailsReached =
      /what happened to your journey|was your journey delayed|cancelled|how late|length of delay|delay.*minutes|15\+?\s*mins/i.test(
        visibleText
      );
    const trainSelectionStillVisible =
      /select your journey|earlier trains|later trains|still can't find your train/i.test(
        visibleText
      );

    let state = "unknown_next_panel";

    if (ticketDetailsReached) {
      state = "ticket_details_reached";
    } else if (delayDetailsReached) {
      state = "delay_details_reached";
    } else if (trainSelectionStillVisible) {
      state = "train_selection_still_visible";
    }

    return {
      state,
      ticketDetailsReached,
      delayDetailsReached,
      trainSelectionStillVisible,
      url: window.location.href,
      visibleTextPreview: visibleText.slice(0, 1600),
      bodyTextPreview: bodyText.slice(0, 1600),
    };
  });
}

async function fillJourneyStep(page, runContext, plan) {
  const journey = plan.journeyStep || {};

  // Greater Anglia Journey Details is a multi-panel flow.
  // The controls are present in the DOM even when their panels are hidden, so
  // generic label/select locators can accidentally target the wrong controls.
  // Work only with the real journey-date radios, hidden styled time selects and
  // the currently visible Continue button.

  await selectGreaterAngliaJourneyDate(
    page,
    runContext,
    journey.dateOfJourney
  );

  await setGreaterAngliaStyledSelect(
    page,
    runContext,
    "scheduled departure hour",
    journey.scheduledDepartureHour,
    "hour"
  );

  await setGreaterAngliaStyledSelect(
    page,
    runContext,
    "scheduled departure minute",
    journey.scheduledDepartureMinute,
    "minute"
  );

  await captureScreenshot(
    page,
    runContext,
    "03a_journey_date_time_filled"
  );

  await clickGreaterAngliaVisibleContinue(
    page,
    runContext,
    "journey date and time"
  );

  try {
    await waitForGreaterAngliaVisibleText(
      page,
      "Journey Start and End Stations|start and end stations",
      12000
    );
  } catch {
    await captureScreenshot(
      page,
      runContext,
      "03b_journey_time_did_not_advance"
    );
    throw new Error(
      "Greater Anglia journey date/time did not advance to the station step."
    );
  }

  await captureScreenshot(
    page,
    runContext,
    "03b_journey_station_step"
  );

  await fillGreaterAngliaJourneyStation(
    page,
    runContext,
    journey.fromStation,
    0,
    "from"
  );

  await fillGreaterAngliaJourneyStation(
    page,
    runContext,
    journey.toStation,
    1,
    "to"
  );

  await verifyGreaterAngliaJourneyStations(page, runContext, journey);

  await captureScreenshot(
    page,
    runContext,
    "03c_journey_stations_filled"
  );

  await clickGreaterAngliaVisibleContinue(
    page,
    runContext,
    "journey stations"
  );

  try {
    await waitForGreaterAngliaVisibleText(
      page,
      "Select your journey|Earlier trains|Later trains|Still can't find your train",
      12000
    );
  } catch {
    await captureScreenshot(
      page,
      runContext,
      "03d_journey_stations_did_not_advance"
    );
    throw new Error(
      "Greater Anglia journey stations did not advance to train selection."
    );
  }

  await captureScreenshot(
    page,
    runContext,
    "03d_journey_train_selection_reached"
  );

  // Select the result matching the saved route and closest departure
  // to the exact scheduled time. The current Greater Anglia results can expose
  // either one direct selection control or a two-click view/confirm pattern.
  await selectGreaterAngliaJourneyTrain(page, runContext, journey);
  await confirmExpandedGreaterAngliaJourneyIfRequired(
    page,
    runContext,
    journey
  );

  await page.waitForTimeout(1200).catch(() => {});

  const state = await inspectGreaterAngliaStateAfterTrainSelection(page);
  addLog(runContext, "Greater Anglia state after train selection.", state);
  addStep(runContext, "Inspect page after matching train selection", state);

  await captureScreenshot(
    page,
    runContext,
    "03f_after_matching_train_selection"
  );

  if (state.ticketDetailsReached) {
    return state;
  }

  if (state.delayDetailsReached) {
    // Map the detected delay to the operator's matching band,
    // select Delayed, leave the optional missed-connection/group boxes clear,
    // and stop only after the Ticket Details panel has been reached.
    await page.keyboard.press("Escape").catch(() => {});
    await selectGreaterAngliaJourneyDelayDetails(
      page,
      runContext,
      journey
    );

    await captureScreenshot(
      page,
      runContext,
      "03g_journey_delay_details_filled"
    );

    await clickGreaterAngliaVisibleContinue(
      page,
      runContext,
      "journey delay details"
    );

    await page.waitForTimeout(1200).catch(() => {});

    const nextState = await inspectGreaterAngliaStateAfterTrainSelection(page);
    addLog(
      runContext,
      "Greater Anglia state after journey delay details.",
      nextState
    );
    addStep(
      runContext,
      "Inspect page after journey delay details",
      nextState
    );

    await captureScreenshot(
      page,
      runContext,
      "03h_ticket_details_reached"
    );

    if (nextState.ticketDetailsReached) {
      return nextState;
    }

    if (nextState.delayDetailsReached) {
      throw new Error(
        "Greater Anglia journey delay details did not advance to Ticket Details. Review the 03g and 03h screenshots."
      );
    }

    throw new Error(
      "Greater Anglia journey delay details reached an unrecognised next panel. Review the 03h screenshot before continuing."
    );
  }

  if (state.trainSelectionStillVisible) {
    throw new Error(
      "Greater Anglia matching train was opened, but train selection did not advance. Review the 03e and 03f screenshots."
    );
  }

  throw new Error(
    "Greater Anglia matching train was selected and an unrecognised next panel was reached. Review the 03f screenshot before continuing."
  );
}

function formatPortalDate(value) {
  const iso = normaliseDateForInput(value);
  const match = cleanText(iso)?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

function panelHasText(snapshot, pattern) {
  return pattern.test(snapshot?.visibleTextPreview || "");
}

function isGreaterAngliaManualTicketFallback(snapshot) {
  const visibleText = snapshot?.visibleTextPreview || "";
  const hasExpectedMessage =
    /could not find your ticket.*travel date is not today/i.test(visibleText) &&
    /click continue to complete additional ticket details/i.test(visibleText);
  const hasVerifiedContinue = (snapshot?.actions || []).some(
    (action) =>
      action?.id === "tdnxtbutton2" &&
      /^(continue|next)$/i.test(action?.text || "")
  );

  return hasExpectedMessage && hasVerifiedContinue;
}

async function continueFromGreaterAngliaManualTicketFallback(
  page,
  runContext,
  snapshot
) {
  const beforeContinue = await getPortalFingerprint(page);
  const continueButton = page.locator("#tdnxtbutton2:visible").first();

  if ((await continueButton.count()) === 0) {
    throw createPortalBlocker(
      runContext,
      "Greater Anglia offered manual ticket entry, but its verified Continue control was not available.",
      {
        code: "manual_ticket_continue_not_found",
        diagnostic: snapshot,
      }
    );
  }

  await continueButton.scrollIntoViewIfNeeded().catch(() => {});
  await continueButton.click();
  addStep(runContext, "Continue to manual ticket details", {
    selector: "#tdnxtbutton2",
    reason: "Older journey ticket lookup did not return an automatic match",
  });

  const changed = await waitForPortalChange(page, beforeContinue);
  if (!changed) {
    const stalled = await inspectPortalPanel(page);
    throw createPortalBlocker(
      runContext,
      "Greater Anglia did not advance from the manual ticket-entry prompt.",
      {
        code: "manual_ticket_continue_did_not_advance",
        diagnostic: stalled,
      }
    );
  }
}

function portalDateIsToday(value) {
  const iso = normaliseDateForInput(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return false;

  const now = new Date();
  const localToday = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return iso === localToday;
}

function getManualTicketFormatAliases(ticket) {
  const format = cleanText(ticket.ticketFormat);
  const aliases = [format];
  if (/smart\s*card/i.test(format || "")) aliases.push("Smartcard", "Smart Card");
  if (/oyster/i.test(format || "")) aliases.push("Oyster Card", "Oyster");
  if (/paper/i.test(format || "")) aliases.push("Paper Ticket", "Paper");
  if (/contactless/i.test(format || "")) aliases.push("Contactless", "Other Contactless");
  return aliases.filter(Boolean);
}

function getTicketTimeAliases(ticket) {
  const mapped = cleanText(
    ticket.ticketTime || ticket.timeRestriction || ticket.ticketTimeRestriction
  );
  const aliases = [mapped];

  // Annual/Monthly/Weekly season tickets are not restricted to one booked
  // service. Only use this fallback when the portal actually offers the value.
  if (/annual|monthly|weekly|season/i.test(ticket.ticketType || "")) {
    aliases.push("Anytime", "Any Time", "No Restriction", "Not Applicable", "N/A");
  }

  return aliases.filter(Boolean);
}

function getTicketPurchasePaymentAliases(ticket) {
  const mapped = cleanText(
    ticket.purchasePaymentMethod ||
      ticket.ticketPaymentMethod ||
      ticket.methodOfPayment ||
      ticket.paymentMethod
  );
  const aliases = [mapped];
  if (/debit|credit|card/i.test(mapped || "")) {
    aliases.push("Debit Card", "Credit Card", "Debit or Credit Card", "Card");
  }
  if (/cash/i.test(mapped || "")) aliases.push("Cash");
  if (/paypal/i.test(mapped || "")) aliases.push("PayPal");
  return aliases.filter(Boolean);
}

async function chooseTicketStationSuggestion(
  page,
  runContext,
  label,
  station,
  fieldResult
) {
  if (!fieldResult?.ok || !cleanText(station)) return fieldResult;

  await page.waitForTimeout(450).catch(() => {});
  const suggestion = await page.evaluate(
    ({ stationValue, targetId, targetName }) => {
      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      }

      function normalise(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
      }

      const target = targetId
        ? document.getElementById(targetId)
        : Array.from(document.querySelectorAll("input")).find(
            (input) => input.getAttribute("name") === targetName && visible(input)
          );

      if (target) {
        target.focus();
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
      }

      const expected = normalise(stationValue).toLowerCase();
      const candidates = Array.from(
        document.querySelectorAll(
          '[role="option"], .ui-autocomplete li, .autocomplete-suggestion, .typeahead li, ul li, li a'
        )
      )
        .filter(visible)
        .map((element) => ({
          element,
          text: normalise(element.innerText || element.textContent),
          rect: element.getBoundingClientRect(),
        }))
        .filter((entry) => {
          const candidate = entry.text.toLowerCase();
          return (
            candidate === expected ||
            candidate.startsWith(`${expected} `) ||
            candidate.includes(expected)
          );
        })
        .sort((a, b) => {
          const aExact = a.text.toLowerCase() === expected ? 1 : 0;
          const bExact = b.text.toLowerCase() === expected ? 1 : 0;
          return bExact - aExact || a.rect.top - b.rect.top;
        });

      const chosen = candidates[0];
      if (!chosen) return { ok: false, reason: "station_suggestion_not_visible" };
      chosen.element.scrollIntoView({ block: "center", inline: "nearest" });
      chosen.element.click();
      return { ok: true, text: chosen.text.slice(0, 160) };
    },
    {
      stationValue: station,
      targetId: fieldResult.id || null,
      targetName: fieldResult.name || null,
    }
  );

  addStep(runContext, `Confirm ${label} station suggestion`, suggestion);
  return { ...fieldResult, suggestion };
}

function isGreaterAngliaManualSeasonTicketPanel(snapshot) {
  const ids = new Set(
    (snapshot?.fields || [])
      .map((field) => cleanText(field?.id))
      .filter(Boolean)
  );

  return [
    "Additionalvalidfrom",
    "Additionalvalidto",
    "Additionalstartstation",
    "Additionalendstation",
    "Additionalcostofticket",
  ].every((id) => ids.has(id));
}

async function fillGreaterAngliaManualTicketStation(
  page,
  runContext,
  { id, label, station }
) {
  const cleanStation = cleanText(station);
  if (!cleanStation) {
    throw createPortalBlocker(
      runContext,
      `Greater Anglia needs the ${label} station, but it is not mapped to this claim.`,
      {
        code: "missing_claim_data",
        missingData: [`${label} station`],
        diagnostic: await inspectPortalPanel(page),
      }
    );
  }

  const locator = page.locator(`#${id}`).first();
  if ((await locator.count()) === 0) {
    throw createPortalBlocker(
      runContext,
      `Greater Anglia's ${label} station control was not available.`,
      {
        code: "manual_ticket_station_control_missing",
        diagnostic: await inspectPortalPanel(page),
      }
    );
  }

  const existing = await locator.evaluate((element, expected) => {
    const normalise = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const actual = normalise(element.value);
    const wanted = normalise(expected);
    return {
      value: element.value || "",
      selected:
        element.getAttribute("data-delai-station-selected") === wanted &&
        (actual === wanted || actual.startsWith(`${wanted} `)),
    };
  }, cleanStation);

  if (existing.selected) {
    return {
      ok: true,
      id,
      station: cleanStation,
      value: existing.value,
      alreadySelected: true,
    };
  }

  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(cleanStation, { delay: 18 });
  await page.waitForTimeout(750).catch(() => {});

  let suggestion = await page.evaluate(
    ({ stationValue, targetId }) => {
      function visible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      }

      function normalise(value) {
        return String(value || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      const wanted = normalise(stationValue);
      const target = document.getElementById(targetId);
      const candidates = Array.from(
        document.querySelectorAll(
          '[role="option"], .ui-autocomplete li, .autocomplete-suggestion, .typeahead li, ul.ui-autocomplete li, ul li'
        )
      )
        .filter(visible)
        .map((element) => ({
          element,
          text: String(element.innerText || element.textContent || "")
            .replace(/\s+/g, " ")
            .trim(),
          rect: element.getBoundingClientRect(),
        }))
        .filter((entry) => {
          const candidate = normalise(entry.text);
          return candidate === wanted || candidate.startsWith(`${wanted} `);
        })
        .sort((a, b) => {
          const aExact = normalise(a.text) === wanted ? 1 : 0;
          const bExact = normalise(b.text) === wanted ? 1 : 0;
          return bExact - aExact || a.rect.top - b.rect.top;
        });

      const chosen = candidates[0];
      if (!chosen) {
        return { ok: false, reason: "station_suggestion_not_visible" };
      }

      chosen.element.scrollIntoView({ block: "nearest", inline: "nearest" });
      chosen.element.click();
      if (target) {
        target.setAttribute("data-delai-station-selected", wanted);
      }

      return { ok: true, text: chosen.text.slice(0, 160), method: "exact_option_click" };
    },
    { stationValue: cleanStation, targetId: id }
  );

  if (!suggestion?.ok) {
    await locator.press("ArrowDown").catch(() => {});
    await locator.press("Enter").catch(() => {});
    await page.waitForTimeout(300).catch(() => {});
    suggestion = { ok: true, method: "keyboard_first_suggestion" };
  }

  const verification = await locator.evaluate((element, expected) => {
    const normalise = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const actual = normalise(element.value);
    const wanted = normalise(expected);
    const matches = actual === wanted || actual.startsWith(`${wanted} `);
    if (matches) {
      element.setAttribute("data-delai-station-selected", wanted);
    }
    return { ok: matches, value: element.value || "" };
  }, cleanStation);

  const result = {
    ok: verification.ok,
    id,
    station: cleanStation,
    value: verification.value,
    suggestion,
    alreadySelected: false,
  };
  addStep(runContext, `Fill ${label} station exactly`, result);

  if (!result.ok) {
    throw createPortalBlocker(
      runContext,
      `Greater Anglia did not accept the mapped ${label} station.`,
      {
        code: "manual_ticket_station_autocomplete_failed",
        diagnostic: await inspectPortalPanel(page),
      }
    );
  }

  return result;
}

async function fillGreaterAngliaManualTicketDates(page, runContext, ticket) {
  const dateFromIso = normaliseDateForInput(ticket.dateFrom);
  const dateUntilIso = normaliseDateForInput(ticket.expiryDate);
  const dateFrom = formatPortalDate(dateFromIso);
  const dateUntil = formatPortalDate(dateUntilIso);

  if (!dateFromIso || !dateUntilIso) {
    throw createPortalBlocker(
      runContext,
      "Greater Anglia needs both season-ticket validity dates, but one or both are not mapped to this claim.",
      {
        code: "missing_claim_data",
        missingData: ["ticket valid from date", "ticket valid until date"],
        diagnostic: await inspectPortalPanel(page),
      }
    );
  }

  if (dateFromIso > dateUntilIso) {
    throw createPortalBlocker(
      runContext,
      "The mapped season-ticket validity dates are in the wrong order.",
      {
        code: "invalid_ticket_date_range",
        missingData: ["valid season-ticket date range"],
        diagnostic: await inspectPortalPanel(page),
      }
    );
  }

  const result = await page.evaluate(
    ({ fromId, untilId, fromDisplay, untilDisplay, fromIso, untilIso }) => {
      function setNativeValue(element, value) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set;
        if (setter) setter.call(element, value);
        else element.value = value;
      }

      function setDatePickerValue(element, displayValue, isoValue) {
        const match = String(isoValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        let datePickerSet = false;
        if (match && window.jQuery) {
          try {
            const instance = window.jQuery(element);
            if (typeof instance.datepicker === "function") {
              instance.datepicker(
                "setDate",
                new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
              );
              datePickerSet = true;
            }
          } catch (_error) {
            datePickerSet = false;
          }
        }
        setNativeValue(element, displayValue);
        return datePickerSet;
      }

      function canonical(value) {
        const clean = String(value || "").trim();
        const uk = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (uk) return `${uk[3]}-${uk[2]}-${uk[1]}`;
        const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : clean;
      }

      const from = document.getElementById(fromId);
      const until = document.getElementById(untilId);
      if (!from || !until) {
        return {
          ok: false,
          reason: "manual_ticket_date_control_missing",
          fromFound: Boolean(from),
          untilFound: Boolean(until),
        };
      }
      if (from.disabled || until.disabled) {
        return {
          ok: false,
          reason: "manual_ticket_date_control_disabled",
          fromDisabled: Boolean(from.disabled),
          untilDisabled: Boolean(until.disabled),
        };
      }

      const fromDatePickerSet = setDatePickerValue(from, fromDisplay, fromIso);
      const untilDatePickerSet = setDatePickerValue(until, untilDisplay, untilIso);

      // Validate the pair together. Blurring Date From while Date Until is still
      // empty makes the Tracsis validator emit a false invalid-range error.
      for (const element of [from, until]) {
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
      for (const element of [from, until]) {
        element.dispatchEvent(new Event("blur", { bubbles: true }));
        element.dispatchEvent(new Event("focusout", { bubbles: true }));
      }

      const actualFrom = from.value || "";
      const actualUntil = until.value || "";
      return {
        ok:
          canonical(actualFrom) === fromIso &&
          canonical(actualUntil) === untilIso,
        fromId,
        untilId,
        actualFrom,
        actualUntil,
        fromReadOnly: Boolean(from.readOnly),
        untilReadOnly: Boolean(until.readOnly),
        fromDatePickerSet,
        untilDatePickerSet,
      };
    },
    {
      fromId: "Additionalvalidfrom",
      untilId: "Additionalvalidto",
      fromDisplay: dateFrom,
      untilDisplay: dateUntil,
      fromIso: dateFromIso,
      untilIso: dateUntilIso,
    }
  );

  addStep(runContext, "Fill and verify season-ticket validity range", result || {});
  if (!result?.ok) {
    throw createPortalBlocker(
      runContext,
      "Greater Anglia's season-ticket validity range could not be populated correctly.",
      {
        code: "manual_ticket_date_range_failed",
        diagnostic: await inspectPortalPanel(page),
      }
    );
  }

  return result;
}

async function fillGreaterAngliaManualSeasonTicketPanel(
  page,
  runContext,
  ticket
) {
  const actions = [];

  actions.push(
    await fillGreaterAngliaManualTicketStation(page, runContext, {
      id: "Additionalstartstation",
      label: "ticket origin",
      station: ticket.originStation,
    })
  );
  actions.push(
    await fillGreaterAngliaManualTicketStation(page, runContext, {
      id: "Additionalendstation",
      label: "ticket destination",
      station: ticket.destinationStation,
    })
  );
  actions.push(await fillGreaterAngliaManualTicketDates(page, runContext, ticket));

  const price =
    ticket.ticketPrice === undefined || ticket.ticketPrice === null
      ? null
      : String(ticket.ticketPrice);
  const priceResult = await fillVisibleControlByPatterns(
    page,
    runContext,
    "manual ticket cost",
    price,
    ["Additionalcostofticket", "ticket cost", "\\bcost\\b"],
    []
  );
  if (priceResult?.ok) actions.push(priceResult);

  await page.keyboard.press("Escape").catch(() => {});
  return actions.filter((result) => result?.ok);
}

async function verifyGreaterAngliaManualSeasonTicketPanel(
  page,
  runContext,
  ticket
) {
  const expected = {
    dateFrom: normaliseDateForInput(ticket.dateFrom),
    dateUntil: normaliseDateForInput(ticket.expiryDate),
    origin: cleanText(ticket.originStation),
    destination: cleanText(ticket.destinationStation),
    cost:
      ticket.ticketPrice === undefined || ticket.ticketPrice === null
        ? null
        : String(ticket.ticketPrice),
  };

  const result = await page.evaluate((expectedValues) => {
    const normalise = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const canonicalDate = (value) => {
      const clean = String(value || "").trim();
      const uk = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (uk) return `${uk[3]}-${uk[2]}-${uk[1]}`;
      const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : clean;
    };
    const value = (id) => document.getElementById(id)?.value || "";
    const stationMatches = (actual, wanted) => {
      const actualNormalised = normalise(actual);
      const wantedNormalised = normalise(wanted);
      return (
        actualNormalised === wantedNormalised ||
        actualNormalised.startsWith(`${wantedNormalised} `)
      );
    };

    const values = {
      dateFrom: value("Additionalvalidfrom"),
      dateUntil: value("Additionalvalidto"),
      origin: value("Additionalstartstation"),
      destination: value("Additionalendstation"),
      cost: value("Additionalcostofticket"),
    };
    const checks = {
      dateFrom: canonicalDate(values.dateFrom) === expectedValues.dateFrom,
      dateUntil: canonicalDate(values.dateUntil) === expectedValues.dateUntil,
      origin: stationMatches(values.origin, expectedValues.origin),
      destination: stationMatches(values.destination, expectedValues.destination),
      cost: normalise(values.cost) === normalise(expectedValues.cost),
    };

    return {
      ok: Object.values(checks).every(Boolean),
      checks,
      values,
    };
  }, expected);

  addStep(runContext, "Verify complete manual season-ticket panel", result || {});
  if (!result?.ok) {
    const missingData = Object.entries(result?.checks || {})
      .filter(([, passed]) => !passed)
      .map(([name]) => `manual ticket ${name}`);
    throw createPortalBlocker(
      runContext,
      `Greater Anglia's manual season-ticket form is incomplete: ${missingData.join(", ")}.`,
      {
        code: "manual_ticket_fields_incomplete",
        missingData,
        diagnostic: await inspectPortalPanel(page),
      }
    );
  }

  return result;
}

async function selectManualTicketDropdowns(page, runContext, ticket, snapshot) {
  const actions = [];
  const fields = snapshot.fields || [];

  const formatSelect = fields.find(
    (field) =>
      field.tag === "select" &&
      (/\bformat\b/i.test(field.descriptor || "") ||
        (field.options || []).some((option) => /smartcard|oyster|paper|contactless/i.test(option)))
  );
  if (formatSelect) {
    const result = await selectActivePortalSelectByAliases(
      page,
      runContext,
      "manual ticket format",
      getManualTicketFormatAliases(ticket),
      ["ticket format", "\\bformat\\b"]
    );
    if (result?.ok) actions.push(result);
  }

  const timeSelect = fields.find(
    (field) =>
      field.tag === "select" &&
      (/ticket time|time restriction/i.test(field.descriptor || "") ||
        (field.options || []).some((option) => /anytime|off.?peak|peak/i.test(option)))
  );
  if (timeSelect) {
    const result = await selectActivePortalSelectByAliases(
      page,
      runContext,
      "ticket time",
      getTicketTimeAliases(ticket),
      ["ticket time", "time restriction"]
    );
    if (result?.ok) actions.push(result);
  }

  const paymentSelect = fields.find(
    (field) =>
      field.tag === "select" &&
      /how did you pay|method of payment|payment method/i.test(field.descriptor || "")
  );
  if (paymentSelect) {
    const paymentAliases = getTicketPurchasePaymentAliases(ticket);
    if (paymentAliases.length === 0) {
      throw createPortalBlocker(
        runContext,
        "Greater Anglia needs the ticket purchase payment method, but it is not mapped to this claim.",
        {
          code: "missing_claim_data",
          missingData: ["ticket purchase payment method"],
          diagnostic: snapshot,
        }
      );
    }
    const result = await selectActivePortalSelectByAliases(
      page,
      runContext,
      "ticket purchase payment method",
      paymentAliases,
      ["how did you pay", "method of payment", "payment method"]
    );
    if (result?.ok) actions.push(result);
  }

  return actions;
}

async function fillKnownTicketPanel(page, runContext, plan, snapshot) {
  const ticket = plan.ticketStep || {};
  const journey = plan.journeyStep || {};
  const actions = [];
  const visibleText = snapshot.visibleTextPreview || "";

  if (/smart\s*card number/i.test(visibleText)) {
    actions.push(await fillGreaterAngliaSmartcardNumber(page, runContext, ticket));
  }

  if (/did you use more than 1 ticket|more than one ticket/i.test(visibleText)) {
    const choice = ticket.moreThanOneTicket
      ? ["Yes", "More than one ticket"]
      : ["No", "One ticket", "Single ticket"];
    actions.push(
      await selectVisibleChoice(page, runContext, "ticket count", choice, [
        "more than one ticket",
        "how many tickets",
      ])
    );
  }

  if (/how many tickets/i.test(visibleText)) {
    const ticketCount = Number(ticket.ticketCount || ticket.numberOfTickets || 0);
    if (!ticket.moreThanOneTicket || ticketCount < 2 || ticketCount > 6) {
      throw createPortalBlocker(
        runContext,
        "Greater Anglia needs the number of tickets used for the journey.",
        {
          code: "missing_claim_data",
          missingData: ["number of tickets used"],
          diagnostic: snapshot,
        }
      );
    }
    actions.push(
      await selectActivePortalSelectByAliases(
        page,
        runContext,
        "number of tickets",
        [String(ticketCount)],
        ["how many tickets", "number of tickets"]
      )
    );
  }

  if (/did you purchase your ticket today/i.test(visibleText)) {
    const purchasedToday = portalDateIsToday(
      ticket.purchaseDate || ticket.purchasedAt || journey.dateOfJourney
    );
    actions.push(
      await selectVisibleChoice(
        page,
        runContext,
        "ticket purchased today",
        purchasedToday ? ["Yes"] : ["No"],
        ["purchase your ticket today"]
      )
    );
  }

  if (
    /your ticket with the details below was found and has not been used/i.test(visibleText) &&
    /is this your ticket/i.test(visibleText)
  ) {
    actions.push(
      await selectVisibleChoice(
        page,
        runContext,
        "matched ticket confirmation",
        ["Yes, continue", "Yes"],
        ["is this your ticket", "not been used"]
      )
    );
  }

  const ticketTypeSelect = (snapshot.fields || []).find(
    (field) =>
      field.tag === "select" &&
      (
        /(?:ticket\s*)?type/i.test(field.descriptor || "") ||
        (field.options || []).some((option) =>
          /annual|monthly|weekly|season ticket|day return|single ticket/i.test(
            option || ""
          )
        )
      )
  );
  const manualTicketTypePanel =
    (snapshot.actions || []).some(
      (action) => action?.id === "tdnxtbutton4"
    ) &&
    /more information from you|following details/i.test(
      snapshot.visibleTextPreview || ""
    );

  if (
    /ticket type|type of ticket|season ticket/i.test(visibleText) ||
    manualTicketTypePanel ||
    Boolean(ticketTypeSelect)
  ) {
    const ticketType = cleanText(ticket.ticketType);
    const ticketTypeAliases = [ticketType, `${ticketType || ""} Ticket`];
    if (/annual/i.test(ticketType || "")) {
      ticketTypeAliases.push(
        "Annual Season Ticket",
        "Annual Season",
        "Annual"
      );
    }
    if (/monthly/i.test(ticketType || "")) {
      ticketTypeAliases.push(
        "Monthly Season Ticket",
        "Monthly Season",
        "Monthly"
      );
    }
    if (/weekly/i.test(ticketType || "")) {
      ticketTypeAliases.push(
        "Weekly Season Ticket",
        "Weekly Season",
        "Weekly"
      );
    }
    if (/daily|day return|single/i.test(ticketType || "")) {
      ticketTypeAliases.push("Daily", "Day Return", "Single");
    }

    let selectedTicketType = await selectActivePortalSelectByAliases(
      page,
      runContext,
      "ticket type",
      ticketTypeAliases,
      ["ticket type", "type of ticket", "season ticket", "\\btype\\b"]
    );

    if (!selectedTicketType?.ok) {
      selectedTicketType = await selectVisibleChoice(
        page,
        runContext,
        "ticket type",
        ticketTypeAliases,
        ["ticket type", "type of ticket", "season ticket"]
      );
    }

    actions.push(selectedTicketType);
  }

  actions.push(...(await selectManualTicketDropdowns(page, runContext, ticket, snapshot)));

  const ticketClassSelect = (snapshot.fields || []).find(
    (field) =>
      field.tag === "select" &&
      (
        /ticket class|\bclass\b/i.test(field.descriptor || "") ||
        (field.options || []).some((option) =>
          /standard class|first class/i.test(option || "")
        )
      )
  );

  if (
    /ticket class|standard class|first class/i.test(visibleText) ||
    Boolean(ticketClassSelect)
  ) {
    const ticketClassAliases = [
      ticket.ticketClass,
      String(ticket.ticketClass || "").replace(/ class$/i, ""),
    ];
    let selectedTicketClass = await selectActivePortalSelectByAliases(
      page,
      runContext,
      "ticket class",
      ticketClassAliases,
      ["ticket class", "\\bclass\\b"]
    );

    if (!selectedTicketClass?.ok) {
      selectedTicketClass = await selectVisibleChoice(
        page,
        runContext,
        "ticket class",
        ticketClassAliases,
        ["ticket class", "standard class", "first class"]
      );
    }

    actions.push(selectedTicketClass);
  }

  if (isGreaterAngliaManualSeasonTicketPanel(snapshot)) {
    actions.push(
      ...(await fillGreaterAngliaManualSeasonTicketPanel(
        page,
        runContext,
        ticket
      ))
    );
    return actions.filter((result) => result?.ok);
  }

  if (/how did you pay for your ticket/i.test(visibleText)) {
    const paymentAliases = getTicketPurchasePaymentAliases(ticket);
    if (paymentAliases.length === 0) {
      throw createPortalBlocker(
        runContext,
        "Greater Anglia needs the ticket purchase payment method, but it is not mapped to this claim.",
        {
          code: "missing_claim_data",
          missingData: ["ticket purchase payment method"],
          diagnostic: snapshot,
        }
      );
    }
    const selectedPayment = await selectVisibleChoice(
      page,
      runContext,
      "ticket purchase payment method",
      paymentAliases,
      ["how did you pay", "method of payment"]
    );
    if (selectedPayment?.ok) actions.push(selectedPayment);
  }

  const fieldMappings = [
    {
      label: "unique ticket reference",
      value: ticket.uniqueTicketReference,
      positive: ["unique.*ticket.*reference", "ticket.*reference", "\\butn\\b"],
      negative: ["smart"],
    },
    {
      label: "ticket origin",
      value: ticket.originStation,
      positive: ["origin", "from station", "boarding station", "\\bfrom\\b"],
      negative: ["journey"],
      station: true,
    },
    {
      label: "ticket destination",
      value: ticket.destinationStation,
      positive: ["destination", "to station", "\\bto\\b"],
      negative: ["journey"],
      station: true,
    },
    {
      label: "ticket valid from date",
      value: formatPortalDate(ticket.dateFrom),
      positive: ["valid from", "date from", "start date"],
      negative: ["journey"],
      allowReadOnly: true,
    },
    {
      label: "photocard ID",
      value: ticket.photocardId || ticket.photoCardId,
      positive: ["photocard", "photo card"],
      negative: [],
    },
    {
      label: "ticket card number",
      value: ticket.cardNumber,
      positive: ["card number"],
      negative: ["smart", "swift", "bank", "account"],
    },
    {
      label: "Swift card number",
      value: ticket.swiftCardNumber,
      positive: ["swift card"],
      negative: ["bank", "code"],
    },
    {
      label: "ticket number",
      value: ticket.ticketNumber,
      positive: ["ticket number", "\\bnumber\\b"],
      negative: ["smart", "swift", "card", "account", "reference"],
    },
    {
      label: "ticket reference",
      value: ticket.ticketReference,
      positive: ["ticket reference", "\\breference\\b"],
      negative: ["unique", "collection"],
    },
    {
      label: "ticket expiry date",
      value: formatPortalDate(ticket.expiryDate),
      positive: ["expiry", "expires", "valid to", "date until", "end date"],
      negative: ["journey"],
      allowReadOnly: true,
    },
    {
      label: "ticket price",
      value:
        ticket.ticketPrice === undefined || ticket.ticketPrice === null
          ? null
          : String(ticket.ticketPrice),
      positive: [
        "ticket price",
        "price paid",
        "amount paid",
        "ticket cost",
        "cost of ticket",
      ],
      negative: [],
    },
  ];

  for (const mapping of fieldMappings) {
    const result = await fillVisibleControlByPatterns(
      page,
      runContext,
      mapping.label,
      mapping.value,
      mapping.positive,
      mapping.negative,
      { allowReadOnly: mapping.allowReadOnly === true }
    );
    if (result?.ok) actions.push(result);
    if (result?.ok && mapping.station) {
      actions.push(
        await chooseTicketStationSuggestion(
          page,
          runContext,
          mapping.label,
          mapping.value,
          result
        )
      );
    }
  }

  await page.keyboard.press("Escape").catch(() => {});

  return actions.filter((result) => result?.ok);
}

async function fillTicketStep(page, runContext, plan) {
  const ticket = plan.ticketStep || {};
  setCheckpoint(runContext, "ticket_details");

  await page.keyboard.press("Escape").catch(() => {});
  let previousPanelFingerprint = null;
  let repeatedPanelCount = 0;

  for (
    let panelIndex = 0;
    panelIndex < GREATER_ANGLIA_TICKET_PANEL_LIMIT;
    panelIndex += 1
  ) {
    let snapshot = await inspectPortalPanel(page);
    runContext.diagnostic = snapshot;

    if (["compensation", "confirmation", "submitted"].includes(snapshot.stage)) {
      setCheckpoint(runContext, "ticket_details_complete", {
        nextStage: snapshot.stage,
        panelsProcessed: panelIndex,
      });
      return snapshot;
    }

    const visibleText = snapshot.visibleTextPreview || "";
    if (
      /ticket with the details below was found and has been used for a claim previously/i.test(
        visibleText
      )
    ) {
      throw createPortalBlocker(
        runContext,
        "Greater Anglia reports that this ticket has already been used for a claim.",
        {
          code: "ticket_already_used_for_claim",
          diagnostic: snapshot,
        }
      );
    }

    if (isGreaterAngliaManualTicketFallback(snapshot)) {
      await continueFromGreaterAngliaManualTicketFallback(
        page,
        runContext,
        snapshot
      );
      continue;
    }

    if (snapshot.stage !== "ticket") {
      throw createPortalBlocker(
        runContext,
        `Greater Anglia reached an unrecognised panel after Ticket Details: ${snapshot.heading || "no heading"}.`,
        { code: "unknown_ticket_panel", diagnostic: snapshot }
      );
    }

    const panelFingerprint = await getPortalFingerprint(page);
    if (panelFingerprint === previousPanelFingerprint) repeatedPanelCount += 1;
    else repeatedPanelCount = 0;
    previousPanelFingerprint = panelFingerprint;

    if (repeatedPanelCount >= 3) {
      throw createPortalBlocker(
        runContext,
        "Greater Anglia remained on the same Ticket Details panel after repeated attempts.",
        { code: "ticket_panel_cycle_detected", diagnostic: snapshot }
      );
    }

    if (panelHasText(snapshot, /does your ticket have a barcode/i)) {
      const beforeBarcode = await getPortalFingerprint(page);
      await selectGreaterAngliaTicketBarcodePath(page, runContext, ticket);
      const changed = await waitForPortalChange(page, beforeBarcode, 3500);
      if (changed) continue;
      snapshot = await inspectPortalPanel(page);
    }

    if (panelHasText(snapshot, /select ticket format/i)) {
      await selectGreaterAngliaTicketFormat(page, runContext, ticket);
    }

    const autoAdvanceChoicePanel =
      /did you purchase your ticket today/i.test(visibleText) ||
      (/is this your ticket/i.test(visibleText) &&
        /not been used for a claim/i.test(visibleText));

    let actionCount = 0;
    for (let revealPass = 0; revealPass < 6; revealPass += 1) {
      const beforeFill = await getPortalFingerprint(page);
      const currentSnapshot = await inspectPortalPanel(page);
      if (["compensation", "confirmation", "submitted"].includes(currentSnapshot.stage)) {
        setCheckpoint(runContext, "ticket_details_complete", {
          nextStage: currentSnapshot.stage,
          panelsProcessed: panelIndex + 1,
        });
        return currentSnapshot;
      }

      const actions = await fillKnownTicketPanel(
        page,
        runContext,
        plan,
        currentSnapshot
      );
      actionCount += actions.length;
      await page.waitForTimeout(180).catch(() => {});
      const afterFillFingerprint = await getPortalFingerprint(page);
      if (actions.length === 0 || afterFillFingerprint === beforeFill) break;
    }

    if (autoAdvanceChoicePanel && actionCount > 0) {
      const changed = await waitForPortalChange(page, panelFingerprint, 3500);
      if (changed) continue;
    }

    let afterFill = await inspectPortalPanel(page);
    runContext.diagnostic = afterFill;
    if (["compensation", "confirmation", "submitted"].includes(afterFill.stage)) {
      setCheckpoint(runContext, "ticket_details_complete", {
        nextStage: afterFill.stage,
        panelsProcessed: panelIndex + 1,
      });
      return afterFill;
    }

    if (isGreaterAngliaManualSeasonTicketPanel(afterFill)) {
      await verifyGreaterAngliaManualSeasonTicketPanel(
        page,
        runContext,
        ticket
      );
      afterFill = await inspectPortalPanel(page);
      runContext.diagnostic = afterFill;
    }

    const evidencePath = cleanText(
      ticket.evidencePath || ticket.ticketImagePath || ticket.attachmentPath
    );
    const visibleFileFields = afterFill.fields.filter((field) => field.type === "file");
    if (visibleFileFields.length > 0 && evidencePath) {
      const visibleUploads = page.locator('input[type="file"]:visible');
      const uploadCount = await visibleUploads.count();
      for (let uploadIndex = 0; uploadIndex < uploadCount; uploadIndex += 1) {
        await visibleUploads.nth(uploadIndex).setInputFiles(evidencePath);
      }
      addStep(runContext, "Upload ticket evidence", {
        fileName: path.basename(evidencePath),
        uploadControlCount: uploadCount,
      });
      afterFill = await inspectPortalPanel(page);
    } else if (visibleFileFields.some((field) => field.required)) {
      throw createPortalBlocker(
        runContext,
        "Greater Anglia requires ticket evidence, but no ticket image or evidence file is mapped to this claim.",
        {
          code: "missing_claim_data",
          missingData: ["ticket evidence file"],
          diagnostic: afterFill,
        }
      );
    }

    const missingRequired = afterFill.fields
      .filter((field) => field.required && !field.valuePresent)
      .filter((field) => !["radio", "checkbox"].includes(field.type))
      .filter((field) => field.type !== "file")
      .map((field) => field.label || field.name || field.id || "required ticket field")
      .filter((value, index, values) => values.indexOf(value) === index);

    if (missingRequired.length > 0) {
      throw createPortalBlocker(
        runContext,
        `Greater Anglia needs additional ticket information: ${missingRequired.join(", ")}.`,
        {
          code: "missing_claim_data",
          missingData: missingRequired,
          diagnostic: afterFill,
        }
      );
    }

    const hasContinue = afterFill.actions.some((action) =>
      /^(continue|next)$/i.test(action.text)
    );
    if (!hasContinue) {
      await page.waitForTimeout(500).catch(() => {});
      const autoAdvanced = await inspectPortalPanel(page);
      if (["compensation", "confirmation", "submitted"].includes(autoAdvanced.stage)) {
        setCheckpoint(runContext, "ticket_details_complete", {
          nextStage: autoAdvanced.stage,
          panelsProcessed: panelIndex + 1,
        });
        return autoAdvanced;
      }

      const currentFingerprint = await getPortalFingerprint(page);
      if (currentFingerprint !== panelFingerprint) continue;

      throw createPortalBlocker(runContext,
        "Greater Anglia Ticket Details has no safe Continue action on the current panel.",
        { code: "ticket_panel_blocked", diagnostic: autoAdvanced });
    }

    const beforeContinue = await getPortalFingerprint(page);
    await clickGreaterAngliaVisibleContinue(
      page,
      runContext,
      `ticket panel ${panelIndex + 1}`
    );
    const changed = await waitForPortalChange(page, beforeContinue, 8000);

    if (!changed) {
      const stalled = await inspectPortalPanel(page);
      const smartcardLengthError = stalled.validationErrors.some((message) =>
        /smart\s*card|18\s*characters/i.test(message)
      );

      throw createPortalBlocker(
        runContext,
        stalled.validationErrors.length > 0
          ? `Greater Anglia did not accept the Ticket Details panel: ${stalled.validationErrors.join("; ")}.`
          : "Greater Anglia did not advance after the Ticket Details Continue action.",
        {
          code: smartcardLengthError
            ? "invalid_smartcard_number"
            : "ticket_panel_did_not_advance",
          missingData: smartcardLengthError
            ? ["valid 18-character smartcard number"]
            : [],
          diagnostic: stalled,
        }
      );
    }
  }

  const diagnostic = await inspectPortalPanel(page);
  throw createPortalBlocker(
    runContext,
    "Greater Anglia exceeded the safe Ticket Details panel limit.",
    { code: "ticket_panel_limit", diagnostic }
  );
}

async function fillPassengerStep(page, runContext, plan) {
  const passenger = plan.passengerStep || {};
  const fullName = cleanText(passenger.fullName);
  const email = cleanText(passenger.email);
  const postcode = cleanText(passenger.postcode);
  const title = getPassengerTitle(passenger);

  addLog(runContext, "Filling Greater Anglia personal details first.", {
    hasTitle: Boolean(title),
    hasFullName: Boolean(fullName),
    hasEmail: Boolean(email),
    hasPostcode: Boolean(postcode),
  });

  await dismissCookieConsent(page, runContext);
  await scanGreaterAngliaPersonalFields(page, runContext);

  const titleSelected = await selectTitleForGreaterAnglia(page, runContext, title);

  // Greater Anglia's Tracsis form uses floating labels. Direct label lookups are unreliable,
  // so we first match direct input attributes, then fall back to the visible field order:
  // 0 = Full Name, 1 = Email, 2 = Confirm email, 3 = Post Code.
  await fillGreaterAngliaPersonalInput(
    page,
    runContext,
    "full name",
    fullName,
    0,
    ["full\\s*name", "first\\s*and\\s*surname", "surname", "\\bname\\b"],
    ["email", "confirm", "post\\s*code", "postcode"]
  );

  await fillGreaterAngliaPersonalInput(
    page,
    runContext,
    "email",
    email,
    1,
    ["^email$", "\\bemail\\b", "e-mail"],
    ["confirm"]
  );

  await fillGreaterAngliaPersonalInput(
    page,
    runContext,
    "confirm email",
    email,
    2,
    ["confirm\\s*email", "confirm\\s*e-mail", "verify\\s*email"],
    []
  );

  await fillGreaterAngliaPersonalInput(
    page,
    runContext,
    "postcode",
    postcode,
    3,
    ["post\\s*code", "postcode", "postal\\s*code"],
    ["email", "name"]
  );

  await page.waitForTimeout(800).catch(() => {});
  await selectGreaterAngliaAddress(page, runContext, passenger);
  await captureScreenshot(page, runContext, "02b_after_address_dropdown_handled");

  if (getBooleanEnv("GREATER_ANGLIA_SEASON_DIRECT_MEMBER", false)) {
    await clickByText(
      page,
      runContext,
      "season direct member checkbox",
      /i am a season direct member/i,
      ['label:has-text("I am a Season Direct member")', 'input[type="checkbox"]']
    );
  }

  if (getBooleanEnv("GREATER_ANGLIA_REMEMBER_DETAILS", false)) {
    await clickByText(
      page,
      runContext,
      "remember my details checkbox",
      /remember my details/i,
      ['label:has-text("Remember my details")']
    );
  }

  const titleVerified =
    titleSelected && (await verifyTitleForGreaterAnglia(page, runContext, title));

  if (!titleVerified) {
    await captureScreenshot(page, runContext, "02c_title_not_selected");
    throw new Error("Greater Anglia title was not selected.");
  }

  await captureScreenshot(page, runContext, "02_personal_details_filled_before_continue");
  await dismissCookieConsent(page, runContext);
  await continueIfAvailable(page, runContext, "personal details");
  await page.waitForTimeout(1200).catch(() => {});
  await dismissCookieConsent(page, runContext);
  await throwIfStillOnPersonalDetailsWithErrors(page, runContext);
}

async function fillCompensationStep(
  page,
  runContext,
  plan,
  mappedSubmission = null
) {
  const compensation = plan.compensationStep || {};
  const passenger = plan.passengerStep || {};
  const paymentProfile =
    compensation.bankDetails ||
    compensation.paymentDetails ||
    mappedSubmission?.paymentDetails ||
    mappedSubmission?.passenger?.paymentDetails ||
    mappedSubmission?.passenger?.bankDetails ||
    {};
  const firstMapped = (...values) =>
    values.map((value) => cleanText(value)).find(Boolean) || null;
  const preferredMethod = firstMapped(
    compensation.preferredPaymentMethod,
    mappedSubmission?.passenger?.preferredPaymentMethod
  );
  setCheckpoint(runContext, "compensation_details");

  if (!preferredMethod) {
    const diagnostic = await inspectPortalPanel(page);
    throw createPortalBlocker(
      runContext,
      "Greater Anglia needs a preferred compensation payment method, but none is mapped to this claim.",
      {
        code: "missing_claim_data",
        missingData: ["preferred payment method"],
        diagnostic,
      }
    );
  }

  const methodAliases = /bacs|bank/i.test(preferredMethod)
    ? [preferredMethod, "BACS", "Bank Transfer", "Bank transfer"]
    : /paypal/i.test(preferredMethod)
      ? [preferredMethod, "PayPal"]
      : /voucher/i.test(preferredMethod)
        ? [preferredMethod, "Rail Travel Vouchers", "Rail Travel Voucher"]
        : [preferredMethod];

  let paymentMethodSelected = false;

  for (
    let panelIndex = 0;
    panelIndex < GREATER_ANGLIA_COMPENSATION_PANEL_LIMIT;
    panelIndex += 1
  ) {
    let snapshot = await inspectPortalPanel(page);
    runContext.diagnostic = snapshot;

    if (["confirmation", "submitted"].includes(snapshot.stage)) {
      setCheckpoint(runContext, "compensation_details_complete", {
        nextStage: snapshot.stage,
        panelsProcessed: panelIndex,
      });
      return snapshot;
    }

    if (snapshot.stage !== "compensation") {
      throw createPortalBlocker(
        runContext,
        `Greater Anglia reached an unrecognised panel after Compensation Details: ${snapshot.heading || "no heading"}.`,
        { code: "unknown_compensation_panel", diagnostic: snapshot }
      );
    }

    const bankFieldsAlreadyVisible = (snapshot.fields || []).some((field) =>
      /sort ?code|account number|\biban\b|swift|\bbic\b/i.test(
        field.descriptor || ""
      )
    );
    const paypalFieldsAlreadyVisible = (snapshot.fields || []).some((field) =>
      /paypal.*email|email.*paypal/i.test(field.descriptor || "")
    );

    if (
      (!paymentMethodSelected && /bacs|bank/i.test(preferredMethod) && bankFieldsAlreadyVisible) ||
      (!paymentMethodSelected && /paypal/i.test(preferredMethod) && paypalFieldsAlreadyVisible)
    ) {
      paymentMethodSelected = true;
      addStep(runContext, "Recognise selected compensation method from payment fields", {
        preferredMethod,
        bankFieldsAlreadyVisible,
        paypalFieldsAlreadyVisible,
      });
    }

    if (!paymentMethodSelected) {
      const beforeSelection = await getPortalFingerprint(page);
      const selected = await selectVisibleChoice(
        page,
        runContext,
        "preferred payment method",
        methodAliases,
        ["payment", "compensation", "how would you like"]
      );

      if (!selected?.ok) {
        throw createPortalBlocker(
          runContext,
          `Greater Anglia could not select the mapped payment method: ${preferredMethod}.`,
          { code: "payment_method_not_found", diagnostic: snapshot }
        );
      }

      paymentMethodSelected = true;
      await waitForPortalChange(page, beforeSelection, 2500);
      snapshot = await inspectPortalPanel(page);

      if (["confirmation", "submitted"].includes(snapshot.stage)) {
        setCheckpoint(runContext, "compensation_details_complete", {
          nextStage: snapshot.stage,
          panelsProcessed: panelIndex + 1,
        });
        return snapshot;
      }
    }

    const bankAccountName = firstMapped(
      compensation.bankAccountName,
      compensation.accountHolderName,
      compensation.accountName,
      paymentProfile.bankAccountName,
      paymentProfile.accountHolderName,
      paymentProfile.accountName
    );
    const sortCode = firstMapped(
      compensation.sortCode,
      paymentProfile.sortCode,
      paymentProfile.bankSortCode
    )?.replace(/[^0-9]/g, "");
    const accountNumber = firstMapped(
      compensation.accountNumber,
      paymentProfile.accountNumber,
      paymentProfile.bankAccountNumber
    )?.replace(/\s+/g, "");
    const rollNumber = firstMapped(
      compensation.buildingSocietyRollNumber,
      compensation.rollNumber,
      paymentProfile.buildingSocietyRollNumber,
      paymentProfile.rollNumber
    );
    const iban = firstMapped(
      compensation.iban,
      compensation.IBAN,
      paymentProfile.iban,
      paymentProfile.IBAN
    )?.replace(/\s+/g, "").toUpperCase();
    const swiftCode = firstMapped(
      compensation.swiftCode,
      compensation.bic,
      paymentProfile.swiftCode,
      paymentProfile.bic,
      paymentProfile.BIC
    )?.replace(/\s+/g, "").toUpperCase();
    const paypalEmail = firstMapped(
      compensation.paypalEmail,
      paymentProfile.paypalEmail,
      passenger.email
    );

    const compensationMappings = [
      {
        label: "bank account holder name",
        value: bankAccountName,
        positive: ["account holder", "account name", "name on.*account"],
        negative: [],
      },
      {
        label: "sort code",
        value: sortCode,
        positive: ["sort code", "sortcode"],
        negative: [],
      },
      {
        label: "bank account number",
        value: accountNumber,
        positive: ["account number", "accountnumber"],
        negative: ["confirm", "repeat", "re-enter"],
      },
      {
        label: "confirm bank account number",
        value: accountNumber,
        positive: ["confirm.*account", "repeat.*account", "re-enter.*account"],
        negative: [],
      },
      {
        label: "building society roll number",
        value: rollNumber,
        positive: ["roll number", "building society"],
        negative: [],
      },
      {
        label: "IBAN",
        value: iban,
        positive: ["\\biban\\b"],
        negative: ["valid"],
      },
      {
        label: "SWIFT/BIC code",
        value: swiftCode,
        positive: ["swift", "\\bbic\\b"],
        negative: ["valid"],
      },
      {
        label: "PayPal email",
        value: paypalEmail,
        positive: ["paypal.*email", "email.*paypal"],
        negative: ["confirm"],
      },
      {
        label: "confirm PayPal email",
        value: paypalEmail,
        positive: ["confirm.*paypal", "confirm.*email"],
        negative: [],
      },
    ];

    for (const mapping of compensationMappings) {
      await fillVisibleControlByPatterns(
        page,
        runContext,
        mapping.label,
        mapping.value,
        mapping.positive,
        mapping.negative
      );
    }

    // BACS and IBAN are validated by the portal on focusout through AJAX.
    // Let that validation and any CSRF-token refresh finish before inspecting
    // or pressing Continue.
    const paymentValidationFieldsVisible = (snapshot.fields || []).some((field) =>
      /sort ?code|account number|\biban\b|swift|\bbic\b|paypal.*email/i.test(
        field.descriptor || ""
      )
    );
    if (paymentValidationFieldsVisible) {
      await page
        .waitForLoadState("networkidle", { timeout: 5000 })
        .catch(() => {});
    }

    snapshot = await inspectPortalPanel(page);
    const visibleBankFields = snapshot.fields.filter((field) =>
      /account holder|account name|account number|sort ?code|roll number|\biban\b|swift|\bbic\b|paypal.*email/i.test(
        field.descriptor || ""
      )
    );
    const missingPaymentData = visibleBankFields
      .filter((field) => !field.valuePresent)
      .filter(
        (field) =>
          field.required ||
          /account holder|account name|account number|sort ?code|\biban\b|paypal.*email/i.test(
            field.descriptor || ""
          )
      )
      .map((field) => field.label || field.name || field.id || "payment field");

    if (missingPaymentData.length > 0) {
      throw createPortalBlocker(
        runContext,
        `Greater Anglia needs additional payment information: ${missingPaymentData.join(", ")}.`,
        {
          code: "missing_claim_data",
          missingData: missingPaymentData,
          diagnostic: snapshot,
        }
      );
    }

    const hasContinue = snapshot.actions.some((action) => /^(continue|next)$/i.test(action.text));
    if (!hasContinue) {
      await page.waitForTimeout(350).catch(() => {});
      const autoAdvanced = await inspectPortalPanel(page);
      if (["confirmation", "submitted"].includes(autoAdvanced.stage)) {
        setCheckpoint(runContext, "compensation_details_complete", {
          nextStage: autoAdvanced.stage,
          panelsProcessed: panelIndex + 1,
        });
        return autoAdvanced;
      }

      throw createPortalBlocker(
        runContext,
        "Greater Anglia Compensation Details has no safe Continue action on the current panel.",
        { code: "compensation_panel_blocked", diagnostic: autoAdvanced }
      );
    }

    const beforeContinue = await getPortalFingerprint(page);
    await clickGreaterAngliaVisibleContinue(
      page,
      runContext,
      `compensation panel ${panelIndex + 1}`
    );
    const changed = await waitForPortalChange(page, beforeContinue);

    if (!changed) {
      const stalled = await inspectPortalPanel(page);
      throw createPortalBlocker(
        runContext,
        stalled.validationErrors.length > 0
          ? `Greater Anglia did not accept the Compensation Details panel: ${stalled.validationErrors.join("; ")}.`
          : "Greater Anglia did not advance after the Compensation Details Continue action.",
        { code: "compensation_panel_did_not_advance", diagnostic: stalled }
      );
    }
  }

  const diagnostic = await inspectPortalPanel(page);
  throw createPortalBlocker(
    runContext,
    "Greater Anglia exceeded the safe Compensation Details panel limit.",
    { code: "compensation_panel_limit", diagnostic }
  );
}

function hasPassengerTravelConfirmation(plan, mappedSubmission) {
  const confirmation = plan.confirmationStep || {};
  if (
    confirmation.passengerConfirmedTravel === true ||
    confirmation.customerConfirmedTravel === true ||
    confirmation.confirmedTravel === true
  ) {
    return true;
  }

  return /passenger confirmed (?:that )?they travelled|confirmed travel/i.test(
    mappedSubmission?.claim?.preparedSummary || ""
  );
}

function getFinalSubmissionGateFailures() {
  const failures = [];
  if (!getBooleanEnv("ENABLE_GREATER_ANGLIA_LIVE_SUBMISSION", false)) {
    failures.push("ENABLE_GREATER_ANGLIA_LIVE_SUBMISSION=true");
  }
  if ((cleanText(process.env.GREATER_ANGLIA_SUBMISSION_METHOD) || "").toLowerCase() !== "playwright") {
    failures.push("GREATER_ANGLIA_SUBMISSION_METHOD=playwright");
  }
  if (!getBooleanEnv("GREATER_ANGLIA_PLAYWRIGHT_EXECUTOR_ENABLED", false)) {
    failures.push("GREATER_ANGLIA_PLAYWRIGHT_EXECUTOR_ENABLED=true");
  }
  if (!getBooleanEnv("GREATER_ANGLIA_FINAL_SUBMIT_ENABLED", false)) {
    failures.push("GREATER_ANGLIA_FINAL_SUBMIT_ENABLED=true");
  }
  return failures;
}

async function inspectFinalSubmitBoundary(page) {
  return page.evaluate(() => {
    function rendered(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function textFor(element) {
      return String(
        element.innerText ||
          element.textContent ||
          element.value ||
          element.getAttribute("aria-label") ||
          ""
      )
        .replace(/\s+/g, " ")
        .trim();
    }

    const candidates = Array.from(
      document.querySelectorAll(
        'button, input[type="submit"], input[type="button"], a, [role="button"]'
      )
    )
      .filter(rendered)
      .map((element) => ({
        text: textFor(element),
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        type: element.getAttribute("type") || null,
        disabled: Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true",
      }))
      .filter((entry) =>
        /^(submit|submit claim|submit my claim|confirm and submit|complete claim)$/i.test(
          entry.text
        )
      );

    const visibleBodyText = String(document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .trim();

    return {
      reached: candidates.length > 0,
      readyForClick: candidates.filter((candidate) => !candidate.disabled).length === 1,
      candidateCount: candidates.length,
      enabledCandidateCount: candidates.filter((candidate) => !candidate.disabled).length,
      candidates,
      finalReviewVisible: /confirm your claim|review (?:your|the) claim/i.test(
        visibleBodyText
      ),
      recaptchaVisible: Boolean(
        Array.from(
          document.querySelectorAll(
            '.g-recaptcha, iframe[src*="recaptcha"], [title*="Recaptcha" i], [title*="reCAPTCHA" i]'
          )
        ).find(rendered)
      ),
      fraudWarningVisible: /fraud act|fraudulent|false or misleading|prosecution/i.test(
        visibleBodyText
      ),
      termsVisible: /terms (?:&|and) conditions/i.test(visibleBodyText),
    };
  });
}

async function prepareConfirmationStep(
  page,
  runContext,
  plan,
  mappedSubmission,
  finalSubmitEnabled
) {
  const confirmation = plan.confirmationStep || {};
  const snapshot = await inspectPortalPanel(page);
  runContext.diagnostic = snapshot;

  if (snapshot.stage === "submitted") {
    setCheckpoint(runContext, "submitted");
    return snapshot;
  }

  if (snapshot.stage !== "confirmation") {
    throw createPortalBlocker(
      runContext,
      `Greater Anglia did not reach the final confirmation screen; it stopped at ${snapshot.heading || snapshot.stage}.`,
      { code: "confirmation_not_reached", diagnostic: snapshot }
    );
  }

  setCheckpoint(runContext, "final_review", {
    finalSubmitEnabled: finalSubmitEnabled === true,
  });

  const finalBoundary = await inspectFinalSubmitBoundary(page);
  addStep(runContext, "Verify protected final-submit boundary", finalBoundary);
  runContext.diagnostic = { ...snapshot, finalSubmitBoundary: finalBoundary };

  if (
    confirmation.fraudWarningMustBeShownBeforeSubmit === true &&
    !finalBoundary.fraudWarningVisible
  ) {
    throw createPortalBlocker(
      runContext,
      "Greater Anglia final review was reached, but the required fraud warning was not visible.",
      { code: "fraud_warning_missing", diagnostic: runContext.diagnostic }
    );
  }

  if (!finalSubmitEnabled) {
    // The current Greater Anglia page can keep Submit disabled or inject it only
    // after reCAPTCHA. A dry run has reached its protected endpoint once the
    // real Confirm your claim page and fraud warning are visible; it must not
    // attempt or require the anti-bot challenge while final submission is off.
    return runContext.diagnostic;
  }

  if (!finalBoundary.reached) {
    throw createPortalBlocker(
      runContext,
      "Greater Anglia reached Confirm, but the protected final Submit control was not found.",
      {
        code: "final_submit_boundary_not_found",
        diagnostic: runContext.diagnostic,
      }
    );
  }

  if (!finalBoundary.readyForClick) {
    throw createPortalBlocker(
      runContext,
      finalBoundary.recaptchaVisible
        ? "Greater Anglia requires reCAPTCHA completion before final Submit can be enabled."
        : "Greater Anglia final Submit is present but is not enabled.",
      {
        code: finalBoundary.recaptchaVisible
          ? "recaptcha_required"
          : "final_submit_not_enabled",
        diagnostic: runContext.diagnostic,
      }
    );
  }

  const gateFailures = getFinalSubmissionGateFailures();
  if (gateFailures.length > 0) {
    throw createPortalBlocker(
      runContext,
      `Greater Anglia final submission is not fully authorised: ${gateFailures.join(", ")}.`,
      {
        code: "final_submit_safety_lock",
        missingData: gateFailures,
        diagnostic: snapshot,
      }
    );
  }

  if (
    confirmation.submitOnlyWhenPassengerConfirmedTravel !== false &&
    !hasPassengerTravelConfirmation(plan, mappedSubmission)
  ) {
    throw createPortalBlocker(
      runContext,
      "Greater Anglia final submission is blocked because passenger travel confirmation is missing.",
      {
        code: "passenger_confirmation_missing",
        missingData: ["passenger travel confirmation"],
        diagnostic: snapshot,
      }
    );
  }

  if (confirmation.customerDeclarationRequired === true) {
    const declaration = await selectVisibleChoice(
      page,
      runContext,
      "customer declaration",
      ["I confirm", "I declare", "I agree"],
      ["declaration", "confirm", "fraud", "information.*correct"]
    );

    if (!declaration?.ok) {
      throw createPortalBlocker(
        runContext,
        "Greater Anglia requires a customer declaration, but the declaration control could not be selected safely.",
        { code: "declaration_not_found", diagnostic: snapshot }
      );
    }
  }

  return await inspectPortalPanel(page);
}

async function clickFinalSubmitSafely(page, runContext) {
  const result = await page.evaluate(() => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        !element.disabled
      );
    }

    const candidates = Array.from(
      document.querySelectorAll('button, input[type="submit"], a, [role="button"]')
    )
      .filter(visible)
      .map((element) => ({
        element,
        text: String(
          element.innerText ||
            element.textContent ||
            element.value ||
            element.getAttribute("aria-label") ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim(),
      }))
      .filter((entry) =>
        /^(submit|submit claim|submit my claim|confirm and submit|complete claim)$/i.test(entry.text)
      );

    if (candidates.length !== 1) {
      return {
        ok: false,
        reason: `Expected one exact final-submit control, found ${candidates.length}.`,
        candidates: candidates.map((entry) => entry.text),
      };
    }

    candidates[0].element.scrollIntoView({ block: "center", inline: "center" });
    candidates[0].element.click();
    return { ok: true, text: candidates[0].text };
  });

  if (!result?.ok) {
    throw createPortalBlocker(
      runContext,
      `Greater Anglia final Submit could not be clicked safely: ${result?.reason || "unknown reason"}`,
      { code: "final_submit_not_found", diagnostic: await inspectPortalPanel(page) }
    );
  }

  addStep(runContext, "Click final Submit", result);
  return result;
}

async function extractOperatorReference(page) {
  const bodyText = await page.locator("body").innerText({ timeout: 10000 });
  const referenceMatch = bodyText.match(
    /(?:claim reference number|reference number|claim reference)\s*:?\s*([A-Z0-9][A-Z0-9\-/]{5,})/i
  );

  return referenceMatch?.[1] || null;
}

async function runGreaterAngliaPlaywrightSubmission({
  portalSubmissionPlan,
  mappedSubmission,
  finalSubmitEnabled = false,
} = {}) {
  const runContext = createRunContext({
    mappedSubmission,
    finalSubmitEnabled,
  });

  if (!portalSubmissionPlan) {
    completeRunContext(runContext);
    addWarning(runContext, "Portal submission plan missing.");
    throw new Error("A Greater Anglia portal submission plan is required.");
  }

  if (portalSubmissionPlan.automationReadiness?.readyForBrowserAutomation === false) {
    completeRunContext(runContext);
    addWarning(runContext, "Browser automation missing required mapped inputs.", {
      missingAutomationInputs:
        portalSubmissionPlan.automationReadiness.missingAutomationInputs || [],
    });

    return {
      submitted: false,
      blocked: true,
      reason: "Greater Anglia browser automation is missing required mapped inputs.",
      source: "greater_anglia_playwright_missing_inputs",
      missingAutomationInputs:
        portalSubmissionPlan.automationReadiness.missingAutomationInputs || [],
      operator: "Greater Anglia",
      operatorKey: "greater_anglia",
      integrationStatus: "playwright_executor_ready_safety_locked",
      finalSubmitEnabled: finalSubmitEnabled === true,
      runContext,
    };
  }

  const preflight = validateGreaterAngliaPreflight(portalSubmissionPlan);

  if (!preflight.valid) {
    const firstIssue = preflight.issues[0];
    setCheckpoint(runContext, "preflight_validation", {
      valid: false,
      issues: preflight.issues,
    });
    runContext.diagnostic = {
      stage: "preflight",
      issues: preflight.issues,
    };
    completeRunContext(runContext);

    return {
      submitted: false,
      blocked: true,
      reason: firstIssue.message,
      checkpoint: runContext.checkpoint,
      blocker_code: firstIssue.code,
      missing_data: ["valid 18-character smartcard number"],
      diagnostic: runContext.diagnostic,
      source: "greater_anglia_playwright_invalid_claim_data",
      operator: "Greater Anglia",
      operatorKey: "greater_anglia",
      integrationStatus: "playwright_executor_invalid_claim_data",
      customer_status: "action_required",
      customer_title: "Update your Smartcard Number",
      customer_message: firstIssue.message,
      customer_next_step:
        "Enter the full 18-character number exactly as displayed on the Smartcard, then Delai can retry the claim.",
      finalSubmitEnabled: finalSubmitEnabled === true,
      runContext,
      mappedSubmission,
    };
  }

  const timeoutMs = getNumberEnv(
    "GREATER_ANGLIA_PLAYWRIGHT_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS
  );

  let browser = null;
  let page = null;

  try {
    const { chromium } = await loadPlaywright();
    const configuredExecutablePath = cleanText(
      process.env.GREATER_ANGLIA_PLAYWRIGHT_EXECUTABLE_PATH
    );

    browser = await chromium.launch({
      headless: getBooleanEnv("GREATER_ANGLIA_PLAYWRIGHT_HEADLESS", true),
      ...(configuredExecutablePath
        ? { executablePath: configuredExecutablePath }
        : {}),
    });

    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      userAgent:
        "Mozilla/5.0 DelaiBot/1.0 (+https://delaiapp.com; Delay Repay claim automation)",
    });

    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    addLog(runContext, "Browser opened.", {
      headless: getBooleanEnv("GREATER_ANGLIA_PLAYWRIGHT_HEADLESS", true),
      timeoutMs,
      finalSubmitEnabled: finalSubmitEnabled === true,
    });

    const startClaimUrl = portalSubmissionPlan.portal?.startClaimUrl;

    addStep(runContext, "Open Greater Anglia Delay Repay portal", {
      url: startClaimUrl,
    });

    await page.goto(startClaimUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await dismissCookieConsent(page, runContext);
    await captureScreenshot(page, runContext, "01_portal_opened");

    // Greater Anglia starts with Personal Details, so this must run before Journey/Ticket.
    setCheckpoint(runContext, "personal_details");
    await fillPassengerStep(page, runContext, portalSubmissionPlan);
    setCheckpoint(runContext, "personal_details_complete");
    await captureScreenshot(page, runContext, "02_after_personal_details_step");

    setCheckpoint(runContext, "journey_details");
    await fillJourneyStep(page, runContext, portalSubmissionPlan);
    setCheckpoint(runContext, "journey_details_complete");
    await captureScreenshot(page, runContext, "03_after_journey_step");

    await fillTicketStep(page, runContext, portalSubmissionPlan);
    await captureScreenshot(page, runContext, "04_after_ticket_step");

    await fillCompensationStep(
      page,
      runContext,
      portalSubmissionPlan,
      mappedSubmission
    );
    await prepareConfirmationStep(
      page,
      runContext,
      portalSubmissionPlan,
      mappedSubmission,
      finalSubmitEnabled
    );
    await captureScreenshot(page, runContext, "05_before_final_confirmation");

    if (!finalSubmitEnabled) {
      addStep(runContext, "Final submit safety lock active", {
        finalSubmitEnabled: false,
      });
      await captureScreenshot(page, runContext, "05_safety_lock_final_submit_disabled");
      completeRunContext(runContext);

      return {
        submitted: false,
        blocked: true,
        reason:
          "Greater Anglia end-to-end browser run reached the final review screen. Final Submit remains safety-locked.",
        checkpoint: runContext.checkpoint,
        blocker_code: "final_submit_safety_lock",
        diagnostic: runContext.diagnostic,
        source: "greater_anglia_playwright_executor_safety_locked",
        operator: "Greater Anglia",
        operatorKey: "greater_anglia",
        integrationStatus: "playwright_executor_ready_safety_locked",
        customer_status: "operator_submission_pending",
        customer_title: "Claim ready for Delai submission",
        customer_message:
          "Your claim is ready. Delai is preparing automatic submission for Greater Anglia.",
        customer_next_step:
          "No further action is needed right now. Delai has run the controlled browser preparation flow and is keeping final submission locked until verification is complete.",
        finalSubmitEnabled: false,
        runContext,
        mappedSubmission,
      };
    }

    await clickFinalSubmitSafely(page, runContext);

    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await captureScreenshot(page, runContext, "06_after_final_submit");

    const operatorReference = await extractOperatorReference(page);

    if (!operatorReference) {
      throw createPortalBlocker(
        runContext,
        "Greater Anglia submission may have completed, but no operator reference number could be detected. Manual review is required.",
        {
          code: "operator_reference_missing",
          diagnostic: await inspectPortalPanel(page),
        }
      );
    }

    setCheckpoint(runContext, "submitted", { operatorReference });
    completeRunContext(runContext);

    return {
      submitted: true,
      blocked: false,
      source: "greater_anglia_playwright_live_submission",
      operator: "Greater Anglia",
      operatorKey: "greater_anglia",
      integrationStatus: "live_submission_enabled",
      submittedAt: new Date().toISOString(),
      operatorReference,
      checkpoint: runContext.checkpoint,
      finalSubmitEnabled: true,
      runContext,
      mappedSubmission,
    };
  } catch (error) {
    completeRunContext(runContext);
    if (error.checkpoint) {
      runContext.checkpoint = error.checkpoint;
    }
    if (error.diagnostic) {
      runContext.diagnostic = error.diagnostic;
    } else if (page) {
      runContext.diagnostic = await inspectPortalPanel(page).catch(() => runContext.diagnostic);
    }
    addWarning(runContext, "Greater Anglia Playwright executor failed.", {
      error: error.message,
      code: error.code || "playwright_executor_error",
      checkpoint: runContext.checkpoint,
      missingData: error.missingData || [],
    });

    if (page) {
      await captureScreenshot(page, runContext, "99_error_state");
    }

    return {
      submitted: false,
      blocked: true,
      reason: error.message,
      checkpoint: runContext.checkpoint,
      blocker_code: error.code || "playwright_executor_error",
      missing_data: error.missingData || [],
      diagnostic: runContext.diagnostic,
      source: "greater_anglia_playwright_executor_error",
      operator: "Greater Anglia",
      operatorKey: "greater_anglia",
      integrationStatus: "playwright_executor_error",
      customer_status: "operator_submission_pending",
      customer_title: "Claim ready for Delai submission",
      customer_message:
        "Your claim is ready. Delai is preparing automatic submission for Greater Anglia.",
      customer_next_step:
        "No further action is needed right now. Delai has saved the claim and will retry once the browser automation issue is resolved.",
      finalSubmitEnabled: finalSubmitEnabled === true,
      runContext,
      mappedSubmission,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

export {
  getBooleanEnv,
  runGreaterAngliaPlaywrightSubmission,
};
