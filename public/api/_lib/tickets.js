import { generateTicketCode } from "./codes.js";
import { TIERS, tierCapacity } from "./config.js";

export const TIER_LABELS = Object.freeze({
  premium: "Premium",
  vip: "VIP",
  classic: "Classique",
});

export const TICKET_STATUS_LABELS = Object.freeze({
  valid: "Valide",
  used: "Utilisé",
  revoked: "Annulé",
});

const TICKET_COLUMNS =
  "code, transaction_id, tier, participant_name, participant_index, status, issued_at, used_at, used_by";

function normalizeCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function participantsByTier(order) {
  const map = {};
  const source = Array.isArray(order && order.participants) ? order.participants : [];
  for (const item of source) {
    const tier = String((item && item.tier) || "").trim();
    const name = String((item && item.name) || "").trim();
    if (!TIERS[tier] || !name) continue;
    if (!map[tier]) map[tier] = [];
    map[tier].push(name);
  }
  return map;
}

export function buildTicketPlan(order) {
  const source = Array.isArray(order && order.tickets) && order.tickets.length
    ? order.tickets
    : [{ tier: order && order.tier, qty: order && order.qty }];
  const names = participantsByTier(order);
  const buyerName = String((order && order.name) || "").trim();
  const plan = [];

  for (const item of source) {
    const tier = String((item && item.tier) || "").trim();
    if (!TIERS[tier]) throw new Error("INVALID_TICKET_TIER");
    const units = normalizeCount(item && item.qty);
    const qty = tier === "premium" ? units * TIERS.premium.perTable : units;
    for (let i = 0; i < qty; i += 1) {
      const index = plan.length;
      const name = (names[tier] && names[tier][i]) || (index === 0 && buyerName) || `Participant ${index + 1}`;
      plan.push({ tier, name, participantIndex: index + 1 });
    }
  }

  return plan;
}

export async function getTicketsForOrder(db, transactionId) {
  const { rows } = await db.query(
    `SELECT ${TICKET_COLUMNS} FROM tickets WHERE transaction_id = $1 ORDER BY participant_index`,
    [transactionId]
  );
  return rows;
}

function planFromRows(rows) {
  return rows.map((row) => ({
    tier: row.tier,
    name: row.participant_name,
    participantIndex: row.participant_index,
  }));
}

async function checkCapacity(db, plan) {
  const byTier = {};
  for (const item of plan) {
    if (!byTier[item.tier]) byTier[item.tier] = 0;
    byTier[item.tier] += 1;
  }

  for (const [tier, qty] of Object.entries(byTier)) {
    const config = TIERS[tier];
    if (!config) return { ok: false, error: "UNKNOWN_TIER", tier };
    if (config.tables == null) continue;

    const capacity = tierCapacity(tier);
    if (!capacity.ok) return { ok: false, error: capacity.error, tier };

    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM tickets WHERE tier = $1 AND status IN ('valid', 'used')",
      [tier]
    );
    const sold = rows[0] ? rows[0].n : 0;
    if (sold + qty > capacity.seats) {
      return {
        ok: false,
        error: "CAPACITY",
        tier,
        remaining: Math.max(0, capacity.seats - sold),
      };
    }
  }

  return { ok: true };
}

export async function issueTicketsForOrder(db, order) {
  const transactionId = String((order && order.id) || "");
  if (!transactionId) return { ok: false, error: "MISSING_TRANSACTION_ID" };

  const existing = await getTicketsForOrder(db, transactionId);
  if (existing.length) {
    const active = existing.filter((ticket) => ticket.status !== "revoked");
    if (active.length) {
      return { ok: true, issued: 0, existing: existing.length, tickets: existing };
    }

    const plan = planFromRows(existing);
    const capacity = await checkCapacity(db, plan);
    if (!capacity.ok) return capacity;

    const { rows } = await db.query(
      `UPDATE tickets SET status = 'valid'
        WHERE transaction_id = $1 AND status = 'revoked'
        RETURNING ${TICKET_COLUMNS}`,
      [transactionId]
    );
    const tickets = await getTicketsForOrder(db, transactionId);
    return { ok: true, issued: 0, reactivated: rows.length, tickets };
  }

  const plan = buildTicketPlan(order);
  if (!plan.length) return { ok: true, issued: 0, tickets: [] };

  const capacity = await checkCapacity(db, plan);
  if (!capacity.ok) return capacity;

  const issued = [];
  for (const item of plan) {
    let inserted = null;
    for (let attempt = 0; attempt < 8 && !inserted; attempt += 1) {
      const code = generateTicketCode();
      try {
        const { rows } = await db.query(
          `INSERT INTO tickets (code, transaction_id, tier, participant_name, participant_index)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING ${TICKET_COLUMNS}`,
          [code, transactionId, item.tier, item.name, item.participantIndex]
        );
        inserted = rows[0];
      } catch (error) {
        const isCodeCollision =
          error &&
          error.code === "23505" &&
          String(error.constraint || "").includes("code");
        if (!isCodeCollision) throw error;
      }
    }
    if (!inserted) throw new Error("TICKET_CODE_COLLISION");
    issued.push(inserted);
  }

  return { ok: true, issued: issued.length, tickets: issued };
}

export async function revokeTicketsForOrder(db, transactionId) {
  const { rows } = await db.query(
    `UPDATE tickets SET status = 'revoked'
      WHERE transaction_id = $1 AND status = 'valid'
      RETURNING ${TICKET_COLUMNS}`,
    [transactionId]
  );
  return { revoked: rows.length, tickets: rows };
}

export async function checkInTicket(db, code, usedBy) {
  const safeUsedBy = String(usedBy || "Admin ACNU").trim().slice(0, 200);
  const { rows } = await db.query(
    `UPDATE tickets
        SET status = 'used', used_at = now(), used_by = $2
      WHERE code = $1 AND status = 'valid'
      RETURNING ${TICKET_COLUMNS}`,
    [code, safeUsedBy]
  );
  if (rows.length) return { ok: true, ticket: rows[0] };

  const current = await db.query(
    `SELECT ${TICKET_COLUMNS} FROM tickets WHERE code = $1`,
    [code]
  );
  if (!current.rows.length) return { notFound: true };
  return { ok: false, ticket: current.rows[0] };
}

export function toPublicTicket(row, { admin = false } = {}) {
  const ticket = {
    code: row.code,
    transactionId: row.transaction_id,
    tier: row.tier,
    tierLabel: TIER_LABELS[row.tier] || row.tier,
    participantName: row.participant_name,
    participantIndex: row.participant_index,
    status: row.status,
    statusLabel: TICKET_STATUS_LABELS[row.status] || row.status,
    issuedAt: row.issued_at,
    usedAt: row.used_at,
  };
  if (admin) {
    ticket.usedBy = row.used_by;
  }
  return ticket;
}
