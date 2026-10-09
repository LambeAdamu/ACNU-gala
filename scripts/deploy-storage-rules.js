/*
 * deploy-storage-rules.js — deploy storage.rules to Firebase Storage using the
 * Firebase Admin SDK Security Rules API (no interactive firebase login needed).
 *
 * REQUIREMENTS:
 *   - Node.js installed.
 *   - `npm install` run in this folder (installs firebase-admin).
 *   - A Firebase service-account key file at ../service-account.json (project
 *     root, already git-ignored — keep it secret, NEVER deploy or commit it).
 *
 * USAGE:
 *   node deploy-storage-rules.js
 *
 * What it does:
 *   1. Prints the CURRENTLY DEPLOYED storage ruleset (diagnostic).
 *   2. Reads ../storage.rules, creates a ruleset from it, and releases it.
 *   3. Re-reads the deployed ruleset to confirm the update.
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const serviceAccount = require(path.join(__dirname, "..", "service-account.json"));

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const rulesSource = fs.readFileSync(path.join(__dirname, "..", "storage.rules"), "utf8");

// New default Storage bucket domain (firebasestorage.app). If this reports a
// not-found, re-run with the legacy <project-id>.appspot.com name instead.
const BUCKET = process.env.STORAGE_BUCKET || "application-du-parlement.firebasestorage.app";

async function main() {
  const rules = admin.securityRules();

  console.log("=== Currently deployed STORAGE rules (bucket " + BUCKET + ") ===");
  try {
    const current = await rules.getStorageRuleset(BUCKET);
    console.log(current.source);
    console.log("(ruleset name: " + current.name + ")");
  } catch (e) {
    console.log("Could not read current storage ruleset:", e.message);
  }

  console.log("\n=== Deploying new storage rules (../storage.rules) ===");
  const created = await rules.createRuleset(rules.createRulesFileFromSource("storage.rules", rulesSource));
  console.log("Created ruleset:", created.name);
  await rules.releaseStorageRuleset(created, BUCKET);
  console.log("Released storage ruleset on bucket:", BUCKET);

  console.log("\n=== Confirming deployed STORAGE rules ===");
  const after = await rules.getStorageRuleset(BUCKET);
  console.log(after.source);
  console.log("(ruleset name: " + after.name + ")");
  console.log("\nDeploy complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Deploy failed:", err.message);
  process.exit(1);
});