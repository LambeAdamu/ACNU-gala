/* DB-backed end-to-end check for the door console.
 * Creates one clearly-marked TEST transaction, exercises the real API handlers
 * with a stubbed Firebase staff lookup, and prints (but does not run) the
 * cleanup SQL. Never prints buyer personal data.
 *
 * Run: node --env-file-if-exists=.env scripts/e2e-checkin.mjs */

import crypto from "node:crypto";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.log("SKIP: DATABASE_URL is not set; DB-backed e2e was not run.");
  process.exit(0);
}

const STAFF_EMAIL = "e2e-door-staff@example.test";
process.env.FIREBASE_WEB_API_KEY = "e2e-stubbed-web-api-key";
process.env.DOOR_STAFF_EMAILS = [process.env.DOOR_STAFF_EMAILS, STAFF_EMAIL]
  .filter(Boolean)
  .join(",");

let lookupEmail = STAFF_EMAIL;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url).includes("identitytoolkit.googleapis.com")) {
    return Response.json({ users: [{ email: lookupEmail }] });
  }
  return realFetch(url, options);
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const reference = "TX-T" + crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 5);

const { runDecision } = await import("../public/api/orders/[id].js");
const ticketEndpoint = (await import("../public/api/tickets/[code].js")).default;
const listEndpoint = (await import("../public/api/tickets/index.js")).default;

const pool = new pg.Pool({ connectionString });
const client = new pg.Client({ connectionString });
let exitCode = 0;

