import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTicketPlan,
  toPublicTicket,
} from "../public/api/_lib/tickets.js";

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

test("one premium unit expands to eight tickets", () => {
  const plan = buildTicketPlan({
    name: "Buyer",
    tier: "premium",
    qty: 1,
    tickets: [{ tier: "premium", qty: 1 }],
    participants: [{ tier: "premium", name: "Guest 1" }],
  });

  assert.equal(plan.length, 8);
  assert.deepEqual(plan[0], { tier: "premium", name: "Guest 1", participantIndex: 1 });
  assert.deepEqual(plan[1], { tier: "premium", name: "Participant 2", participantIndex: 2 });
  assert.deepEqual(plan[7], { tier: "premium", name: "Participant 8", participantIndex: 8 });
});

test("premium fallback quantity is treated as table units", () => {
  const plan = buildTicketPlan({
    name: "Buyer",
    tier: "premium",
    qty: 1,
    participants: [],
  });

  assert.equal(plan.length, 8);
  assert.deepEqual(plan[0], { tier: "premium", name: "Buyer", participantIndex: 1 });
  assert.deepEqual(plan[7], { tier: "premium", name: "Participant 8", participantIndex: 8 });
});

test("two premium units expand to sixteen tickets", () => {
  const participants = Array.from({ length: 16 }, (_, i) => ({
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

  assert.equal(plan.length, 16);
  assert.deepEqual(plan[0], { tier: "premium", name: "Guest 1", participantIndex: 1 });
  assert.deepEqual(plan[15], { tier: "premium", name: "Guest 16", participantIndex: 16 });
});

test("premium expands alongside classic and vip lines", () => {
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

  assert.equal(plan.length, 13);
  assert.equal(plan.filter((item) => item.tier === "premium").length, 8);
  assert.deepEqual(plan[5], { tier: "premium", name: "Participant 6", participantIndex: 6 });
  assert.deepEqual(plan[12], { tier: "premium", name: "Participant 13", participantIndex: 13 });
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
