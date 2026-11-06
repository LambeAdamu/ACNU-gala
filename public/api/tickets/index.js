/* Gala & Awards 2027 — ACNU. api/tickets/index.js
 * GET /api/tickets?transaction=TX-XXXXXX  admin ticket list.
 *
 * Env: DATABASE_URL, FIREBASE_WEB_API_KEY. */

import pg from "pg";
import { verifyAdmin } from "../_lib/admin.js";
import { toPublicTicket } from "../_lib/tickets.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    const auth = await verifyAdmin(request);
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

    try {
      const params = [];
      let where = "";
      if (transaction) {
        params.push(transaction);
        where = "WHERE transaction_id = $1";
      }
      const { rows } = await pool.query(
        `SELECT code, transaction_id, tier, participant_name, participant_index,
                status, issued_at, used_at, used_by
           FROM tickets ${where}
          ORDER BY issued_at DESC, participant_index ASC
          LIMIT 500`,
        params
      );
      return json({
        ok: true,
        data: rows.map((row) => toPublicTicket(row, { admin: true })),
      });
    } catch (error) {
      console.error(
        "tickets GET error code=" + ((error && error.code) || "unknown")
      );
      return json({ ok: false, error: "Lecture des billets impossible." }, 500);
    }
  },
};