function request(path, method = "GET", withToken = true) {
  const headers = withToken ? { authorization: "Bearer e2e-token" } : {};
  return new Request("https://e2e.local" + path, { method, headers });
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

try {
  await client.connect();

  await client.query(
    `INSERT INTO transactions
       (id, name, email, tel, tickets, qty, tier, participants, amount, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')`,
    [
      reference,
      "E2E Test",
      "e2e-checkin@example.test",
      "+237600000000",
      JSON.stringify([{ tier: "classic", qty: 2 }]),
      2,
      "classic",
      JSON.stringify([
        { tier: "classic", name: "E2E Guest A" },
        { tier: "classic", name: "E2E Guest B" },
      ]),
      30000,
    ]
  );

  const approval = await runDecision({
    db: pool,
    id: reference,
    status: "approved",
    decidedBy: "E2E Test",
    decidedAt: new Date().toISOString(),
    sendApprovalEmail: async () => {},
  });
  assert(approval.ok, "order approval failed");

  const { rows } = await client.query(
    "SELECT code, status, used_at, used_by FROM tickets WHERE transaction_id = $1 ORDER BY participant_index",
    [reference]
  );
  assert(rows.length === 2, "expected two issued tickets");
  assert(rows.every((row) => row.status === "valid"), "new tickets are not valid");
  const [first, second] = rows;

  const unauth = await ticketEndpoint.fetch(request("/api/tickets/" + first.code, "GET", false));
  assert(unauth.status === 401, "unauthenticated GET was not rejected");

  const outsider = await ticketEndpoint.fetch(request("/api/tickets/" + first.code));
  assert(outsider.status === 200, "staff GET failed");

  lookupEmail = "outsider@example.test";
  const forbidden = await ticketEndpoint.fetch(request("/api/tickets/" + first.code));
  assert(forbidden.status === 403, "non-staff GET was not rejected");
  lookupEmail = STAFF_EMAIL;

  const missingGet = await ticketEndpoint.fetch(request("/api/tickets/ZZZZZZZZZZZZZZZZ"));
  assert(missingGet.status === 404, "unknown ticket GET did not return 404");
  const missingPost = await ticketEndpoint.fetch(request("/api/tickets/ZZZZZZZZZZZZZZZZ", "POST"));
  assert(missingPost.status === 404, "unknown ticket POST did not return 404");
  console.log("e2e GET/POST unknown 404: ok");

  const validView = await readJson(await ticketEndpoint.fetch(request("/api/tickets/" + first.code)));
  assert(validView.ok && validView.ticket.status === "valid", "GET valid ticket failed");
  assert(validView.ticket.email === undefined, "staff GET leaked buyer e-mail");
  assert(validView.ticket.transactionId === undefined, "staff GET leaked transaction reference");
  console.log("e2e GET valid ticket: ok");

  const checkIn = await ticketEndpoint.fetch(request("/api/tickets/" + first.code, "POST"));
  const checkInBody = await readJson(checkIn);
  assert(checkIn.status === 200 && checkInBody.ticket.status === "used", "first check-in failed");
  assert(checkInBody.ticket.usedBy === STAFF_EMAIL, "used_by is not the calling staff member");
  const firstUsedAt = checkInBody.ticket.usedAt;
  assert(firstUsedAt, "used_at was not set");
  console.log("e2e POST check-in 200: ok");

  const duplicate = await ticketEndpoint.fetch(request("/api/tickets/" + first.code, "POST"));
  const duplicateBody = await readJson(duplicate);
  assert(duplicate.status === 409, "duplicate check-in did not return 409");
  assert(duplicateBody.reason === "ticket_already_used", "409 reason missing");
  assert(duplicateBody.ticket.usedAt && duplicateBody.ticket.usedBy, "409 did not include used_at/used_by");
  console.log("e2e POST duplicate 409 with used_at/used_by: ok");

  const unapprove = await runDecision({
    db: pool,
    id: reference,
    status: "rejected",
    decidedBy: "E2E Test",
    decidedAt: new Date().toISOString(),
    sendApprovalEmail: async () => {},
  });
  assert(unapprove.ok, "order un-approval failed");

  const revokedUsed = await readJson(await ticketEndpoint.fetch(request("/api/tickets/" + first.code)));
  assert(revokedUsed.ticket.status === "revoked", "used ticket was not revoked");
  assert(revokedUsed.ticket.usedAt === firstUsedAt, "used_at was lost on revoke");
  const revokedValid = await readJson(await ticketEndpoint.fetch(request("/api/tickets/" + second.code)));
  assert(revokedValid.ticket.status === "revoked", "valid ticket was not revoked");
  console.log("e2e un-approve revokes every ticket: ok");

  const revokedPost = await ticketEndpoint.fetch(request("/api/tickets/" + second.code, "POST"));
  const revokedPostBody = await readJson(revokedPost);
  assert(revokedPost.status === 410, "revoked check-in did not return 410");
  assert(revokedPostBody.reason === "ticket_revoked", "410 reason missing");
  console.log("e2e POST revoked 410: ok");

  const reapprove = await runDecision({
    db: pool,
    id: reference,
    status: "approved",
    decidedBy: "E2E Test",
    decidedAt: new Date().toISOString(),
    sendApprovalEmail: async () => {},
  });
  assert(reapprove.ok, "order re-approval failed");

  const reactivatedUsed = await readJson(await ticketEndpoint.fetch(request("/api/tickets/" + first.code)));
  const reactivatedValid = await readJson(await ticketEndpoint.fetch(request("/api/tickets/" + second.code)));
  assert(reactivatedUsed.ticket.status === "used", "used ticket lost used state after re-approval");
  assert(reactivatedUsed.ticket.usedAt === firstUsedAt, "used_at changed after re-approval");
  assert(reactivatedUsed.ticket.usedBy === STAFF_EMAIL, "used_by changed after re-approval");
  assert(reactivatedValid.ticket.status === "valid", "unused ticket did not return to valid");
  console.log("e2e used -> revoked -> reapproved stays used: ok");

  const all = await readJson(await listEndpoint.fetch(request("/api/tickets?transaction=" + reference)));
  assert(all.ok && all.count === 2, "filtered list did not return both tickets");
  assert(all.summary && all.summary.total >= 2, "summary counts missing");
  const present = await readJson(
    await listEndpoint.fetch(request("/api/tickets?transaction=" + reference + "&status=used"))
  );
  assert(present.count === 1 && present.data[0].code === first.code, "status=used filter failed");
  const absent = await readJson(
    await listEndpoint.fetch(request("/api/tickets?transaction=" + reference + "&status=valid"))
  );
  assert(absent.count === 1 && absent.data[0].code === second.code, "status=valid filter failed");
  const tier = await readJson(
    await listEndpoint.fetch(request("/api/tickets?transaction=" + reference + "&tier=classic"))
  );
  assert(tier.count === 2, "tier filter failed");
  console.log("e2e list + status/tier filters + summary: ok");

  console.log("e2e reference: " + reference);
} catch (error) {
  exitCode = 1;
  console.log("e2e failed code=" + ((error && error.code) || "unknown") + " message=" + ((error && error.message) || "unknown"));
} finally {
  console.log("cleanup SQL (not run): DELETE FROM public.transactions WHERE id = '" + reference + "';");
  await client.end().catch(() => {});
  await pool.end().catch(() => {});
  globalThis.fetch = realFetch;
}

process.exit(exitCode);
