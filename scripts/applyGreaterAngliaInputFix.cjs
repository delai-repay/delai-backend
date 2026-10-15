const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const checkOnly = process.argv.includes("--check");
const changes = [];
const notices = [];

function fail(message) {
  console.error(`Greater Anglia input fix not applied: ${message}`);
  process.exit(1);
}

function editFile(relative, edit) {
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename)) fail(`Missing ${relative}. Use your Delai backend folder.`);
  const original = fs.readFileSync(filename, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  let source = original.replace(/\r\n/g, "\n");
  const replace = (before, after, label) => {
    if (source.split(before).length - 1 !== 1) {
      fail(`Could not uniquely locate ${label} in ${relative}. No project files were changed.`);
    }
    source = source.replace(before, after);
  };
  edit({ replace, read: () => source });
  const updated = source.replace(/\n/g, eol);
  if (updated !== original) changes.push({ relative, filename, original, updated });
}

for (const file of ["src/operators/greaterAngliaRequiredInputs.js", "scripts/testGreaterAngliaRequiredInputs.js"]) {
  if (!fs.existsSync(path.join(root, file))) fail(`Missing ${file}. Extract the complete overlay first.`);
}

const packagePath = path.join(root, "package.json");
if (!fs.existsSync(packagePath)) fail("Backend package.json was not found.");
const originalPackage = fs.readFileSync(packagePath, "utf8");
let pkg;
try { pkg = JSON.parse(originalPackage); } catch { fail("package.json could not be read."); }
if (pkg.name !== "delai-backend") fail("This update belongs in delai-backend, not delai-site.");
if (typeof pkg.scripts?.["test:regression"] !== "string") fail("The current regression script could not be found.");

editFile("src/operators/greaterAngliaOperatorAdapter.js", ({ replace, read }) => {
  const insertion = '      passenger: {\n        title: cleanText(passenger.title) || cleanText(passenger.salutation),';
  if (read().includes(insertion)) return;
  replace(
    "      passenger: {\n        fullName: cleanText(passenger.fullName),",
    insertion + '\n        salutation: cleanText(passenger.salutation) || cleanText(passenger.title),\n        fullName: cleanText(passenger.fullName),',
    "the Greater Anglia passenger mapping",
  );
});

editFile("src/operators/submissionValidation.js", ({ replace, read }) => {
  const importLine = 'import { getGreaterAngliaRequiredInputIssues } from "./greaterAngliaRequiredInputs.js";';
  const marker = "  // Greater Anglia readiness must agree with the portal executor.";
  if (read().includes(importLine) && read().includes(marker)) return;
  if (read().includes(importLine) || read().includes(marker)) fail("A partial validation update was found.");
  replace("function cleanText(value) {", importLine + "\n\nfunction cleanText(value) {", "the validator import");
  const block = [
    marker,
    "  for (const issue of getGreaterAngliaRequiredInputIssues(submissionContext)) {",
    "    const ticketIssueAlreadyReported =",
    '      issue.field === "ticket.reference" &&',
    '      errors.some((existing) => ["ticket.smartcardNumber", "ticket.bookingReference"].includes(existing.field));',
    "    if (!ticketIssueAlreadyReported && !errors.some((existing) => existing.field === issue.field)) {",
    "      errors.push(issue);",
    "    }",
    "  }",
    "  const blockingFields = new Set(errors.map((issue) => issue.field));",
    "  for (let index = warnings.length - 1; index >= 0; index -= 1) {",
    "    if (blockingFields.has(warnings[index].field)) warnings.splice(index, 1);",
    "  }",
    "",
  ].join("\n");
  replace("  return {\n    valid: errors.length === 0,", block + "\n  return {\n    valid: errors.length === 0,", "the final validation result");
});

editFile("src/server.js", ({ replace, read }) => {
  const importLine = 'import { getGreaterAngliaInputLabel } from "./operators/greaterAngliaRequiredInputs.js";';
  const marker = "  const operatorInputLabel = getGreaterAngliaInputLabel(issue);";
  if (read().includes(importLine) && read().includes(marker)) return;
  if (read().includes(importLine) || read().includes(marker)) fail("A partial customer-label update was found.");
  replace(
    'import { validateSubmissionContext } from "./operators/submissionValidation.js";',
    'import { validateSubmissionContext } from "./operators/submissionValidation.js";\n' + importLine,
    "the customer-label import",
  );
  replace(
    "function getCustomerMissingDetailLabel(issue) {\n",
    "function getCustomerMissingDetailLabel(issue) {\n" + marker + "\n  if (operatorInputLabel) return operatorInputLabel;\n\n",
    "the customer missing-field labels",
  );
});

editFile("scripts/testSubmissionValidation.js", ({ replace, read }) => {
  const before = '  passenger: {\n    fullName: "Test Passenger",';
  const after = '  passenger: {\n    title: "Dr",\n    addressLine1: "1 Example Street",\n    postcode: "AA1 1AA",\n    country: "United Kingdom",\n    fullName: "Test Passenger",';
  if (read().includes(after)) return;
  if (!read().includes(before)) {
    notices.push("Kept your existing submission-validation fixture; the new required-input test is installed separately.");
    return;
  }
  replace(before, after, "the valid validation fixture");
});

const testCommand = "node scripts/testGreaterAngliaRequiredInputs.js";
if (pkg.scripts["test:ga-inputs"] !== testCommand || !pkg.scripts["test:regression"].includes(testCommand)) {
  pkg.scripts["test:ga-inputs"] = testCommand;
  if (!pkg.scripts["test:regression"].includes(testCommand)) pkg.scripts["test:regression"] += ` && ${testCommand}`;
  const eol = originalPackage.includes("\r\n") ? "\r\n" : "\n";
  changes.push({ relative: "package.json", filename: packagePath, original: originalPackage, updated: (JSON.stringify(pkg, null, 2) + "\n").replace(/\n/g, eol) });
}

if (!changes.length) {
  console.log("Greater Anglia required-input fix is already installed. No source changes made.");
  process.exit(0);
}
if (checkOnly) {
  console.log(`Greater Anglia input fix is compatible (${changes.length} files). No source changes made.`);
  process.exit(0);
}

const backup = path.join(os.tmpdir(), "delai-ga-input-fix-backups", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(backup, { recursive: true });
const written = [];
try {
  for (const item of changes) {
    const backupPath = path.join(backup, item.relative);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, item.original, "utf8");
    const temporary = `${item.filename}.ga-input-fix-tmp`;
    fs.writeFileSync(temporary, item.updated, "utf8");
    fs.renameSync(temporary, item.filename);
    written.push(item);
  }
} catch (error) {
  for (const item of written.reverse()) fs.writeFileSync(item.filename, item.original, "utf8");
  for (const item of changes) {
    const temporary = `${item.filename}.ga-input-fix-tmp`;
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  fail(`Installation failed and source changes were restored: ${error.message}`);
}

console.log("Greater Anglia title mapping and early required-input validation installed.");
console.log("Existing release regression commands were preserved.");
console.log(`Source backups: ${backup}`);
for (const message of notices) console.log(message);
