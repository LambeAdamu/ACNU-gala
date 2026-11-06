import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const out = (line) => process.stdout.write(line + "\n");

const mailUser = process.env.MAIL_USER;
const mailPass = process.env.MAIL_APP_PASSWORD;
if (!mailUser || !mailPass) {
  out("not run: MAIL_USER and/or MAIL_APP_PASSWORD missing");
  process.exit(0);
}

process.env.ADMIN_NOTIFY_EMAIL = mailUser;
process.env.SITE_URL = process.env.SITE_URL || "https://acnu-gala.vercel.app";

const requireFromPublic = createRequire(
  pathToFileURL(path.resolve("public/api/orders.js"))
);
const pg = requireFromPublic("pg");
const { Pool } = pg;

const { default: ordersHandler } = await import(
  pathToFileURL(path.resolve("public/api/orders.js")).href
);
const { runDecision } = await import(
  pathToFileURL(path.resolve("public/api/orders/[id].js")).href
);

function newReference() {
  return "TX-" + crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
}

const reference = newReference();
const buyerName = "TEST-MAIL-" + Date.now();
const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "";
const proofUrl = cloudName
  ? `https://res.cloudinary.com/${cloudName}/image/upload/e2e-test.png`
  : "https://res.cloudinary.com/test/image/upload/e2e-test.png";
const now = new Date().toISOString();

const payload = {
  id: reference,
  buyerKey: (mailUser.toLowerCase() + "|" + now).toLowerCase(),
  name: buyerName,
  buyerName,
  email: mailUser,
  tel: "+237600000000",
  tickets: [{ tier: "classic", qty: 1 }],
  qty: 1,
  tier: "classic",
  participants: [{ tier: "classic", name: "Test Mail" }],
  amount: 15000,
  payMethod: "momomo",
  payNum: "672691175",
  payDate: now.slice(0, 10),
  ref: "E2E TEST",
  proof: "e2e-test.png",
  proofSize: 1,
  proofUrl,
  proofPublicId: "",
  status: "pending",
  decidedBy: "",
  decidedAt: null,
  createdAt: now,
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const results = { admin: "not run", confirmation: "not run", buyer: "not run" };
const original = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

function capture(args) {
  const line = args.map((value) => String(value)).join(" ");
  if (!line.includes(reference)) return;
  for (const type of ["admin", "confirmation", "buyer"]) {
    if (!line.includes(`mail ${type}`) && !line.includes(`mail dry-run type=${type}`)) {
      continue;
    }
    if (/\bok\b/.test(line)) results[type] = "ok";
    else if (/skipped/.test(line)) results[type] = "skipped";
    else if (/failed/.test(line)) results[type] = "failed";
  }
}

let createOk = false;
let createError = "";
let approveOk = false;
let resetOk = false;
let throttleCount = null;

try {
  console.log = (...args) => capture(args);
  console.warn = (...args) => capture(args);
  console.error = (...args) => capture(args);

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM transactions
      WHERE lower(email) = lower($1)
        AND created_at >= now() - interval '10 minutes'`,
    [mailUser]
  );
  throttleCount = rows[0] ? rows[0].count : 0;

  if (throttleCount > 5) {
    out("not run: admin email would be throttled (more than 5 recent orders for MAIL_USER)");
  } else {
    const request = new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const response = await ordersHandler.fetch(request);
    const data = await response.json().catch(() => ({}));
    createOk = response.ok && data.ok === true;
    if (!createOk) createError = data.error || "HTTP " + response.status;

    if (createOk) {
      const approve = await runDecision({
        db: pool,
        id: reference,
        status: "approved",
        decidedBy: "E2E TEST",
        decidedAt: new Date().toISOString(),
      });
      approveOk = Boolean(approve.ok);

      const reset = await runDecision({
        db: pool,
        id: reference,
        status: "pending",
        decidedBy: "E2E TEST",
        decidedAt: new Date().toISOString(),
      });
      resetOk = Boolean(reset.ok);
    }
  }
} catch (error) {
  createError = error && error.code ? error.code : "unexpected";
} finally {
  console.log = original.log;
  console.warn = original.warn;
  console.error = original.error;
  await pool.end().catch(() => {});
}

out(`create ref=${reference}: ${createOk ? "ok" : "failed" + (createError ? " (" + createError + ")" : "")}`);
out(`admin email: ${results.admin}`);
out(`order confirmation email: ${results.confirmation}`);
out(`buyer approval email: ${results.buyer}`);
out(`approve: ${approveOk ? "ok" : "not run/failed"}`);
out(`reset to pending: ${resetOk ? "ok" : "not run/failed"}`);
out(`DELETE FROM transactions WHERE id = '${reference}';`);

process.exit(0);
