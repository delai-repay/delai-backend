const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const target = path.join(root, "src/operators/greaterAngliaPlaywrightExecutor.js");
const helper = path.join(root, "src/operators/greaterAngliaAddressVerification.js");
const packagePath = path.join(root, "package.json");
const ORIGINAL_SHA256 = "14ea6cbe499bddbc82805fc08a0ec665fde4dcf7e696f21e6f08dcfbfd205fc2";
const PATCHED_SHA256 = "79115afc1caec9596f614592c8094c8317e99cf60cd7d777b96d7de2c80b6246";
const normalize = (value) => value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const digest = (value) => crypto.createHash("sha256").update(normalize(value)).digest("hex");
const testCommand = "node scripts/testGreaterAngliaAddressVerification.js";

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error("The executor did not contain the expected unique patch boundary.");
  return source.replace(anchor, replacement);
}

function patch(source) {
  source = replaceOnce(source, 'import { mkdir } from "node:fs/promises";\n',
    'import { mkdir } from "node:fs/promises";\n' +
    'import { selectAndVerifyGreaterAngliaAddress, verifyGreaterAngliaReviewAddress } from "./greaterAngliaAddressVerification.js";\n');
  const start = source.indexOf("async function clickPostcodeLookupIfVisible(");
  const end = source.indexOf("async function throwIfStillOnPersonalDetailsWithErrors(", start);
  if (start < 0 || end < start) throw new Error("The expected address-selection section was not found.");
  const wrappers = `async function selectGreaterAngliaAddress(page, runContext, passenger) {
  try {
    const proof = await selectAndVerifyGreaterAngliaAddress(page, passenger);
    // Kept in memory for the final review guard; audit redaction covers this key.
    runContext.addressVerificationProof = proof;
    addStep(runContext, "Select postcode address", {
      ok: true, method: proof.method, lineMatched: proof.lineMatched,
      postalMatched: proof.postalMatched, postalSource: proof.postalSource,
    });
    return true;
  } catch (error) {
    addStep(runContext, "Select postcode address", {
      ok: false, code: error.code || "address_selection_failed", ...error.diagnostic,
    });
    throw createPortalBlocker(runContext, error.message, {
      code: error.code || "address_selection_failed", diagnostic: error.diagnostic,
    });
  }
}

async function verifyFinalReviewAddress(page, runContext, plan) {
  try {
    const result = await verifyGreaterAngliaReviewAddress(
      page, plan.passengerStep || {}, runContext.addressVerificationProof
    );
    addStep(runContext, "Verify final review address", result);
    runContext.diagnostic = { ...runContext.diagnostic, postalValidation: result };
    return result;
  } catch (error) {
    addStep(runContext, "Verify final review address", {
      ok: false, code: error.code || "final_review_address_mismatch", ...error.diagnostic,
    });
    throw createPortalBlocker(runContext, error.message, {
      code: error.code || "final_review_address_mismatch", diagnostic: error.diagnostic,
    });
  }
}

`;
  source = source.slice(0, start) + wrappers + source.slice(end);
  source = replaceOnce(source,
    '  if (!finalSubmitEnabled) {\n    // The current Greater Anglia page',
    '  await verifyFinalReviewAddress(page, runContext, plan);\n\n' +
    '  if (!finalSubmitEnabled) {\n    // The current Greater Anglia page');
  source = replaceOnce(source, '    await clickFinalSubmitSafely(page, runContext);',
    '    // Recheck after declarations and any portal re-render, immediately before submission.\n' +
    '    await verifyFinalReviewAddress(page, runContext, portalSubmissionPlan);\n' +
    '    await clickFinalSubmitSafely(page, runContext);');
  return replaceOnce(source, 'executorVersion: "greater-anglia-end-to-end-3.2"',
    'executorVersion: "greater-anglia-end-to-end-3.3-address-verified"');
}

function syntaxCheck(source, label) {
  const check = spawnSync(process.execPath, ["--input-type=module", "--check"],
    { input: source, encoding: "utf8" });
  if (check.status !== 0) throw new Error(`${label} failed syntax validation: ${check.stderr}`);
}

function main() {
  const original = fs.readFileSync(target, "utf8");
  const normalized = normalize(original);
  const currentHash = digest(original);
  if (![ORIGINAL_SHA256, PATCHED_SHA256].includes(currentHash)) {
    throw new Error("This executor differs from the uploaded version. No executor or package changes were made; provide the current executor for a matching patch.");
  }
  const next = currentHash === PATCHED_SHA256 ? normalized : patch(normalized);
  if (digest(next) !== PATCHED_SHA256) throw new Error("The generated patch did not match the verified result.");
  syntaxCheck(next, "Patched executor");
  syntaxCheck(fs.readFileSync(helper, "utf8"), "Address verification module");
  for (const filename of ["testGreaterAngliaAddressVerification.js", "testGreaterAngliaAddressBrowser.js"]) {
    if (!fs.existsSync(path.join(root, "scripts", filename))) throw new Error(`Missing overlay file: ${filename}`);
  }
  const packageOriginal = fs.readFileSync(packagePath, "utf8");
  const pkg = JSON.parse(packageOriginal);
  if (pkg.type !== "module" || !pkg.scripts?.["test:regression"]) {
    throw new Error("Expected the Delai ESM backend with its existing regression command. No source changes made.");
  }
  pkg.scripts["test:ga-address"] = testCommand;
  pkg.scripts["test:ga-address-browser"] = "node scripts/testGreaterAngliaAddressBrowser.js";
  const commands = pkg.scripts["test:regression"].split(/\s*&&\s*/);
  if (!commands.includes(testCommand)) pkg.scripts["test:regression"] += ` && ${testCommand}`;
  const packageChanged = JSON.stringify(JSON.parse(packageOriginal)) !== JSON.stringify(pkg);
  if (currentHash === PATCHED_SHA256 && !packageChanged) {
    console.log("Greater Anglia exact-address verification is already installed. No source changes made.");
    return;
  }
  const backup = path.join(os.tmpdir(), "delai-ga-address-backups", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, "greaterAngliaPlaywrightExecutor.js"), original);
  fs.writeFileSync(path.join(backup, "package.json"), packageOriginal);
  try {
    if (currentHash !== PATCHED_SHA256) fs.writeFileSync(target, original.includes("\r\n") ? next.replace(/\n/g, "\r\n") : next);
    if (packageChanged) fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
  } catch (error) {
    fs.writeFileSync(target, original);
    fs.writeFileSync(packagePath, packageOriginal);
    throw error;
  }
  console.log("Greater Anglia exact-address selection and final-review verification installed.");
  console.log("Existing regression commands and submission gates were preserved.");
  console.log(`Source backups: ${backup}`);
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
