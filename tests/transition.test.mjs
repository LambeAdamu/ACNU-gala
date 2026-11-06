import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(
  path.resolve("public/api/orders/[id].js")
).href;
const { runDecision } = await import(moduleUrl);

function createStubDb(initialRows) {
  const rows = new Map(initialRows.map((row) => [row.id, { ...row }]));
  const client = {
    async query(sql, params = []) {
      const text = String(sql).trim();
      if (/^BEGIN/i.test(text)) return { rows: [] };
      if (/^COMMIT/i.test(text)) return { rows: [] };
      if (/^ROLLBACK/i.test(text)) return { rows: [] };
      if (/FOR UPDATE/i.test(text)) {
        const row = rows.get(params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (/^UPDATE transactions/i.test(text)) {
        const row = rows.get(params[0]);
        if (!row) return { rows: [] };
        row.status = params[1];
        row.decided_by = params[2];
        row.decided_at = params[3];
        return { rows: [{ ...row }] };
      }
      throw new Error("unexpected query");
    },
    release() {},
  };
  return { connect: async () => client, rows };
}

function baseRow(overrides = {}) {
  return {
    id: "TX-ABC123",
    status: "pending",
    name: "Test Buyer",
    email: "buyer@example.com",
    tel: "+237600000000",
    tickets: [{ tier: "classic", qty: 1 }],
    qty: 1,
    tier: "classic",
    participants: [{ tier: "classic", name: "Test Buyer" }],
    amount: 15000,
    pay_method: "momomo",
    ref: "Mobile Money (MoMo) 672691175",
    created_at: "2026-11-10T13:32:00.000Z",
    ...overrides,
  };
}

function decisionArgs(id, status, decidedAt = "2026-11-10T14:00:00.000Z") {
  return { id, status, decidedBy: "Admin Test", decidedAt };
}

test("approving twice issues tickets and sends one email", async () => {
  const db = createStubDb([baseRow()]);
  const sent = [];
  const issued = [];
  const revoked = [];
  const deps = {
    db,
    sendApprovalEmail: async (order) => {
      sent.push(order);
    },
    issueTickets: async (client, order) => {
      issued.push(order.id);
      return { ok: true, tickets: [] };
    },
    revokeTickets: async (client, id) => {
      revoked.push(id);
      return { revoked: 0 };
    },
  };

  const first = await runDecision({
    ...deps,
    ...decisionArgs("TX-ABC123", "approved"),
  });
  const second = await runDecision({
    ...deps,
    ...decisionArgs("TX-ABC123", "approved", "2026-11-10T14:01:00.000Z"),
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(issued, ["TX-ABC123"]);
  assert.deepEqual(revoked, []);
  assert.equal(sent.length, 1);
  assert.equal(db.rows.get("TX-ABC123").status, "approved");
});

test("pending -> approved -> pending -> approved reissues tickets and sends two emails", async () => {
  const db = createStubDb([baseRow()]);
  const sent = [];
  const issued = [];
  const revoked = [];
  const deps = {
    db,
    sendApprovalEmail: async (order) => {
      sent.push(order);
    },
    issueTickets: async (client, order) => {
      issued.push(order.id);
      return { ok: true, tickets: [] };
    },
    revokeTickets: async (client, id) => {
      revoked.push(id);
      return { revoked: 0 };
    },
  };

  await runDecision({ ...deps, ...decisionArgs("TX-ABC123", "approved") });
  await runDecision({ ...deps, ...decisionArgs("TX-ABC123", "pending") });
  await runDecision({ ...deps, ...decisionArgs("TX-ABC123", "approved") });

  assert.equal(sent.length, 2);
  assert.deepEqual(issued, ["TX-ABC123", "TX-ABC123"]);
  assert.deepEqual(revoked, ["TX-ABC123"]);
});

test("rejected status sends no thank-you email", async () => {
  const db = createStubDb([baseRow()]);
  const sent = [];
  const result = await runDecision({
    db,
    id: "TX-ABC123",
    status: "rejected",
    decidedBy: "Admin Test",
    decidedAt: "2026-11-10T14:00:00.000Z",
    sendApprovalEmail: async (order) => {
      sent.push(order);
    },
    issueTickets: async () => {
      throw new Error("issueTickets must not be called");
    },
    revokeTickets: async () => {
      throw new Error("revokeTickets must not be called");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(sent.length, 0);
});

test("unknown reference returns notFound", async () => {
  const db = createStubDb([]);
  const result = await runDecision({
    db,
    id: "TX-ZZZ999",
    status: "approved",
    decidedBy: "Admin Test",
    decidedAt: "2026-11-10T14:00:00.000Z",
    sendApprovalEmail: async () => {},
    issueTickets: async () => {
      throw new Error("issueTickets must not be called");
    },
  });
  assert.equal(result.notFound, true);
});
