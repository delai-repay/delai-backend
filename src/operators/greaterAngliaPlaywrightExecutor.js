const DEFAULT_TIMEOUT_MS = 45000;

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

function createRunContext() {
  return {
    startedAt: new Date().toISOString(),
    completedAt: null,
    steps: [],
    warnings: [],
    screenshots: [],
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

  const screenshotDir =
    cleanText(process.env.GREATER_ANGLIA_SCREENSHOT_DIR) ||
    "./operator-run-artifacts";

  const safeName = name.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
  const filePath = `${screenshotDir}/greater-anglia-${Date.now()}-${safeName}.png`;

  try {
    await page.screenshot({ path: filePath, fullPage: true });
    runContext.screenshots.push(filePath);
    return filePath;
  } catch (error) {
    addWarning(runContext, "Screenshot could not be captured.", {
      name,
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

function labelCandidates(page, labelRegex, cssSelectors = []) {
  return [
    {
      description: `label ${labelRegex}`,
      locator: () => page.getByLabel(labelRegex),
    },
    ...cssSelectors.map((selector) => ({
      description: selector,
      locator: () => page.locator(selector),
    })),
  ];
}

async function fillField(page, runContext, label, value, labelRegex, cssSelectors = []) {
  const cleanValue = cleanText(value);

  if (!cleanValue) {
    addWarning(runContext, `${label} skipped because no value was provided.`);
    return false;
  }

  return tryLocatorAction(
    runContext,
    `Fill ${label}`,
    labelCandidates(page, labelRegex, cssSelectors),
    async (locator) => {
      await locator.fill(cleanValue);
    }
  );
}

async function selectField(page, runContext, label, value, labelRegex, cssSelectors = []) {
  const cleanValue = cleanText(value);

  if (!cleanValue) {
    addWarning(runContext, `${label} skipped because no value was provided.`);
    return false;
  }

  return tryLocatorAction(
    runContext,
    `Select ${label}`,
    labelCandidates(page, labelRegex, cssSelectors),
    async (locator) => {
      try {
        await locator.selectOption({ label: cleanValue });
      } catch {
        await locator.selectOption(cleanValue);
      }
    }
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

async function fillJourneyStep(page, runContext, plan) {
  const journey = plan.journeyStep || {};

  await fillField(
    page,
    runContext,
    "date of journey",
    normaliseDateForInput(journey.dateOfJourney),
    /date of journey|journey date|date/i,
    ['input[type="date"]', 'input[name*="date"]', 'input[id*="date"]']
  );

  await selectField(
    page,
    runContext,
    "scheduled departure hour",
    journey.scheduledDepartureHour,
    /hour/i,
    ['select[name*="hour"]', 'select[id*="hour"]']
  );

  await selectField(
    page,
    runContext,
    "scheduled departure minute",
    journey.scheduledDepartureMinute,
    /minute/i,
    ['select[name*="minute"]', 'select[id*="minute"]']
  );

  await continueIfAvailable(page, runContext, "journey time");

  await fillField(
    page,
    runContext,
    "from station",
    journey.fromStation,
    /^from$|from station|journey start/i,
    ['input[name*="from"]', 'input[id*="from"]', 'input[name*="origin"]']
  );

  await fillField(
    page,
    runContext,
    "to station",
    journey.toStation,
    /^to$|to station|journey end/i,
    ['input[name*="to"]', 'input[id*="to"]', 'input[name*="destination"]']
  );

  await continueIfAvailable(page, runContext, "stations");

  await clickByText(page, runContext, "add train manually if required", /add manually|still can't find/i);

  await clickByText(
    page,
    runContext,
    "delay band",
    new RegExp(journey.delayBand || "15\\+ Mins", "i")
  );

  await clickByText(
    page,
    runContext,
    "delay type",
    new RegExp(journey.delayType || "Delayed", "i")
  );

  await continueIfAvailable(page, runContext, "delay details");
}

async function fillTicketStep(page, runContext, plan) {
  const ticket = plan.ticketStep || {};

  await clickByText(page, runContext, "more than one ticket no", /no/i);
  await continueIfAvailable(page, runContext, "ticket count");

  await clickByText(page, runContext, "ticket has no barcode", /does not have a barcode|doesn't have a barcode|no barcode/i);

  await fillField(
    page,
    runContext,
    "smartcard number",
    ticket.smartcardNumber,
    /smartcard number|card number/i,
    ['input[name*="smart"]', 'input[id*="smart"]', 'input[name*="card"]']
  );

  await fillField(
    page,
    runContext,
    "unique ticket reference",
    ticket.uniqueTicketReference,
    /unique ticket reference|ticket reference|reference/i,
    ['input[name*="reference"]', 'input[id*="reference"]']
  );

  await fillField(
    page,
    runContext,
    "ticket origin station",
    ticket.originStation,
    /origin station|from/i,
    ['input[name*="origin"]', 'input[id*="origin"]']
  );

  await fillField(
    page,
    runContext,
    "ticket destination station",
    ticket.destinationStation,
    /destination station|to/i,
    ['input[name*="destination"]', 'input[id*="destination"]']
  );

  await fillField(
    page,
    runContext,
    "ticket valid from",
    normaliseDateForInput(ticket.dateFrom),
    /date from|valid from/i,
    ['input[name*="from"]', 'input[id*="from"]']
  );

  await fillField(
    page,
    runContext,
    "ticket expiry date",
    normaliseDateForInput(ticket.expiryDate),
    /expiry date|date until|valid to/i,
    ['input[name*="until"]', 'input[id*="until"]', 'input[name*="expiry"]']
  );

  await fillField(
    page,
    runContext,
    "ticket price",
    ticket.ticketPrice,
    /ticket price|cost/i,
    ['input[name*="price"]', 'input[id*="price"]', 'input[name*="cost"]']
  );

  await selectField(
    page,
    runContext,
    "ticket class",
    ticket.ticketClass || "Standard Class",
    /ticket class|class/i,
    ['select[name*="class"]', 'select[id*="class"]']
  );

  await continueIfAvailable(page, runContext, "ticket details");
}

async function fillPassengerStep(page, runContext, plan) {
  const passenger = plan.passengerStep || {};
  const fullName = cleanText(passenger.fullName) || "";
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || fullName;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : fullName;

  await fillField(page, runContext, "first name", firstName, /first name|forename/i, [
    'input[name*="first"]',
    'input[id*="first"]',
    'input[name*="forename"]',
  ]);

  await fillField(page, runContext, "last name", lastName, /last name|surname/i, [
    'input[name*="last"]',
    'input[id*="last"]',
    'input[name*="surname"]',
  ]);

  await fillField(page, runContext, "full name", passenger.fullName, /full name|name/i, [
    'input[name*="name"]',
    'input[id*="name"]',
  ]);

  await fillField(page, runContext, "email", passenger.email, /email/i, [
    'input[type="email"]',
    'input[name*="email"]',
    'input[id*="email"]',
  ]);

  await fillField(page, runContext, "mobile", passenger.mobile, /mobile|phone|telephone/i, [
    'input[type="tel"]',
    'input[name*="mobile"]',
    'input[name*="phone"]',
    'input[id*="mobile"]',
  ]);

  await fillField(page, runContext, "address line 1", passenger.addressLine1, /address line 1|address 1|address/i, [
    'input[name*="address"]',
    'input[id*="address"]',
  ]);

  await fillField(page, runContext, "address line 2", passenger.addressLine2, /address line 2|address 2/i, [
    'input[name*="address2"]',
    'input[id*="address2"]',
  ]);

  await fillField(page, runContext, "town or city", passenger.townCity, /town|city/i, [
    'input[name*="town"]',
    'input[name*="city"]',
    'input[id*="town"]',
  ]);

  await fillField(page, runContext, "postcode", passenger.postcode, /postcode|post code|postal code/i, [
    'input[name*="post"]',
    'input[id*="post"]',
  ]);

  await selectField(page, runContext, "country", passenger.country || "United Kingdom", /country/i, [
    'select[name*="country"]',
    'select[id*="country"]',
  ]);

  await continueIfAvailable(page, runContext, "passenger details");
}

async function fillCompensationStep(page, runContext, plan) {
  const compensation = plan.compensationStep || {};

  await clickByText(
    page,
    runContext,
    "preferred payment method",
    new RegExp(compensation.preferredPaymentMethod || "BACS|Rail Travel Vouchers|PayPal", "i")
  );

  await continueIfAvailable(page, runContext, "compensation details");
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
  if (!portalSubmissionPlan) {
    throw new Error("A Greater Anglia portal submission plan is required.");
  }

  if (portalSubmissionPlan.automationReadiness?.readyForBrowserAutomation === false) {
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
    };
  }

  const timeoutMs = getNumberEnv(
    "GREATER_ANGLIA_PLAYWRIGHT_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS
  );

  const runContext = createRunContext();
  let browser = null;

  try {
    const { chromium } = await loadPlaywright();

    browser = await chromium.launch({
      headless: getBooleanEnv("GREATER_ANGLIA_PLAYWRIGHT_HEADLESS", true),
    });

    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      userAgent:
        "Mozilla/5.0 DelaiBot/1.0 (+https://delaiapp.com; Delay Repay claim automation)",
    });

    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    const startClaimUrl = portalSubmissionPlan.portal?.startClaimUrl;

    addStep(runContext, "Open Greater Anglia Delay Repay portal", {
      url: startClaimUrl,
    });

    await page.goto(startClaimUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await captureScreenshot(page, runContext, "01_portal_opened");

    await clickByText(page, runContext, "accept cookies if shown", /accept|agree|allow all/i);

    await fillJourneyStep(page, runContext, portalSubmissionPlan);
    await captureScreenshot(page, runContext, "02_after_journey_step");

    await fillTicketStep(page, runContext, portalSubmissionPlan);
    await captureScreenshot(page, runContext, "03_after_ticket_step");

    await fillPassengerStep(page, runContext, portalSubmissionPlan);
    await captureScreenshot(page, runContext, "04_after_passenger_step");

    await fillCompensationStep(page, runContext, portalSubmissionPlan);
    await captureScreenshot(page, runContext, "05_before_final_confirmation");

    if (!finalSubmitEnabled) {
      runContext.completedAt = new Date().toISOString();

      return {
        submitted: false,
        blocked: true,
        reason:
          "Greater Anglia Playwright executor completed the browser run, but the final submit button is safety-locked.",
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

    await clickByText(page, runContext, "final submit", /submit|submit claim|confirm/i, [
      'input[type="submit"]',
      'button[type="submit"]',
    ]);

    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await captureScreenshot(page, runContext, "06_after_final_submit");

    const operatorReference = await extractOperatorReference(page);

    if (!operatorReference) {
      throw new Error(
        "Greater Anglia submission may have completed, but no operator reference number could be detected. Manual review is required."
      );
    }

    runContext.completedAt = new Date().toISOString();

    return {
      submitted: true,
      blocked: false,
      source: "greater_anglia_playwright_live_submission",
      operator: "Greater Anglia",
      operatorKey: "greater_anglia",
      integrationStatus: "live_submission_enabled",
      submittedAt: new Date().toISOString(),
      operatorReference,
      runContext,
      mappedSubmission,
    };
  } catch (error) {
    runContext.completedAt = new Date().toISOString();
    addWarning(runContext, "Greater Anglia Playwright executor failed.", {
      error: error.message,
    });

    return {
      submitted: false,
      blocked: true,
      reason: error.message,
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
