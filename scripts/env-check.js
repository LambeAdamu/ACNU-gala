/* Env readiness check — prints PRESENT/MISSING for required env vars and
 * verifies public/js/cloudinary-config.js carries the real (non-placeholder)
 * values. NEVER prints any value, only names + status.
 * Run: npm run env:check   (or node scripts/env-check.js) */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const REQUIRED = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_UNSIGNED_PRESET",
];

function loadEnv() {
  const envPath = path.join(root, ".env");
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function readConfig() {
  const cfgPath = path.join(root, "public", "js", "cloudinary-config.js");
  if (!fs.existsSync(cfgPath)) return null;
  return fs.readFileSync(cfgPath, "utf8");
}

const env = loadEnv();
const cfg = readConfig();
const placeholder = /YOUR_CLOUD_NAME|YOUR_PRESET_NAME|YOUR_.*NAME|placeholder|PLACEHOLDER|TODO/i;
let failed = false;

for (const name of REQUIRED) {
  const value = env[name];
  let state;
  if (value === undefined || value === "") {
    state = "MISSING";
    failed = true;
  } else if (placeholder.test(value)) {
    state = "PRESENT (placeholder)";
    failed = true;
  } else {
    state = "PRESENT";
  }
  console.log(name.padEnd(28) + state);
}

if (cfg === null) {
  console.log("public/js/cloudinary-config.js".padEnd(28) + "MISSING FILE");
  failed = true;
} else if (placeholder.test(cfg)) {
  console.log("public/js/cloudinary-config.js".padEnd(28) + "PLACEHOLDER VALUES PRESENT");
  failed = true;
} else {
  console.log("public/js/cloudinary-config.js".padEnd(28) + "OK (no placeholders)");
  const cloudNameOk = !env.CLOUDINARY_CLOUD_NAME || cfg.includes("cloudName: \"" + env.CLOUDINARY_CLOUD_NAME + "\"");
  const presetOk = !env.CLOUDINARY_UNSIGNED_PRESET || cfg.includes("unsignedPreset: \"" + env.CLOUDINARY_UNSIGNED_PRESET + "\"");
  console.log("config mirrors .env cloudName".padEnd(28) + (cloudNameOk ? "MATCH" : "MISMATCH"));
  console.log("config mirrors .env preset".padEnd(28) + (presetOk ? "MATCH" : "MISMATCH"));
  if (!cloudNameOk || !presetOk) failed = true;
}

process.exit(failed ? 1 : 0);