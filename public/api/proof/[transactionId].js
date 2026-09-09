/* Gala & Awards 2027 — ACNU. api/proof/[transactionId].js (Vercel Serverless Function).
 * Serves a stored payment proof straight from Postgres with its original
 * Content-Type, so the admin console can use it directly as an <img src> or
 * open it in a new tab. Uses the Web Fetch API export shape (`{ fetch }`) for
 * the Node.js runtime and reads the dynamic route segment from the URL.
 *
 * Env: DATABASE_URL (Postgres/Neon connection string). */

import pg from "pg";

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
    }

    const { pathname } = new URL(request.url);
    const transactionId = decodeURIComponent(pathname.split("/").pop() || "");

    if (!transactionId) {
      return Response.json({ ok: false, error: "transactionId manquant." }, { status: 400 });
    }

    try {
      const { rows } = await pool.query(
        "SELECT file_data, content_type, file_name, uploaded_at FROM proofs WHERE transaction_id = $1",
        [transactionId]
      );

      if (!rows.length) {
        return Response.json({ ok: false, error: "Preuve introuvable." }, { status: 404 });
      }

      const row = rows[0];
      const safeName = String(row.file_name || "").replace(/["\r\n]/g, "");

      return new Response(row.file_data, {
        status: 200,
        headers: {
          "Content-Type": row.content_type,
          "Content-Disposition": 'inline; filename="' + safeName + '"',
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (e) {
      console.error("proof fetch DB error:", e);
      return Response.json({ ok: false, error: "Erreur de lecture de la preuve." }, { status: 500 });
    }
  },
};