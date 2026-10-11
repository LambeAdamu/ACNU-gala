/* Gala & Awards 2027 — ACNU. api/orders/[id].js (Vercel Serverless Function).
 * PATCH /api/orders/:id  update an order's decision (status, decidedBy, decidedAt).
 * Admin only: requires a valid Firebase ID token whose account e-mail is allowed.
 * Uses the Web Fetch API export shape (`{ fetch }`).
 *
 * Env: DATABASE_URL, FIREBASE_WEB_API_KEY. */

import pg from "pg";

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/* Admin allowlist. Configurable via the ADMIN_EMAILS env var (comma-separated);
 * falls back to the historical default so nothing breaks if it is unset. */
const ADMIN_EMAIL = "acnubureau.littoral@gmail.com";
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || ADMIN_EMAIL)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const STATUSES = { pending: true, approved: true, rejected: true };

function jsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function verifyAdmin(request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    console.error("orders/[id]: FIREBASE_WEB_API_KEY is not set on the server.");
    return { error: "Server configuration error.", status: 500 };
  }
  if (!token) return { error: "Authentification requise.", status: 401 };

  try {
    const res = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      }
    );
    if (!res.ok) return { error: "Authentification invalide.", status: 401 };
    const data = await res.json();
    const email = ((data.users && data.users[0] && data.users[0].email) || "").trim();
    if (!ADMIN_EMAILS.includes(email.toLowerCase())) return { error: "Accès refusé.", status: 403 };
    return { email };
  } catch (e) {
    console.error("orders/[id] token lookup error:", e);
    return { error: "Vérification de session impossible.", status: 500 };
  }
}

export default {
  async fetch(request) {
    if (request.method !== "PATCH") {
      return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
    }

    const auth = await verifyAdmin(request);
    if (auth.error) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

    const { pathname } = new URL(request.url);
    const id = decodeURIComponent(pathname.split("/").pop() || "");
    if (!/^TX-[A-Z0-9]{6}$/.test(id)) {
      return Response.json({ ok: false, error: "Référence de transaction invalide." }, { status: 400 });
    }

    const body = jsonParse(await request.text().catch(() => ""));
    const status = body && String(body.status || "").trim();
    if (!STATUSES[status]) {
      return Response.json({ ok: false, error: "Statut invalide." }, { status: 400 });
    }
    const decidedBy = String(body.decidedBy || "").trim() || "Admin ACNU";
    const decidedAt = (body && body.decidedAt) ? String(body.decidedAt) : new Date().toISOString();

    try {
      const res = await pool.query(
        `UPDATE transactions SET status = $2, decided_by = $3, decided_at = $4
         WHERE id = $1 RETURNING id, status, decided_by, decided_at`,
        [id, status, decidedBy, decidedAt]
      );
      if (!res.rows.length) {
        return Response.json({ ok: false, error: "Transaction introuvable." }, { status: 404 });
      }
      return Response.json({ ok: true, id });
    } catch (e) {
      console.error("orders/[id] PATCH error:", e);
      return Response.json({ ok: false, error: "Mise à jour impossible." }, { status: 500 });
    }
  },
};