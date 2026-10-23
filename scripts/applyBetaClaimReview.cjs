const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const config = {
  "project": "delai-backend",
  "guards": [
    {
      "target": "src/operators/submissionApprovalService.js",
      "hash": "b6b90a05ba9bc26b95b6cc0982b23815bade50bb12a5382676505fe8bfc5cad7"
    },
    {
      "target": "src/operators/greaterAngliaPlaywrightExecutor.js",
      "contains": "greater-anglia-end-to-end-3.4-address-picker"
    },
    {
      "target": "src/operators/claimSubmissionContext.js"
    },
    {
      "target": "src/operators/submissionValidation.js"
    },
    {
      "target": "src/operators/greaterAngliaRequiredInputs.js"
    },
    {
      "target": "src/claims/claimDeadlinePolicy.js"
    },
    {
      "target": "src/payments/feePolicy.js"
    },
    {
      "target": "src/delays/journeyDisruptionRouting.js"
    }
  ],
  "files": [
    {
      "target": "src/server.js",
      "payload": "patches/beta-claim-review/server.js",
      "before": "f52531de9816cf1695daaac55aab42afc68da8da604aaeed5a21d329921d1568",
      "after": "e3a522aaeeddac4ba14c49b61890aa1b96c9e161cc73b9f6e4844ac61e1e4e60"
    },
    {
      "target": "package.json",
      "payload": "patches/beta-claim-review/package.json",
      "before": "2c13c7885eacb71dc12207a8f301cf849bd81e243460b2513d9be6d7eb5d489b",
      "after": "b22ff01a9d63559852defb71afb680b620d1d607a185157bd2064908b22bdba5"
    },
    {
      "target": "package-lock.json",
      "payload": "patches/beta-claim-review/package-lock.json",
      "before": "585908a3909373d75351f0a16422df8ed4ccb927bb042e35dacae6f7d4fe5d7d",
      "after": "b99c6a33ef9c541951732a64b2962e4f46c71f06f56ad3f5d1569fed3d225310"
    },
    {
      "target": "src/operators/submissionSnapshot.js",
      "payload": "patches/beta-claim-review/submissionSnapshot.js",
      "before": null,
      "after": "3eae464c4901adfe34df1f9ac6dc5b1ce1a5a9ca88400e18e7bc75c62f0b2096"
    },
    {
      "target": "src/operators/claimFinalReview.js",
      "payload": "patches/beta-claim-review/claimFinalReview.js",
      "before": null,
      "after": "1c5d1610b93d895e7880c7b04e376aac5d169b982cc872145c6d9574bdb56090"
    },
    {
      "target": "scripts/testBetaClaimReview.js",
      "payload": "patches/beta-claim-review/testBetaClaimReview.js",
      "before": null,
      "after": "7652b61d2b736e8e83e68c2056254f7b18b12a30cfda58d3b39b463679af4c93",
      "previous": [
        "5808cd376e7a973dd73aa0a45aae71e0e13c3368ca92d0afa990eb1fceb617b9"
      ]
    }
  ]
};
const root = process.cwd();
const hash = (bytes) => crypto.createHash("sha256").update(bytes.toString("utf8").replace(/\r\n/g, "\n")).digest("hex");
function fail(message) {
  console.error(`Claim review update not applied: ${message}`);
  process.exit(1);
}
const packageFile = path.join(root, "package.json");
if (!fs.existsSync(packageFile)) fail(`Run this from your ${config.project} folder after extracting the full overlay.`);
let pkg;
try { pkg = JSON.parse(fs.readFileSync(packageFile, "utf8")); }
catch { fail("package.json could not be read."); }
if (pkg.name !== config.project) fail(`This overlay belongs in ${config.project}.`);
for (const guard of config.guards) {
  const filename = path.join(root, guard.target);
  if (!fs.existsSync(filename) || !fs.lstatSync(filename).isFile()) fail(`Missing required current file ${guard.target}.`);
  if (guard.hash && hash(fs.readFileSync(filename)) !== guard.hash) fail(`${guard.target} differs from the supplied version. No runtime files were changed.`);
  if (guard.contains && !fs.readFileSync(filename, "utf8").includes(guard.contains)) fail(`The current ${guard.target} does not match the expected release. No runtime files were changed.`);
}

// Verify every payload and target before making any runtime change. Line-ending
// normalization allows the exact same source on Windows and Linux.
const changes = [];
for (const item of config.files) {
  const target = path.join(root, item.target);
  const payload = path.join(root, item.payload);
  if (!fs.existsSync(payload) || !fs.lstatSync(payload).isFile()) fail(`Missing ${item.payload}. Extract the full overlay.`);
  const replacement = fs.readFileSync(payload);
  if (hash(replacement) !== item.after) fail(`Payload ${item.payload} is modified or incomplete. Download the ZIP again.`);
  if (item.payload.endsWith(".js")) {
    const check = spawnSync(process.execPath, ["--check", payload], { encoding: "utf8" });
    if (check.status !== 0) fail(`Syntax check failed for ${item.payload}. ${check.stderr || check.error || ""}`);
  }
  if (item.payload.endsWith(".json")) {
    try { JSON.parse(replacement.toString("utf8")); }
    catch { fail(`JSON check failed for ${item.payload}.`); }
  }
  if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) fail(`${item.target} is not a regular file.`);
  const original = fs.existsSync(target) ? fs.readFileSync(target) : null;
  const current = original === null ? null : hash(original);
  if (current === item.after) continue;
  if (![item.before, ...(item.previous || [])].includes(current)) fail(`${item.target} differs from the supplied version. No runtime files were changed. Attach that current file so the update can be adapted.`);
  const baseline = original || fs.readFileSync(path.join(root, config.files[0].target));
  const useCRLF = baseline.includes(Buffer.from("\r\n"));
  const text = replacement.toString("utf8").replace(/\r\n/g, "\n");
  changes.push({ relativeTarget: item.target, target, original, replacement: Buffer.from(useCRLF ? text.replace(/\n/g, "\r\n") : text) });
}
if (changes.length === 0) {
  console.log("Claim review update is already installed. No source changes made.");
  process.exit(0);
}
if (process.argv.includes("--check")) {
  console.log(`Claim review overlay is compatible (${changes.length} files). No source changes made.`);
  process.exit(0);
}

let backup;
try {
  backup = fs.mkdtempSync(path.join(os.tmpdir(), `delai-${config.project}-review-`));
  for (const item of changes) {
    if (item.original !== null) {
      const filename = path.join(backup, item.relativeTarget);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, item.original);
    }
  }
} catch (error) { fail(`A backup could not be created. No runtime files were changed. ${error.message}`); }
const written = [];
try {
  for (const item of changes) {
    fs.mkdirSync(path.dirname(item.target), { recursive: true });
    written.push(item);
    fs.writeFileSync(item.target, item.replacement);
  }
} catch (error) {
  let rollbackFailed = false;
  for (const item of written.reverse()) {
    try {
      if (item.original !== null) fs.writeFileSync(item.target, item.original);
      else if (fs.existsSync(item.target)) fs.unlinkSync(item.target);
    } catch { rollbackFailed = true; }
  }
  fail(rollbackFailed ? `Writing failed. Restore the source backup at ${backup}. ${error.message}` : `Writing failed and runtime files were restored. ${error.message}`);
}
console.log("Customer claim review and approval update installed.");
console.log("Existing submission and payment configuration was preserved.");
console.log(`Source backups: ${backup}`);
