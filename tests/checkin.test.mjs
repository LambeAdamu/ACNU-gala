import test from "node:test";
import assert from "node:assert/strict";
import {
  checkInTicket,
  issueTicketsForOrder,
  revokeTicketsForOrder,
  toStaffTicket,
} from "../public/api/_lib/tickets.js";

const COLUMNS = "code, transaction_id, tier, participant_name, participant_index, status, issued_at, used_at, used_by";

function createDb(initial = []) {
  const rows = initial.map((row) => ({ ...row }));
  let sequence = 0;
  const now = () => "2027-02-06T20:00:00.000Z";

  return {
    rows,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();

      if (/^UPDATE tickets SET status = 'used'/i.test(text)) {
        const row = rows.find((item) => item.code === params[0]);
        if (!row || row.status !== "valid") return { rows: [] };
        row.status = "used";
        row.used_at = now();
        row.used_by = params[1];
        return { rows: [{ ...row }] };
      }

      if (/^UPDATE tickets SET status = 'revoked'/i.test(text)) {
        const changed = rows.filter(
          (row) =>
            row.transaction_id === params[0] &&
            (row.status === "valid" || row.status === "used")
        );
        changed.forEach((row) => { row.status = "revoked"; });
        return { rows: changed.map((row) => ({ ...row })) };
      }

      if (/SET status = CASE WHEN used_at IS NOT NULL/i.test(text)) {
        const changed = rows.filter(
          (row) => row.transaction_id === params[0] && row.status === "revoked"
        );
        changed.forEach((row) => {
          row.status = row.used_at ? "used" : "valid";
        });
        return { rows: changed.map((row) => ({ ...row })) };
      }

      if (/^SELECT .* FROM tickets WHERE transaction_id = \$1 ORDER BY participant_index/i.test(text)) {
        return {
          rows: rows
            .filter((row) => row.transaction_id === params[0])
            .sort((a, b) => a.participant_index - b.participant_index)
            .map((row) => ({ ...row })),
        };
      }

      if (/^SELECT .* FROM tickets WHERE code = \$1/i.test(text)) {
        const row = rows.find((item) => item.code === params[0]);
        return { rows: row ? [{ ...row }] : [] };
      }

      if (/count\(\*\)/i.test(text)) {
        const n = rows.filter(
          (row) =>
            row.tier === params[0] &&
            (row.status === "valid" || row.status === "used")
        ).length;
        return { rows: [{ n }] };
      }

      if (/^INSERT INTO tickets/i.test(text)) {
        sequence += 1;
        const row = {
          code: params[0],
          transaction_id: params[1],
          tier: params[2],
          participant_name: params[3],
          participant_index: params[4],
          status: "valid",
          issued_at: `2027-01-01T00:00:0${sequence % 10}.000Z`,
          used_at: null,
          used_by: null,
        };
        rows.push(row);
        return { rows: [{ ...row }] };
      }

      throw new Error("unexpected query: " + text);
    },
  };
}

function order(id, qty = 2) {
  return {
    id,
    name: "Test Buyer",
    tier: "classic",
    qty,
    tickets: [{ tier: "classic", qty }],
    participants: Array.from({ length: qty }, (_, index) => ({
      tier: "classic",
      name: `Guest ${index + 1}`,
    })),
  };
}

async function issued(db, id = "TX-AAAAAA", qty = 2) {
  const result = await issueTicketsForOrder(db, order(id, qty));
  assert.equal(result.ok, true);
  return result.tickets;
}

test("check-in marks a valid ticket used and is idempotent", async () => {
  const db = createDb();
  const [first] = await issued(db, "TX-AAAAAA", 1);

  const success = await checkInTicket(db, first.code, "staff@example.test");
  assert.equal(success.ok, true);
  assert.equal(success.ticket.status, "used");
  assert.equal(success.ticket.used_by, "staff@example.test");
  assert.ok(success.ticket.used_at);

  const duplicate = await checkInTicket(db, first.code, "other@example.test");
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.ticket.status, "used");
  assert.equal(duplicate.ticket.used_by, "staff@example.test");
  assert.equal(duplicate.ticket.used_at, success.ticket.used_at);
});

test("check-in returns notFound for an unknown code", async () => {
  const db = createDb();
  const result = await checkInTicket(db, "ZZZZZZZZZZZZZZZZ", "staff@example.test");
  assert.equal(result.notFound, true);
});

test("check-in never marks a revoked ticket", async () => {
  const db = createDb();
  const tickets = await issued(db, "TX-AAAAAA", 1);
  await revokeTicketsForOrder(db, "TX-AAAAAA");

  const result = await checkInTicket(db, tickets[0].code, "staff@example.test");
  assert.equal(result.ok, false);
  assert.equal(result.ticket.status, "revoked");
  assert.equal(result.ticket.used_at, null);
});

test("revoking an order revokes used and valid tickets but keeps used_at/by", async () => {
  const db = createDb();
  const tickets = await issued(db, "TX-AAAAAA", 2);
  const checked = await checkInTicket(db, tickets[0].code, "staff@example.test");

  const revoked = await revokeTicketsForOrder(db, "TX-AAAAAA");
  assert.equal(revoked.revoked, 2);
  assert.ok(db.rows.every((row) => row.status === "revoked"));
  assert.equal(db.rows[0].used_at, checked.ticket.used_at);
  assert.equal(db.rows[0].used_by, "staff@example.test");
});

