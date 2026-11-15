import crypto from "node:crypto";
import pg from "pg";
import {
  checkInTicket,
  issueTicketsForOrder,
  revokeTicketsForOrder,
} from "../public/api/_lib/tickets.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.log("MISSING: DATABASE_URL");
  process.exitCode = 1;
} else {
  const client = new pg.Client({ connectionString });
  const reference = "TX-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  let failed = false;

  try {
    await client.connect();
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO transactions
         (id, name, email, tel, tickets, qty, tier, participants, amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved')`,
      [
        reference,
        "Tickets Verify",
        "tickets-verify@example.test",
        "+237600000000",
        JSON.stringify([{ tier: "classic", qty: 2 }]),
        2,
        "classic",
        JSON.stringify([
          { tier: "classic", name: "Participant One" },
          { tier: "classic", name: "Participant Two" },
        ]),
        30000,
      ]
    );

    const first = await issueTicketsForOrder(client, {
      id: reference,
      name: "Tickets Verify",
      qty: 2,
      tier: "classic",
      tickets: [{ tier: "classic", qty: 2 }],
      participants: [
        { tier: "classic", name: "Participant One" },
        { tier: "classic", name: "Participant Two" },
      ],
    });

    if (!first.ok || first.issued !== 2) {
      throw new Error("expected 2 issued tickets");
    }
    if (new Set(first.tickets.map((ticket) => ticket.code)).size !== 2) {
      throw new Error("ticket codes are not unique");
    }
    if (first.tickets.some((ticket) => ticket.status !== "valid")) {
      throw new Error("new tickets are not valid");
    }

    const second = await issueTicketsForOrder(client, {
      id: reference,
      name: "Tickets Verify",
      qty: 2,
      tier: "classic",
      tickets: [{ tier: "classic", qty: 2 }],
      participants: [],
    });
    if (!second.ok || second.issued !== 0 || second.existing !== 2) {
      throw new Error("issuing twice was not idempotent");
    }

    const checkedIn = await checkInTicket(
      client,
      first.tickets[0].code,
      "Admin Verify"
    );
    if (!checkedIn.ok || checkedIn.ticket.status !== "used") {
      throw new Error("check-in did not mark the ticket used");
    }

    const duplicate = await checkInTicket(
      client,
      first.tickets[0].code,
      "Admin Verify"
    );
    if (duplicate.ok || duplicate.ticket.status !== "used") {
      throw new Error("duplicate check-in was not rejected");
    }

    const revoked = await revokeTicketsForOrder(client, reference);
    if (revoked.revoked !== 2) {
      throw new Error("expected both tickets (used and valid) to be revoked");
    }

    const blocked = await checkInTicket(client, first.tickets[1].code, "Admin Verify");
    if (blocked.ok || blocked.ticket.status !== "revoked") {
      throw new Error("revoked ticket was still checkable");
    }

    const reissued = await issueTicketsForOrder(client, {
      id: reference,
      name: "Tickets Verify",
      qty: 2,
      tier: "classic",
      tickets: [{ tier: "classic", qty: 2 }],
      participants: [],
    });
    if (!reissued.ok || reissued.reactivated !== 2) {
      throw new Error("expected both tickets to reactivate");
    }
    const usedRow = reissued.tickets.find((ticket) => ticket.code === first.tickets[0].code);
    const validRow = reissued.tickets.find((ticket) => ticket.code === first.tickets[1].code);
    if (!usedRow || usedRow.status !== "used" || !usedRow.used_at) {
      throw new Error("reactivated used ticket lost its used state");
    }
    if (!validRow || validRow.status !== "valid") {
      throw new Error("reactivated unused ticket did not return to valid");
    }

    console.log(`tickets issue: ok (2 unique, idempotent)`);
    console.log(`tickets check-in: ok (used, duplicate rejected)`);
    console.log(`tickets revoke: ok (2 revoked, used_at/by preserved)`);
    console.log(`tickets reactivate: ok (used stays used, valid returns valid)`);
  } catch (error) {
    failed = true;
    const code = (error && error.code) || "unknown";
    const message = String((error && error.message) || "unknown").replace(
      /postgres(ql)?:\/\/[^\s]+/gi,
      "[REDACTED]"
    );
    console.log(`failed code=${code} message=${message}`);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    await client.end().catch(() => {});
    if (failed) process.exitCode = 1;
  }
}
