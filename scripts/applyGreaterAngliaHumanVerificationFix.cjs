const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const config = {
  "project": "delai-backend",
  "guards": [
    {
      "target": "src/operators/greaterAngliaConfirmationNavigation.js",
      "hash": "6c21d0716bbb7fdbaaf842a93e8e92906123fbfe4922e2cc03e239ee49d28a9f"
    },
    {
      "target": "src/operators/submissionApprovalService.js",
      "hash": "b6b90a05ba9bc26b95b6cc0982b23815bade50bb12a5382676505fe8bfc5cad7"
    },
    {
      "target": "src/operators/submissionSnapshot.js",
      "hash": "3eae464c4901adfe34df1f9ac6dc5b1ce1a5a9ca88400e18e7bc75c62f0b2096"
    },
    {
      "target": "src/operators/claimFinalReview.js",
      "hash": "1c5d1610b93d895e7880c7b04e376aac5d169b982cc872145c6d9574bdb56090"
    },
    {
      "target": "src/operators/greaterAngliaAddressVerification.js",
      "hash": "3b813ccf10e5aaf5196f554628a3bf9301b67ec4e1b65b760d0cd48087b807ed"
    }
  ],
  "files": [
    {
      "target": "src/operators/greaterAngliaPlaywrightExecutor.js",
      "payload": "patches/greater-anglia-human-verification/greaterAngliaPlaywrightExecutor.js",
      "before": "68eb8eca76c4061143d9119b1f22be4df89db09371df7f2b8df70ae00b5324b1",
      "after": "9ea2b2094a2882b976d5a4ed9b380d98383f8f0aa7bbd4a9dee7e119218f52ed"
    },
    {
      "target": "src/server.js",
      "payload": "patches/greater-anglia-human-verification/server.js",
      "before": "e3a522aaeeddac4ba14c49b61890aa1b96c9e161cc73b9f6e4844ac61e1e4e60",
      "after": "67bcc0c54ceb8e81e156b0913acb4412a8b6f64f79209a649dbc74281ebe9e07"
    },
    {
      "target": "scripts/testGreaterAngliaConfirmationNavigation.js",
      "payload": "patches/greater-anglia-human-verification/testGreaterAngliaConfirmationNavigation.js",
      "before": "3c57ba539b727989c58d00def013f397225a3105eae611883efcd12b9d145300",
      "after": "f293cf5ae0b6d4ff1499364ada3309471c051e9326e4f9edec6e71bb3efd7375"
    },
    {
      "target": "scripts/testGreaterAngliaConfirmationBrowser.js",
      "payload": "patches/greater-anglia-human-verification/testGreaterAngliaConfirmationBrowser.js",
      "before": "e63e8795cb265bbe7b119b0ac0ea26194b554e0f79047e8d1420c51ef9a54e1d",
      "after": "55c5b85ed93c101fea4a9aab77defeec6fe7050cda98f3e2bba21ecb000ad6ec"
    },
    {
      "target": "scripts/testGreaterAngliaHumanVerification.js",
      "payload": "patches/greater-anglia-human-verification/testGreaterAngliaHumanVerification.js",
      "before": null,
      "after": "75c04ed253f1ad535fce59fab67a23ad3e6d4a71ab5c92199f6b1bbcd3e3bc17"
    },
    {
      "target": "scripts/testGreaterAngliaHumanVerificationBrowser.js",
      "payload": "patches/greater-anglia-human-verification/testGreaterAngliaHumanVerificationBrowser.js",
      "before": null,
      "after": "76ae3f04ccfab4b5dad531155350ca0813ab8e360ab2675702c542168226707c"
    },
    {
      "target": "package.json",
      "payload": "patches/greater-anglia-human-verification/package.json",
      "before": "2c1c516fc5d4fdfed5d2bfbf83de81bb45249ad753b9d993897065025a9c71ff",
      "after": "fd283ef2cb68fcaa56ab168a8dcd91af281a57ad6a284a9b8286f0ca4f540bc6"
    }
  ]
};
const root = process.cwd();
const hash = (bytes) => crypto.createHash("sha256").update(bytes.toString("utf8").replace(/\r\n/g, "\n")).digest("hex");
function fail(message) {
  console.error(`Human-verification update not applied: ${message}`);
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
  console.log("Human-verification update is already installed. No source changes made.");
  process.exit(0);
}
if (process.argv.includes("--check")) {
  console.log(`Human-verification overlay is compatible (${changes.length} files). No source changes made.`);
  process.exit(0);
}

let backup;
try {
  backup = fs.mkdtempSync(path.join(os.tmpdir(), `delai-${config.project}-human-verification-`));
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
console.log("Greater Anglia human-verification guard and central status messages installed.");
console.log("Existing claim records, approval policy and payment configuration were preserved.");
console.log(`Source backups: ${backup}`);
