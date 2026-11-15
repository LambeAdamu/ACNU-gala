/* Gala & Awards 2027 — ACNU. api/tickets/index.js
 * GET /api/tickets                 staff presence list (all event tickets)
 *   optional filters: status=valid|used|revoked, tier=classic|vip|premium
 *   optional transaction=TX-XXXXXX (kept for admin tooling)
 *   response includes summary counts for the whole event.
 *
 * Env: DATABASE_URL, FIREBASE_WEB_API_KEY, DOOR_STAFF_EMAILS. */

import pg from "pg";
import { verifyStaff } from "../_lib/admin.js";
import { toStaffTicket } from "../_lib/tickets.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const STATUSES = new Set(["valid", "used", "revoked"]);
const TIERS = new Set(["classic", "vip", "premium"]);
const MAX_ROWS = 1000;

const TICKET_COLUMNS =
  "code, transaction_id, tier, participant_name, participant_index, status, issued_at, used_at, used_by";

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function emptySummary() {
  return {
    total: 0,
    byStatus: { valid: 0, used: 0, revoked: 0 },
    byTier: { classic: 0, vip: 0, premium: 0 },
  };
}

function readSummary(row) {
  const summary = emptySummary();
  if (!row) return summary;
  summary.total = Number(row.total) || 0;
  summary.byStatus.valid = Number(row.valid) || 0;
  summary.byStatus.used = Number(row.used) || 0;
  summary.byStatus.revoked = Number(row.revoked) || 0;
  summary.byTier.classic = Number(row.classic) || 0;
  summary.byTier.vip = Number(row.vip) || 0;
  summary.byTier.premium = Number(row.premium) || 0;
  return summary;
}

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    const auth = await verifyStaff(request);
    if (auth.error) {
      return json({ ok: false, error: auth.error }, auth.status);
    }

    const url = new URL(request.url);
    const transaction = String(url.searchParams.get("transaction") || "")
      .trim()
      .toUpperCase();
    if (transaction && !/^TX-[A-Z0-9]{6}$/.test(transaction)) {
      return json({ ok: false, error: "Référence de transaction invalide." }, 400);
    }

    const status = String(url.searchParams.get("status") || "").trim().toLowerCase();
    if (status && !STATUSES.has(status)) {
      return json({ ok: false, error: "Statut de billet invalide." }, 400);
    }

    const tier = String(url.searchParams.get("tier") || "").trim().toLowerCase();
    if (tier && !TIERS.has(tier)) {
      return json({ ok: false, error: "Catégorie de billet invalide." }, 400);
    }

    try {
      const params = [];
      const clauses = [];
      if (transaction) {
        params.push(transaction);
        clauses.push(`transaction_id = $${params.length}`);
      }
      if (status) {
        params.push(status);
        clauses.push(`status = $${params.length}`);
      }
      if (tier) {
        params.push(tier);
        clauses.push(`tier = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

      const summaryResult = await pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'valid')::int AS valid,
                count(*) FILTER (WHERE status = 'used')::int AS used,
                count(*) FILTER (WHERE status = 'revoked')::int AS revoked,
                count(*) FILTER (WHERE tier = 'classic')::int AS classic,
                count(*) FILTER (WHERE tier = 'vip')::int AS vip,
                count(*) FILTER (WHERE tier = 'premium')::int AS premium
           FROM tickets`
      );

      const { rows } = await pool.query(
        `SELECT ${TICKET_COLUMNS}
           FROM tickets
           ${where}
          ORDER BY issued_at DESC, participant_index ASC
          LIMIT ${MAX_ROWS}`,
        params
      );

      return json({
        ok: true,
        data: rows.map((row) => toStaffTicket(row)),
        summary: readSummary(summaryResult.rows[0]),
        filters: { status: status || null, tier: tier || null, transaction: transaction || null },
        count: rows.length,
        capped: rows.length === MAX_ROWS,
      });
    } catch (error) {
      console.error(
        "tickets GET error code=" + ((error && error.code) || "unknown")
      );
      return json({ ok: false, error: "Lecture des billets impossible." }, 500);
    }
  },
};
