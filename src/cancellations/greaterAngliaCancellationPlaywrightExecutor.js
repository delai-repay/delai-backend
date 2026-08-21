import path from "node:path";
import { mkdir } from "node:fs/promises";

const DEFAULT_TIMEOUT_MS = 45000;
const EXECUTOR_VERSION = "greater-anglia-cancellation-draft-1.0";
const CANCELLATION_FINAL_SUBMIT_IMPLEMENTED = false;

function cleanText(value) {
  if (value === undefined || value === null) return null;

  const cleaned = String(value).trim();
  return cleaned || null;
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).trim().toLowerCase() === "true";
}

function numberEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeRunId() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);

  return `greater-anglia-cancellation-${timestamp}-${suffix}`;
}

function splitPassengerName(fullName) {
  const parts = cleanText(fullName)?.split(/\s+/).filter(Boolean) || [];

  if (parts.length < 2) {
    return {
      firstName: parts[0] || null,
      lastName: null,
    };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1),
  };
}

function isoDate(value) {
  const match = cleanText(value)?.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
}

function exactTime(value) {
  const match = cleanText(value)?.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : null;
}

function buildGreaterAngliaCancellationQuestion(mappedSubmission = {}) {
  const journey = mappedSubmission.journey || {};
  const ticket = mappedSubmission.ticket || {};
  const request = mappedSubmission.compensationRequest || {};
  const service = request.serviceEvidence || {};

  const serviceIdentifier =
    cleanText(service.serviceIdentifier) || cleanText(journey.serviceIdentifier);
  const disruptionReason =
    cleanText(service.disruptionReason) || cleanText(journey.disruptionReason);

  const lines = [
    "Season Ticket compensation request for a cancelled and abandoned journey.",
    request.passengerStatement ||
      "The passenger confirmed that the scheduled service was cancelled and that they abandoned the journey without travelling.",
    `Journey: ${cleanText(journey.originStation) || "unknown origin"} to ${
      cleanText(journey.destinationStation) || "unknown destination"
    } on ${isoDate(journey.date) || "unknown date"} at ${
      exactTime(journey.scheduledDepartureTime) || "unknown time"
    }.`,
    serviceIdentifier ? `Service reference: ${serviceIdentifier}.` : null,
    disruptionReason ? `Recorded cancellation reason: ${disruptionReason}.` : null,
    `Ticket: ${cleanText(ticket.type) || "Season Ticket"}, valid ${
      isoDate(ticket.startDate) || "unknown start"
    } to ${isoDate(ticket.endDate) || "unknown end"}.`,
    request.requestedOutcome ||
      "Please assess compensation covering the cost of this journey under the Greater Anglia Passenger's Charter.",
  ].filter(Boolean);

  return lines.join("\n\n");
}

function buildGreaterAngliaCancellationFormDraft(mappedSubmission = {}) {
  const passenger = mappedSubmission.passenger || {};
  const journey = mappedSubmission.journey || {};
  const ticket = mappedSubmission.ticket || {};
  const { firstName, lastName } = splitPassengerName(passenger.fullName);

  return {
    contactReasonPreference: [
      /season ticket.*compensation/i,
      /compensation.*season ticket/i,
      /complaint.*compensation|compensation.*complaint/i,
      /complaint/i,
      /other/i,
      /question|enquiry/i,
    ],
    firstName,
    lastName,
    email: cleanText(passenger.email),
    addressLine1: cleanText(passenger.addressLine1),
    addressLine2: cleanText(passenger.addressLine2),
    townCity: cleanText(passenger.townCity),
    county: cleanText(passenger.county),
    postcode: cleanText(passenger.postcode),
    boardingStation: cleanText(journey.originStation),
    destinationStation: cleanText(journey.destinationStation),
    trainHeadcode: cleanText(journey.serviceIdentifier),
    journeyDate: isoDate(journey.date),
    journeyTime: exactTime(journey.scheduledDepartureTime),
    ticketType: cleanText(ticket.type),
    ticketCost: money(ticket.cost),
    bookingReference: cleanText(ticket.bookingReference),
    ticketPurchasedFrom:
      cleanText(ticket.smartcardProvider) ||
      cleanText(mappedSubmission.operator?.displayName) ||
      "Greater Anglia",
    question: buildGreaterAngliaCancellationQuestion(mappedSubmission),
    contactNumber: cleanText(passenger.mobile),
    marketingConsent: false,
    regulatorResearchConsent: false,
  };
}