test("used -> revoked -> reapproved stays used; unused -> revoked -> reapproved returns valid", async () => {
  const db = createDb();
  const tickets = await issued(db, "TX-AAAAAA", 2);
  const checked = await checkInTicket(db, tickets[0].code, "staff@example.test");
  assert.equal(checked.ok, true);

  await revokeTicketsForOrder(db, "TX-AAAAAA");
  assert.equal(db.rows[0].status, "revoked");
  assert.equal(db.rows[1].status, "revoked");

  const reapproved = await issueTicketsForOrder(db, order("TX-AAAAAA", 2));
  assert.equal(reapproved.ok, true);
  assert.equal(reapproved.reactivated, 2);

  const usedRow = db.rows.find((row) => row.code === tickets[0].code);
  const validRow = db.rows.find((row) => row.code === tickets[1].code);
  assert.equal(usedRow.status, "used");
  assert.equal(validRow.status, "valid");
  assert.equal(usedRow.used_at, checked.ticket.used_at);
  assert.equal(usedRow.used_by, "staff@example.test");

  const blockedWhileUsed = await checkInTicket(db, usedRow.code, "another@example.test");
  assert.equal(blockedWhileUsed.ok, false);
  assert.equal(blockedWhileUsed.ticket.status, "used");
});

test("rapid revoke/reapprove cycles never duplicate tickets or lose used_at", async () => {
  const db = createDb();
  const tickets = await issued(db, "TX-AAAAAA", 2);
  const checked = await checkInTicket(db, tickets[0].code, "staff@example.test");
  const originalUsedAt = checked.ticket.used_at;

  for (let i = 0; i < 25; i += 1) {
    await revokeTicketsForOrder(db, "TX-AAAAAA");
    assert.equal(db.rows.length, 2, "ticket count changed during cycle");
    assert.ok(db.rows.every((row) => row.status === "revoked"));

    const blocked = await checkInTicket(db, tickets[1].code, "staff@example.test");
    assert.equal(blocked.ok, false, "revoked ticket was checkable");
    assert.equal(blocked.ticket.status, "revoked");

    await issueTicketsForOrder(db, order("TX-AAAAAA", 2));
    assert.equal(db.rows.length, 2, "ticket count changed during cycle");
    const usedRow = db.rows.find((row) => row.code === tickets[0].code);
    assert.equal(usedRow.status, "used");
    assert.equal(usedRow.used_at, originalUsedAt);
    assert.equal(usedRow.used_by, "staff@example.test");
  }
});

test("simultaneous check-ins mark the ticket exactly once", async () => {
  const db = createDb();
  const [ticket] = await issued(db, "TX-AAAAAA", 1);

  const results = await Promise.all([
    checkInTicket(db, ticket.code, "staff-a@example.test"),
    checkInTicket(db, ticket.code, "staff-b@example.test"),
  ]);

  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok).length, 1);
  assert.equal(db.rows[0].status, "used");
  assert.ok(db.rows[0].used_at);
  assert.ok(db.rows[0].used_by);
});

test("staff ticket shape hides buyer data and gives premium table number", () => {
  const classic = toStaffTicket({
    code: "ABCDEFGHJKMNPQRS",
    transaction_id: "TX-ABC123",
    tier: "classic",
    participant_name: "Alice",
    participant_index: 1,
    status: "used",
    issued_at: "2027-01-01T00:00:00.000Z",
    used_at: "2027-02-06T18:00:00.000Z",
    used_by: "staff@example.test",
  });
  assert.equal(classic.holderName, "Alice");
  assert.equal(classic.usedBy, "staff@example.test");
  assert.equal(classic.transactionId, undefined);
  assert.equal(classic.email, undefined);

  const premium = toStaffTicket({
    code: "ABCDEFGHJKMNPQRS",
    transaction_id: "TX-ABC123",
    tier: "premium",
    participant_name: "Ignored Name",
    participant_index: 4,
    status: "valid",
    issued_at: "2027-01-01T00:00:00.000Z",
    used_at: null,
    used_by: null,
  });
  assert.equal(premium.tableNumber, 4);
  assert.equal(premium.holderName, "Table 4");
  assert.equal(premium.usedBy, null);
});

test("check-in only emits an atomic conditional UPDATE", async () => {
  const seen = [];
  const db = {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      seen.push(text);
      if (/^UPDATE tickets SET status = 'used'/i.test(text)) return { rows: [] };
      if (/^SELECT .* FROM tickets WHERE code = \$1/i.test(text)) {
        return {
          rows: [{
            code: params[0],
            transaction_id: "TX-AAAAAA",
            tier: "classic",
            participant_name: "Alice",
            participant_index: 1,
            status: "used",
            issued_at: null,
            used_at: "2027-02-06T18:00:00.000Z",
            used_by: "staff@example.test",
          }],
        };
      }
      throw new Error("unexpected query");
    },
  };

  const result = await checkInTicket(db, "ABCDEFGHJKMNPQRS", "staff@example.test");
  assert.equal(result.ok, false);
  assert.match(seen[0], /WHERE code = \$1 AND status = 'valid'/);
  assert.ok(!seen.some((text) => /^UPDATE[\s\S]*SELECT/i.test(text)));
});
