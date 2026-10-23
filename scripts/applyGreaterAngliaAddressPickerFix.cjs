const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const assets = path.join(root, "patches/greater-anglia-address-picker");
const normalized = (text) => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const digest = (text) => crypto.createHash("sha256").update(normalized(text)).digest("hex");
const executorPath = "src/operators/greaterAngliaPlaywrightExecutor.js";
const oldVersion = "greater-anglia-end-to-end-3.3-address-verified";
const newVersion = "greater-anglia-end-to-end-3.4-address-picker";
const manifest = [
  {
    "path": "src/operators/greaterAngliaPlaywrightExecutor.js",
    "before": "79115afc1caec9596f614592c8094c8317e99cf60cd7d777b96d7de2c80b6246",
    "after": "79da0071356877eb11d9b12fb1a670f62df8cc678464dd894d81c8c0b8a9a403"
  },
  {
    "path": "src/operators/greaterAngliaAddressVerification.js",
    "before": "1921ce4a034eb979604fb4965866918b01245b0a042af2eb8be3abbe9815365b",
    "after": "3b813ccf10e5aaf5196f554628a3bf9301b67ec4e1b65b760d0cd48087b807ed"
  },
  {
    "path": "scripts/testGreaterAngliaAddressVerification.js",
    "before": "9db77dc13f5b9ff7a6b492d74f029b4d990a489eef834d166545ef1b1ec0105a",
    "after": "99fd7ab65a3dbf52aa7bb27c0f4091d51b694cbd6357a484b8ada48da9ddba39"
  },
  {
    "path": "scripts/testGreaterAngliaAddressBrowser.js",
    "before": "4fd0b7455218ec9a8e986c8408b464595fe80475d91739fdae1c2a5cb6686bf0",
    "after": "66c8976129a4cc93f94415a9abc3ff255e897f51d1eaf953000823fa5ecaf5a2"
  }
];

function syntaxCheck(source, name) {
  const result = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: source, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${name} failed syntax validation: ${result.stderr}`);
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (pkg.type !== "module" || !pkg.scripts?.["test:regression"]?.includes("node scripts/testGreaterAngliaAddressVerification.js")) {
    throw new Error("Install the previously supplied exact-address fix and its regression command first.");
  }
  const planned = manifest.map((item) => {
    const destination = path.join(root, item.path);
    const current = fs.readFileSync(destination, "utf8");
    const currentHash = digest(current);
    if (![item.before, item.after].includes(currentHash)) {
      throw new Error(`Unexpected changes in ${item.path}. No runtime files were changed. Supply this current file for a matching update.`);
    }
    let next;
    if (item.path === executorPath) {
      next = currentHash === item.after ? normalized(current) : normalized(current)
        .replace(`executorVersion: "${oldVersion}"`, `executorVersion: "${newVersion}"`);
    } else {
      next = normalized(fs.readFileSync(path.join(assets, path.basename(item.path)), "utf8"));
    }
    if (digest(next) !== item.after) throw new Error(`Unexpected update payload for ${item.path}. No runtime files were changed.`);
    syntaxCheck(next, item.path);
    return { ...item, destination, current, next, changed: currentHash !== item.after };
  });
  if (!planned.some((item) => item.changed)) {
    console.log("Greater Anglia Tracsis address-picker support is already installed. No runtime changes made.");
    return;
  }
  const backup = path.join(os.tmpdir(), "delai-ga-address-picker-backups", new Date().toISOString().replace(/[:.]/g, "-"));
  for (const item of planned) {
    const backupPath = path.join(backup, item.path);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, item.current);
  }
  try {
    for (const item of planned.filter((entry) => entry.changed)) {
      fs.writeFileSync(item.destination, item.current.includes("\r\n") ? item.next.replace(/\n/g, "\r\n") : item.next);
    }
  } catch (error) {
    for (const item of planned) fs.writeFileSync(item.destination, item.current);
    throw error;
  }
  console.log("Greater Anglia Tracsis address-picker detection and bound-field checks installed.");
  console.log("Existing regression commands, final-review verification, and submission gates were preserved.");
  console.log(`Source backups: ${backup}`);
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
