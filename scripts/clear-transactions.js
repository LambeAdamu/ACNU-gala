/*
 * clear-transactions.js — delete every document in the `transactions` collection
 * so the admin console starts empty. Uses the Firebase Admin SDK (Firestore).
 *
 * REQUIREMENTS:
 *   - Node.js installed.
 *   - `npm install` run in this folder (installs firebase-admin).
 *   - A Firebase service-account key file at ../service-account.json (project
 *     root, already git-ignored — keep it secret, NEVER deploy or commit it).
 *
 * USAGE:
 *   node clear-transactions.js
 *
 * DANGER: permanently deletes all docs in the `transactions` collection.
 */

const path = require("path");
const admin = require("firebase-admin");

const serviceAccount = require(path.join(__dirname, "..", "service-account.json"));

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const col = db.collection("transactions");

async function main() {
  const snap = await col.get();
  const docs = snap.docs;
  if (docs.length === 0) {
    console.log("Collection is already empty — nothing to delete.");
    process.exit(0);
  }

  const byStatus = {};
  for (const d of docs) {
    const s = d.data().status || "unknown";
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  console.log("Found " + docs.length + " transaction(s).");
  console.log("Breakdown:", JSON.stringify(byStatus));

  await Promise.all(docs.map((d) => d.ref.delete()));
  console.log("Deleted " + docs.length + " document(s).");

  const after = await col.get();
  if (after.empty) {
    console.log("Confirmed: `transactions` collection is now empty.");
  } else {
    console.log("WARNING: " + after.size + " document(s) still present.");
  }
  process.exit(after.empty ? 0 : 1);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});