function validateGreaterAngliaCancellationDraftPreflight(mappedSubmission = {}) {
  const draft = buildGreaterAngliaCancellationFormDraft(mappedSubmission);
  const required = [
    ["firstName", "passenger first name"],
    ["lastName", "passenger last name"],
    ["email", "passenger email"],
    ["addressLine1", "passenger address line 1"],
    ["townCity", "passenger town or city"],
    ["postcode", "passenger postcode"],
    ["boardingStation", "boarding station"],
    ["destinationStation", "destination station"],
    ["journeyDate", "journey date"],
    ["journeyTime", "journey time"],
    ["ticketType", "ticket type"],
    ["ticketCost", "ticket cost"],
    ["ticketPurchasedFrom", "ticket purchased from"],
    ["question", "customer question"],
  ];
  const missingFields = required
    .filter(([key]) => !draft[key])
    .map(([, label]) => label);

  return {
    valid: missingFields.length === 0,
    missingFields,
    draft,
  };
}

function createRunContext(mappedSubmission) {
  return {
    runId: safeRunId(),
    executorVersion: EXECUTOR_VERSION,
    operator: "Greater Anglia",
    operatorKey: "greater_anglia",
    claimId: mappedSubmission?.claim?.id || null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    finalSubmitEnabled: false,
    finalSubmitImplemented: CANCELLATION_FINAL_SUBMIT_IMPLEMENTED,
    checkpoint: "initialising",
    screenshotDir:
      cleanText(process.env.GREATER_ANGLIA_CANCELLATION_SCREENSHOT_DIR) ||
      cleanText(process.env.GREATER_ANGLIA_SCREENSHOT_DIR) ||
      "./operator-run-artifacts",
    screenshots: [],
    steps: [],
    warnings: [],
    diagnostic: null,
  };
}

function addStep(runContext, name, details = {}) {
  runContext.steps.push({ name, at: new Date().toISOString(), ...details });
}

function addWarning(runContext, warning, details = {}) {
  runContext.warnings.push({
    warning,
    at: new Date().toISOString(),
    ...details,
  });
}

function setCheckpoint(runContext, checkpoint, details = {}) {
  runContext.checkpoint = checkpoint;
  addStep(runContext, `Checkpoint: ${checkpoint}`, details);
}

function completeRun(runContext) {
  runContext.completedAt = new Date().toISOString();
  return runContext;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error(
      "Playwright is not installed. Run npm install and install the Chromium browser before enabling the cancellation draft executor."
    );
  }
}

async function captureScreenshot(page, runContext, name, fullPage = false) {
  if (!boolEnv("GREATER_ANGLIA_CANCELLATION_CAPTURE_SCREENSHOTS", true)) {
    return null;
  }

  const safeName = String(name).replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
  const filePath = path.join(
    runContext.screenshotDir,
    `${runContext.runId}-${safeName}.png`
  );

  try {
    await mkdir(runContext.screenshotDir, { recursive: true });
    await page.screenshot({ path: filePath, fullPage });
    runContext.screenshots.push({
      name,
      path: filePath,
      url: page.url(),
      capturedAt: new Date().toISOString(),
    });
    return filePath;
  } catch (error) {
    addWarning(runContext, "Screenshot could not be captured.", {
      name,
      error: error.message,
    });
    return null;
  }
}

