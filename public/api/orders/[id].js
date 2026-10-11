/* Gala & Awards 2027 — ACNU. api/orders/[id].js (Vercel Serverless Function).
 * PATCH /api/orders/:id  update an order's decision (status, decidedBy, decidedAt).
 * Admin only: requires a valid Firebase ID token whose account e-mail is in
 * ADMIN_EMAILS. Uses the Web Fetch API export shape (`{ fetch }`).
 *
 * Env: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY,
 *      ADMIN_EMAILS (comma-separated). */

import { getDb, getAuth } from "../_lib/firebase.js";

const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "")
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

/* Verify an admin ID token with the Firebase Admin SDK.
 * Returns { email } on success, or { error } with a matching HTTP status. */
async function verifyAdmin(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { error: "Authentification requise.", status: 401 };

  const auth = getAuth();
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch (e) {
    console.error("orders/[id] verifyIdToken error:", e.code || e.message);
    return { error: "Authentification invalide.", status: 401 };
  }
  const email = String(decoded.email || "").trim().toLowerCase();
  if (!email || !ADMIN_EMAILS.includes(email)) return { error: "Accès refusé.", status: 403 };
  return { email };
}

export default {
  async fetch(request) {
    try {
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
        const db = getDb();
        const orderRef = db.collection("orders").doc(id);
        const snap = await orderRef.get();
        if (!snap.exists) {
          return Response.json({ ok: false, error: "Transaction introuvable." }, { status: 404 });
        }
        await orderRef.update({ status, decided_by: decidedBy, decided_at: decidedAt });
        return Response.json({ ok: true, id });
      } catch (e) {
        console.error("orders/[id] PATCH error:", e.code || e.message);
        return Response.json({ ok: false, error: "Mise à jour impossible." }, { status: 500 });
      }
    } catch (e) {
      console.error("orders/[id] fatal error:", (e && (e.stack || e.message)) || e);
      return Response.json({ ok: false, error: "Erreur serveur interne." }, { status: 500 });
    }
  },
};