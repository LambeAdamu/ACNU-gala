import test, { after } from "node:test";
import assert from "node:assert/strict";

process.env.ADMIN_EMAILS = "admin@example.test";
process.env.DOOR_STAFF_EMAILS = " staff@example.test , second-staff@example.test ";
process.env.FIREBASE_WEB_API_KEY = "test-web-api-key";

const { isAdmin, isStaff, verifyAdmin, verifyStaff } = await import(
  "../public/api/_lib/admin.js"
);

const realFetch = globalThis.fetch;
let lookupEmail = "";
let lookupOk = true;

globalThis.fetch = async (url) => {
  const target = String(url);
  if (!target.includes("identitytoolkit.googleapis.com")) {
    throw new Error("unexpected network call in auth test");
  }
  if (!lookupOk) return new Response("{}", { status: 400 });
  return Response.json({ users: lookupEmail ? [{ email: lookupEmail }] : [] });
};

after(() => {
  globalThis.fetch = realFetch;
});

function request(token) {
  const headers = token ? { authorization: "Bearer " + token } : {};
  return new Request("https://example.test/api/tickets/ABCDEFGHJKMNPQRS", { headers });
}

test("isAdmin only accepts ADMIN_EMAILS", () => {
  assert.equal(isAdmin("admin@example.test"), true);
  assert.equal(isAdmin("ADMIN@example.test"), true);
  assert.equal(isAdmin("staff@example.test"), false);
  assert.equal(isAdmin("outsider@example.test"), false);
});

test("isStaff accepts admin, door staff, trims and ignores case", () => {
  assert.equal(isStaff("admin@example.test"), true);
  assert.equal(isStaff("  STAFF@Example.Test "), true);
  assert.equal(isStaff("second-staff@example.test"), true);
  assert.equal(isStaff("outsider@example.test"), false);
  assert.equal(isStaff(""), false);
});

test("verifyAdmin accepts admin tokens only", async () => {
  lookupOk = true;
  lookupEmail = "admin@example.test";
  assert.equal((await verifyAdmin(request("admin-token"))).email, "admin@example.test");

  lookupEmail = "staff@example.test";
  const staff = await verifyAdmin(request("staff-token"));
  assert.equal(staff.error, "Accès refusé.");
  assert.equal(staff.status, 403);

  lookupEmail = "outsider@example.test";
  const outsider = await verifyAdmin(request("outsider-token"));
  assert.equal(outsider.status, 403);
});

test("verifyStaff accepts admin and door staff tokens", async () => {
  lookupOk = true;

  lookupEmail = "admin@example.test";
  assert.equal((await verifyStaff(request("admin-token"))).email, "admin@example.test");

  lookupEmail = "staff@example.test";
  assert.equal((await verifyStaff(request("staff-token"))).email, "staff@example.test");

  lookupEmail = "outsider@example.test";
  const outsider = await verifyStaff(request("outsider-token"));
  assert.equal(outsider.error, "Accès refusé.");
  assert.equal(outsider.status, 403);
});

test("auth rejects missing, invalid tokens and missing server key", async () => {
  lookupOk = true;
  lookupEmail = "staff@example.test";

  assert.equal((await verifyStaff(request(""))).status, 401);

  lookupOk = false;
  assert.equal((await verifyStaff(request("bad-token"))).status, 401);

  lookupOk = true;
  const saved = process.env.FIREBASE_WEB_API_KEY;
  delete process.env.FIREBASE_WEB_API_KEY;
  try {
    assert.equal((await verifyStaff(request("token"))).status, 500);
  } finally {
    process.env.FIREBASE_WEB_API_KEY = saved;
  }
});