async function dismissCookieConsent(page, runContext) {
  const candidates = [
    page.getByRole("button", { name: /accept all|accept cookies|allow all/i }),
    page.locator("#onetrust-accept-btn-handler"),
    page.locator('button[id*="accept" i]'),
  ];

  for (const candidate of candidates) {
    try {
      if ((await candidate.count()) > 0 && (await candidate.first().isVisible())) {
        await candidate.first().click();
        addStep(runContext, "Dismiss cookie consent");
        return true;
      }
    } catch {
      // Continue through defensive cookie selectors.
    }
  }

  return false;
}

function candidateLocators(page, labelRegex, selectors = []) {
  return [
    { description: `label ${labelRegex}`, locator: page.getByLabel(labelRegex) },
    ...selectors.map((selector) => ({
      description: selector,
      locator: page.locator(selector),
    })),
  ];
}

async function fillField({
  page,
  runContext,
  label,
  value,
  labelRegex,
  selectors = [],
  required = true,
}) {
  const cleanValue = cleanText(value);

  if (!cleanValue) {
    if (required) {
      throw new Error(`${label} is missing from the cancellation form draft.`);
    }
    return false;
  }

  let lastError = null;

  for (const candidate of candidateLocators(page, labelRegex, selectors)) {
    try {
      if ((await candidate.locator.count()) === 0) continue;

      const locator = candidate.locator.first();
      await locator.waitFor({ state: "visible", timeout: 2500 });
      await locator.fill(cleanValue);
      addStep(runContext, `Fill ${label}`, {
        selector: candidate.description,
      });
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  if (required) {
    throw new Error(
      `${label} could not be located on the current Greater Anglia Customer Relations form.${
        lastError ? ` ${lastError.message}` : ""
      }`
    );
  }

  addWarning(runContext, `${label} was not filled because the field was unavailable.`);
  return false;
}

async function selectContactReason(page, runContext, preferences) {
  const candidates = candidateLocators(
    page,
    /Why are you Contacting us\??/i,
    [
      'select[name*="contact" i]',
      'select[id*="contact" i]',
      'select[name*="reason" i]',
    ]
  );

  for (const candidate of candidates) {
    try {
      if ((await candidate.locator.count()) === 0) continue;

      const select = candidate.locator.first();
      const options = await select.locator("option").evaluateAll((items) =>
        items.map((item) => ({
          label: String(item.textContent || "").replace(/\s+/g, " ").trim(),
          value: item.value,
          disabled: Boolean(item.disabled),
        }))
      );

      let selected = null;
      for (const preference of preferences) {
        selected = options.find(
          (option) =>
            option.value &&
            !option.disabled &&
            preference.test(option.label) &&
            !/delay\s*repay|first class refund/i.test(option.label)
        );
        if (selected) break;
      }

      if (!selected) continue;

      await select.selectOption(selected.value);
      addStep(runContext, "Select contact reason", {
        selector: candidate.description,
        selectedLabel: selected.label,
      });
      return selected.label;
    } catch {
      // Continue through defensive select locators.
    }
  }

  throw new Error(
    "A safe cancellation-compensation contact reason could not be selected on the current Greater Anglia form."
  );
}

async function chooseNoConsent(page, runContext) {
  const marketingCandidates = [
    page.getByLabel(/^No thank you$/i),
    page
      .locator("fieldset")
      .filter({ hasText: /email marketing communications/i })
      .getByLabel(/^No/i),
  ];

  for (const candidate of marketingCandidates) {
    try {
      if ((await candidate.count()) > 0) {
        await candidate.first().check();
        addStep(runContext, "Decline marketing communications");
        break;
      }
    } catch {
      // Marketing is optional; retain a warning below when no safe control exists.
    }
  }

  const researchCandidates = [
    page
      .locator("fieldset")
      .filter({ hasText: /Office of Rail and Road|M\.E\.L\. Research/i })
      .getByLabel(/^No$/i),
    page
      .locator("fieldset")
      .filter({ hasText: /consent to being contacted/i })
      .getByLabel(/^No$/i),
  ];

  let researchSelected = false;
  for (const candidate of researchCandidates) {
    try {
      if ((await candidate.count()) > 0) {
        await candidate.first().check();
        addStep(runContext, "Decline regulator research contact");
        researchSelected = true;
        break;
      }
    } catch {
      // Continue through scoped research consent locators.
    }
  }

  if (!researchSelected) {
    addWarning(
      runContext,
      "The optional regulator research consent control could not be selected safely."
    );
  }
}

async function inspectDraftBoundary(page) {
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

    function labelFor(element) {
      const explicit = element.id
        ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
        : null;
      return String(
        explicit?.textContent ||
          element.getAttribute("aria-label") ||
          element.getAttribute("name") ||
          element.id ||
          element.type ||
          "unknown field"
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
    }

    const submitControls = Array.from(
      document.querySelectorAll('button, input[type="submit"], [role="button"]')
    )
      .filter(rendered)
      .map((element) => ({
        text: String(
          element.innerText ||
            element.textContent ||
            element.value ||
            element.getAttribute("aria-label") ||
            ""
        )
          .replace(/\s+/g, " ")
          .trim(),
        type: element.getAttribute("type") || null,
        disabled:
          Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true",
      }))
      .filter((entry) => /^submit$/i.test(entry.text));

    const forms = Array.from(document.querySelectorAll("form"));
    const form =
      forms.find((candidate) =>
        /Why are you Contacting us|Your contact details|Date of Journey/i.test(
          String(candidate.innerText || candidate.textContent || "")
        )
      ) ||
      forms.find((candidate) =>
        Array.from(
          candidate.querySelectorAll('button, input[type="submit"]')
        ).some((element) =>
          /^submit$/i.test(
            String(
              element.innerText || element.textContent || element.value || ""
            ).trim()
          )
        )
      ) ||
      null;
    const invalidRequiredFields = form
      ? Array.from(form.querySelectorAll("input, select, textarea"))
          .filter((element) => element.required && !element.checkValidity())
          .map(labelFor)
      : [];
    const emptyRequiredFileInputs = form
      ? Array.from(form.querySelectorAll('input[type="file"][required]'))
          .filter((element) => !element.files || element.files.length === 0)
          .map(labelFor)
      : [];

    return {
      formFound: Boolean(form),
      submitControlCount: submitControls.length,
      submitControls,
      invalidRequiredFieldCount: invalidRequiredFields.length,
      invalidRequiredFields,
      emptyRequiredFileInputCount: emptyRequiredFileInputs.length,
      emptyRequiredFileInputs,
      recaptchaVisible: Boolean(
        Array.from(
          document.querySelectorAll(
            '.g-recaptcha, iframe[src*="recaptcha"], iframe[title*="captcha" i]'
          )
        ).find(rendered)
      ),
    };
  });
}

async function fillCancellationDraft(page, runContext, draft) {
  await selectContactReason(
    page,
    runContext,
    draft.contactReasonPreference
  );

  const fields = [
    ["first name", draft.firstName, /First name\(s\)/i, ['input[name*="first" i]'], true],
    ["last name", draft.lastName, /Last name/i, ['input[name*="last" i]'], true],
    ["email", draft.email, /^Email/i, ['input[type="email"]'], true],
    ["address line 1", draft.addressLine1, /Address line 1/i, ['input[name*="address.*1" i]'], true],
    ["address line 2", draft.addressLine2, /Address line 2/i, ['input[name*="address.*2" i]'], false],
    ["town or city", draft.townCity, /Town\s*\/\s*City/i, ['input[name*="town" i]', 'input[name*="city" i]'], true],
    ["county", draft.county, /^County/i, ['input[name*="county" i]'], false],
    ["postcode", draft.postcode, /^Postcode/i, ['input[name*="postcode" i]'], true],
    ["boarding station", draft.boardingStation, /Boarding Station/i, ['input[name*="boarding" i]'], true],
    ["destination station", draft.destinationStation, /Destination Station/i, ['input[name*="destination" i]'], true],
    ["train headcode", draft.trainHeadcode, /Coach Number.*Train Headcode/i, ['input[name*="headcode" i]'], false],
    ["journey date", draft.journeyDate, /Date of Journey/i, ['input[type="date"]'], true],
    ["journey time", draft.journeyTime, /Time of Journey/i, ['input[type="time"]'], true],
    ["ticket type", draft.ticketType, /Ticket Type/i, ['input[name*="ticket.*type" i]'], true],
    ["ticket cost", draft.ticketCost, /Ticket Cost/i, ['input[name*="ticket.*cost" i]'], true],
    ["booking reference", draft.bookingReference, /Booking Reference/i, ['input[name*="booking" i]'], false],
    ["ticket purchased from", draft.ticketPurchasedFrom, /Ticket purchased from/i, ['input[name*="purchased" i]'], true],
    ["question", draft.question, /^Your question/i, ["textarea"], true],
    ["contact number", draft.contactNumber, /Contact number/i, ['input[type="tel"]'], false],
  ];

  for (const [label, value, labelRegex, selectors, required] of fields) {
    await fillField({
      page,
      runContext,
      label,
      value,
      labelRegex,
      selectors,
      required,
    });
  }

  await chooseNoConsent(page, runContext);
}

async function runGreaterAngliaCancellationDraft({ mappedSubmission } = {}) {
  const runContext = createRunContext(mappedSubmission);
  const preflight = validateGreaterAngliaCancellationDraftPreflight(
    mappedSubmission
  );

  if (!preflight.valid) {
    setCheckpoint(runContext, "preflight_blocked", {
      missingFields: preflight.missingFields,
    });
    completeRun(runContext);

    return {
      submitted: false,
      blocked: true,
      ready: false,
      reason: `The Greater Anglia cancellation draft is missing: ${preflight.missingFields.join(
        ", "
      )}.`,
      source: "greater_anglia_cancellation_draft_missing_inputs",
      integrationStatus: "cancellation_playwright_missing_inputs",
      submissionStatus: "cancellation_executor_blocked",
      checkpoint: runContext.checkpoint,
      blocker_code: "cancellation_draft_missing_inputs",
      missing_data: preflight.missingFields,
      finalSubmitEnabled: false,
      executorVersion: EXECUTOR_VERSION,
      runContext,
    };
  }

  if (
    boolEnv("GREATER_ANGLIA_CANCELLATION_FINAL_SUBMIT_ENABLED") ||
    boolEnv("ENABLE_GREATER_ANGLIA_CANCELLATION_SUBMISSION")
  ) {
    addWarning(
      runContext,
      "Cancellation final-submit flags were present but are ignored by Step 20D."
    );
  }

  let browser = null;
  let page = null;

  try {
    const { chromium } = await loadPlaywright();
    const timeoutMs = numberEnv(
      "GREATER_ANGLIA_CANCELLATION_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS
    );
    const executablePath = cleanText(
      process.env.GREATER_ANGLIA_PLAYWRIGHT_EXECUTABLE_PATH
    );

    browser = await chromium.launch({
      headless: boolEnv("GREATER_ANGLIA_CANCELLATION_HEADLESS", true),
      ...(executablePath ? { executablePath } : {}),
    });

    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      userAgent:
        "Mozilla/5.0 DelaiBot/1.0 (+https://delaiapp.com; rail compensation form preparation)",
    });
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    setCheckpoint(runContext, "open_customer_relations_form");
    await page.goto(
      mappedSubmission?.submissionChannel?.url ||
        "https://www.greateranglia.co.uk/form/customer-relations",
      { waitUntil: "domcontentloaded", timeout: timeoutMs }
    );
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await dismissCookieConsent(page, runContext);
    await captureScreenshot(page, runContext, "01_cancellation_form_opened");

    setCheckpoint(runContext, "fill_cancellation_draft");
    await fillCancellationDraft(page, runContext, preflight.draft);
    await captureScreenshot(page, runContext, "02_cancellation_draft_filled");

    const boundary = await inspectDraftBoundary(page);
    runContext.diagnostic = boundary;
    addStep(runContext, "Inspect protected final Submit boundary", boundary);

    if (!boundary.formFound) {
      throw new Error("The Greater Anglia Customer Relations form was not found.");
    }

    if (boundary.emptyRequiredFileInputCount > 0) {
      const error = new Error(
        "Greater Anglia requires a ticket evidence upload before this cancellation form can be ready."
      );
      error.code = "ticket_evidence_upload_required";
      error.missingData = boundary.emptyRequiredFileInputs;
      throw error;
    }

    if (boundary.invalidRequiredFieldCount > 0) {
      const error = new Error(
        "The current Greater Anglia form still has required fields that could not be completed safely."
      );
      error.code = "cancellation_form_required_fields_incomplete";
      error.missingData = boundary.invalidRequiredFields;
      throw error;
    }

    if (boundary.submitControlCount !== 1) {
      const error = new Error(
        `Expected one protected Greater Anglia Submit control, found ${boundary.submitControlCount}.`
      );
      error.code = "cancellation_submit_boundary_not_unique";
      throw error;
    }

    setCheckpoint(runContext, "final_submit_boundary", {
      finalSubmitImplemented: CANCELLATION_FINAL_SUBMIT_IMPLEMENTED,
    });
    await captureScreenshot(
      page,
      runContext,
      "03_cancellation_final_submit_safety_lock",
      true
    );
    completeRun(runContext);

    return {
      submitted: false,
      blocked: true,
      ready: true,
      reason:
        "Greater Anglia Customer Relations form draft reached the final Submit boundary. Step 20D did not and cannot press Submit.",
      source: "greater_anglia_cancellation_playwright_safety_locked",
      integrationStatus: "cancellation_playwright_ready_safety_locked",
      submissionStatus: "cancellation_form_draft_ready",
      checkpoint: runContext.checkpoint,
      blocker_code: "cancellation_final_submit_safety_lock",
      finalSubmitEnabled: false,
      executorVersion: EXECUTOR_VERSION,
      draftPreparedAt: new Date().toISOString(),
      customer_status: "cancellation_form_draft_ready",
      customer_title: "Cancellation form prepared",
      customer_message:
        "Delai prepared the Greater Anglia cancellation form, but it has not been submitted.",
      customer_next_step:
        "Manual submission is still required while Delai keeps the final Submit control safety-locked.",
      runContext,
    };
  } catch (error) {
    setCheckpoint(runContext, "cancellation_draft_blocked", {
      blockerCode: error.code || "cancellation_playwright_error",
    });
    addWarning(runContext, "Cancellation draft executor stopped safely.", {
      error: error.message,
      code: error.code || "cancellation_playwright_error",
      missingData: error.missingData || [],
    });

    if (page) {
      runContext.diagnostic =
        runContext.diagnostic ||
        (await inspectDraftBoundary(page).catch(() => null));
      await captureScreenshot(
        page,
        runContext,
        "99_cancellation_draft_blocked",
        true
      );
    }

    completeRun(runContext);

    return {
      submitted: false,
      blocked: true,
      ready: false,
      reason: error.message,
      source: "greater_anglia_cancellation_playwright_blocked",
      integrationStatus: "cancellation_playwright_blocked",
      submissionStatus: "cancellation_executor_blocked",
      checkpoint: runContext.checkpoint,
      blocker_code: error.code || "cancellation_playwright_error",
      missing_data: error.missingData || [],
      finalSubmitEnabled: false,
      executorVersion: EXECUTOR_VERSION,
      customer_status: "cancellation_executor_blocked",
      customer_title: "Cancellation form needs attention",
      customer_message:
        "Delai could not safely finish the Greater Anglia cancellation form draft, and nothing was submitted.",
      customer_next_step:
        "Use the Greater Anglia Customer Relations route manually while Delai reviews the blocked form step.",
      runContext,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

export {
  CANCELLATION_FINAL_SUBMIT_IMPLEMENTED,
  EXECUTOR_VERSION,
  buildGreaterAngliaCancellationFormDraft,
  buildGreaterAngliaCancellationQuestion,
  runGreaterAngliaCancellationDraft,
  splitPassengerName,
  validateGreaterAngliaCancellationDraftPreflight,
};
