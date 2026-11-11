import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTicketPlan,
  issueTicketsForOrder,
  premiumParticipantError,
  toPublicTicket,
} from "../public/api/_lib/tickets.js";

function createTicketDb(initial = []) {
  const tickets = initial.map((ticket) => ({ ...ticket }));
  let sequence = 0;
  return {
    tickets,
    async query(sql, params = []) {
      const text = String(sql).trim();
      if (/^SELECT .*FROM tickets WHERE transaction_id/i.test(text)) {
        return {
          rows: tickets
            .filter((ticket) => ticket.transaction_id === params[0])
            .sort((a, b) => a.participant_index - b.participant_index),
        };
      }
      if (/count\(\*\)/i.test(text)) {
        const n = tickets.filter(
          (ticket) =>
            ticket.tier === params[0] &&
            (ticket.status === "valid" || ticket.status === "used")
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
        tickets.push(row);
        return { rows: [row] };
      }
      throw new Error("unexpected query: " + text);
    },
  };
}

function premiumOrder(id, qty) {
  return {
    id,
    name: "Buyer",
    tier: "premium",
    qty,
    tickets: [{ tier: "premium", qty }],
    participants: Array.from({ length: qty }, (_, index) => ({
      tier: "premium",
      name: `Guest ${index + 1}`,
    })),
  };
}

test("ticket plan follows ticket lines and participant names", () => {
  const plan = buildTicketPlan({
    name: "Buyer",
    tier: "classic",
    qty: 3,
    tickets: [
      { tier: "classic", qty: 1 },
      { tier: "vip", qty: 2 },
    ],
    participants: [
      { tier: "classic", name: "Carol" },
      { tier: "vip", name: "Alice" },
      { tier: "vip", name: "Bob" },
    ],
  });

  assert.deepEqual(plan, [
    { tier: "classic", name: "Carol", participantIndex: 1 },
    { tier: "vip", name: "Alice", participantIndex: 2 },
    { tier: "vip", name: "Bob", participantIndex: 3 },
  ]);
});

test("one premium unit issues exactly one ticket", () => {
  const plan = buildTicketPlan({
    name: "Buyer",
    tier: "premium",
    qty: 1,
    tickets: [{ tier: "premium", qty: 1 }],
    participants: [{ tier: "premium", name: "Guest 1" }],
  });

  assert.deepEqual(plan, [
    { tier: "premium", name: "Guest 1", participantIndex: 1 },
  ]);
});

test("premium fallback quantity issues one ticket per unit", () => {
  const plan = buildTicketPlan({
    name: "Buyer",
    tier: "premium",
    qty: 1,
    participants: [],
  });

  assert.deepEqual(plan, [
    { tier: "premium", name: "Buyer", participantIndex: 1 },
  ]);
});

test("two premium units issue two tickets", () => {
  const participants = Array.from({ length: 2 }, (_, i) => ({
    tier: "premium",
    name: `Guest ${i + 1}`,
  }));
  const plan = buildTicketPlan({
    name: "Buyer",
    tier: "premium",
    qty: 2,
    tickets: [{ tier: "premium", qty: 2 }],
    participants,
  });

  assert.deepEqual(plan, [
    { tier: "premium", name: "Guest 1", participantIndex: 1 },
    { tier: "premium", name: "Guest 2", participantIndex: 2 },
  ]);
});

test("premium issues one ticket alongside classic and vip lines", () => {
  const plan = buildTicketPlan({
    name: "Buyer",
    tier: "classic",
    qty: 6,
    tickets: [
      { tier: "classic", qty: 3 },
      { tier: "vip", qty: 2 },
      { tier: "premium", qty: 1 },
    ],
    participants: [],
  });

  assert.equal(plan.length, 6);
  assert.equal(plan.filter((item) => item.tier === "premium").length, 1);
  assert.deepEqual(plan[5], { tier: "premium", name: "Participant 6", participantIndex: 6 });
});

test("one premium order issues one ticket", async () => {
  const db = createTicketDb();
  const result = await issueTicketsForOrder(db, premiumOrder("TX-AAAAAA", 1));

  assert.equal(result.ok, true);
  assert.equal(result.issued, 1);
  assert.equal(db.tickets.length, 1);
  assert.equal(db.tickets[0].tier, "premium");
  assert.equal(db.tickets[0].participant_name, "Guest 1");
});

test("five premium tickets are accepted and a sixth is rejected", async () => {
  const db = createTicketDb();
  const five = await issueTicketsForOrder(db, premiumOrder("TX-AAAAAA", 5));

  assert.equal(five.ok, true);
  assert.equal(five.issued, 5);
  assert.equal(db.tickets.length, 5);

  const sixth = await issueTicketsForOrder(db, premiumOrder("TX-BBBBBB", 1));

  assert.equal(sixth.ok, false);
  assert.equal(sixth.error, "CAPACITY");
  assert.equal(sixth.tier, "premium");
  assert.equal(sixth.remaining, 0);
  assert.equal(db.tickets.length, 5);
});

test("classic and vip still issue one ticket per unit", async () => {
  const db = createTicketDb();
  const result = await issueTicketsForOrder(db, {
    id: "TX-CCCCCC",
    name: "Buyer",
    tier: "classic",
    qty: 5,
    tickets: [
      { tier: "classic", qty: 2 },
      { tier: "vip", qty: 3 },
    ],
    participants: [
      { tier: "classic", name: "Classic 1" },
      { tier: "classic", name: "Classic 2" },
      { tier: "vip", name: "VIP 1" },
      { tier: "vip", name: "VIP 2" },
      { tier: "vip", name: "VIP 3" },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.issued, 5);
  assert.equal(db.tickets.filter((ticket) => ticket.tier === "classic").length, 2);
  assert.equal(db.tickets.filter((ticket) => ticket.tier === "vip").length, 3);
});

test("premium participant validation requires one name per pass", () => {
  const base = {
    tier: "premium",
    qty: 1,
    tickets: [{ tier: "premium", qty: 1 }],
    participants: [{ tier: "premium", name: "Guest 1" }],
  };

  assert.equal(premiumParticipantError(base), "");
  assert.match(
    premiumParticipantError({ ...base, participants: [] }),
    /1 nom\(s\) attendu\(s\), 0 fourni\(s\)/
  );
  assert.match(
    premiumParticipantError({
      ...base,
      participants: [
        { tier: "premium", name: "Guest 1" },
        { tier: "premium", name: "Guest 2" },
      ],
    }),
    /1 nom\(s\) attendu\(s\), 2 fourni\(s\)/
  );
  assert.match(
    premiumParticipantError({
      ...base,
      participants: [{ tier: "premium", name: "   " }],
    }),
    /1 nom\(s\) attendu\(s\), 0 fourni\(s\)/
  );
  assert.equal(
    premiumParticipantError({
      tier: "classic",
      qty: 1,
      tickets: [{ tier: "classic", qty: 1 }],
      participants: [],
    }),
    ""
  );
});

test("ticket plan falls back to the buyer and generated participant labels", () => {
  const plan = buildTicketPlan({
    name: "Buyer",
    tier: "classic",
    qty: 2,
    tickets: [{ tier: "classic", qty: 2 }],
    participants: [],
  });

  assert.deepEqual(plan, [
    { tier: "classic", name: "Buyer", participantIndex: 1 },
    { tier: "classic", name: "Participant 2", participantIndex: 2 },
  ]);
});

test("ticket plan rejects an unknown tier", () => {
  assert.throws(
    () =>
      buildTicketPlan({
        name: "Buyer",
        tier: "platinum",
        qty: 1,
        tickets: [{ tier: "platinum", qty: 1 }],
        participants: [],
      }),
    /INVALID_TICKET_TIER/
  );
});

test("public ticket exposes labels but hides usedBy", () => {
  const row = {
    code: "ABCDEFGHJKMNPQRS",
    transaction_id: "TX-ABC123",
    tier: "vip",
    participant_name: "Alice",
    participant_index: 1,
    status: "used",
    issued_at: "2027-01-01T00:00:00.000Z",
    used_at: "2027-02-06T18:00:00.000Z",
    used_by: "Admin ACNU",
  };

  const ticket = toPublicTicket(row);
  assert.equal(ticket.tierLabel, "VIP");
  assert.equal(ticket.statusLabel, "Utilisé");
  assert.equal(ticket.usedBy, undefined);

  const adminTicket = toPublicTicket(row, { admin: true });
  assert.equal(adminTicket.usedBy, "Admin ACNU");
});
