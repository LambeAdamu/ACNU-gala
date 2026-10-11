/* Gala & Awards 2027 — ACNU. api/orders.js (Vercel Serverless Function).
 * REST gateway for ticket orders in Postgres/Neon:
 *   POST /api/orders  create a new order (open, mirrors the old Firestore rule
 *                     that allowed anonymous creates of pending transactions)
 *   GET  /api/orders  list all orders, newest first (admin only: requires a
 *                     valid Firebase ID token whose account e-mail is allowed)
 * Uses the Web Fetch API export shape (`{ fetch }`).
 *
 * Env: DATABASE_URL, FIREBASE_WEB_API_KEY. */

import pg from "pg";
import { sendOrderConfirmation } from "./_lib/mail.js";

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/* Admin allowlist. Configurable via the ADMIN_EMAILS env var (comma-separated);
 * falls back to the historical default so nothing breaks if it is unset. */
const ADMIN_EMAIL = "acnubureau.littoral@gmail.com";
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || ADMIN_EMAIL)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const TIERS = { premium: true, vip: true, classic: true };
const STATUSES = { pending: true, approved: true, rejected: true };
const PAY_METHODS = { momomo: true, orange: true };
const MAX_PROOF_BYTES = 8 * 1024 * 1024; // 8 MB — keep in sync with payments.js
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";

/* A proof is mandatory and must be a real asset uploaded to our Cloudinary
 * account, so a buyer cannot persist an order without a transaction proof. */
function validateProof(proofUrl, proofSize, cloudName) {
  if (!proofUrl) return { error: "Preuve de paiement requise.", status: 400 };
  let url;
  try {
    url = new URL(proofUrl);
  } catch (e) {
    return { error: "URL de preuve invalide.", status: 400 };
  }
  const onCloudinary =
    url.protocol === "https:" &&
    url.hostname === "res.cloudinary.com" &&
    (!cloudName || url.pathname.startsWith("/" + cloudName + "/"));
  if (!onCloudinary) return { error: "Preuve de paiement non valide.", status: 400 };
  if (!Number.isFinite(proofSize) || proofSize <= 0) {
    return { error: "Taille de preuve invalide.", status: 400 };
  }
  if (proofSize > MAX_PROOF_BYTES) {
    return { error: "Preuve trop volumineuse (max 8 Mo).", status: 400 };
  }
  return { ok: true };
}

function jsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/* Send the buyer confirmation e-mail AFTER the INSERT has committed. The
 * result is intentionally ignored here: a skipped or failed e-mail must never
 * change the HTTP response or fail the order itself. */
async function sendConfirmationEmail(order) {
  try {
    const result = await sendOrderConfirmation(order);
    if (result && result.ok && result.messageId) {
      console.log("orders email sent:", result.messageId);
    }
  } catch (e) {
    console.error("orders email error:", e.message);
  }
}

function toPublic(row) {
  return {
    id: row.id,
    buyerKey: row.buyer_key,
    name: row.name,
    email: row.email,
    tel: row.tel,
    tickets: row.tickets || [],
    qty: row.qty,
    tier: row.tier,
    participants: row.participants || [],
    amount: row.amount,
    payMethod: row.pay_method,
    payNum: row.pay_num,
    payDate: row.pay_date,
    ref: row.ref,
    proof: row.proof,
    proofSize: row.proof_size,
    proofUrl: row.proof_url,
    proofPublicId: row.proof_public_id,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

/* Verify an admin ID token via the Firebase Auth REST API (no admin SDK needed).
 * Returns { email } on success, or { error } with a matching HTTP status. */
async function verifyAdmin(request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    console.error("orders: FIREBASE_WEB_API_KEY is not set on the server.");
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
    console.error("orders token lookup error:", e);
    return { error: "Vérification de session impossible.", status: 500 };
  }
}

/* Validate an order payload. Returns { order } or { error } with HTTP status. */
function validateOrder(body) {
  if (!body || typeof body !== "object") return { error: "Corps de requête invalide.", status: 400 };

  const id = String(body.id || "").trim();
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const tel = String(body.tel || "").trim();
  const tier = String(body.tier || "").trim();
  const status = String(body.status || "pending").trim();
  const rawQty = Number(body.qty);
  const rawAmount = Number(body.amount);
  const tickets = Array.isArray(body.tickets) ? body.tickets : [];
  const participants = Array.isArray(body.participants) ? body.participants : [];

  if (!/^TX-[A-Z0-9]{6}$/.test(id)) return { error: "Référence de transaction invalide.", status: 400 };
  if (name.length < 3) return { error: "Nom de l'acheteur invalide.", status: 400 };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: "Adresse e-mail invalide.", status: 400 };
  if (!tel || tel.replace(/\D/g, "").length < 8) return { error: "Numéro de téléphone invalide.", status: 400 };
  if (!TIERS[tier]) return { error: "Type de billet invalide.", status: 400 };
  if (!STATUSES[status]) return { error: "Statut invalide.", status: 400 };
  if (!Number.isInteger(rawQty) || rawQty <= 0) return { error: "Quantité invalide.", status: 400 };
  if (!Number.isFinite(rawAmount) || rawAmount < 0) return { error: "Montant invalide.", status: 400 };

  const proof = String(body.proof || "").trim();
  const proofUrl = String(body.proofUrl || "").trim();
  const proofPublicId = String(body.proofPublicId || "").trim();
  const proofSize = Number(body.proofSize);
  if (!proof) return { error: "Preuve de paiement requise.", status: 400 };
  const proofCheck = validateProof(proofUrl, proofSize, CLOUD_NAME);
  if (proofCheck.error) return { error: proofCheck.error, status: proofCheck.status };

  const payMethod = String(body.payMethod || "momomo").trim();
  const payNum = String(body.payNum || "").trim();
  if (!PAY_METHODS[payMethod]) return { error: "Moyen de paiement invalide.", status: 400 };
  if (payNum.replace(/\D/g, "").length < 8) return { error: "Numéro de paiement invalide.", status: 400 };

  return {
    order: {
      id,
      buyerKey: String(body.buyerKey || ""),
      name,
      email,
      tel,
      tickets,
      qty: rawQty,
      tier,
      participants,
      amount: Math.round(rawAmount),
      payMethod,
      payNum,
      payDate: String(body.payDate || ""),
      ref: String(body.ref || ""),
      proof,
      proofSize,
      proofUrl,
      proofPublicId,
      status,
      decidedBy: String(body.decidedBy || ""),
      decidedAt: body.decidedAt ? String(body.decidedAt) : null,
      createdAt: body.createdAt ? String(body.createdAt) : new Date().toISOString(),
    },
  };
}

export default {
  async fetch(request) {
    if (request.method === "POST") {
      const body = jsonParse(await request.text().catch(() => ""));
      const checked = validateOrder(body);
      if (checked.error) return Response.json({ ok: false, error: checked.error }, { status: checked.status });

      try {
        const res = await pool.query(
          `INSERT INTO transactions (
             id, buyer_key, name, email, tel, tickets, qty, tier, participants,
             amount, pay_method, pay_num, pay_date, ref, proof, proof_size,
             proof_url, proof_public_id, status, decided_by, decided_at, created_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
           )
           RETURNING id`,
          [
            checked.order.id,
            checked.order.buyerKey,
            checked.order.name,
            checked.order.email,
            checked.order.tel,
            JSON.stringify(checked.order.tickets),
            checked.order.qty,
            checked.order.tier,
            JSON.stringify(checked.order.participants),
            checked.order.amount,
            checked.order.payMethod,
            checked.order.payNum,
            checked.order.payDate,
            checked.order.ref,
            checked.order.proof,
            checked.order.proofSize,
            checked.order.proofUrl,
            checked.order.proofPublicId,
            checked.order.status,
            checked.order.decidedBy,
            checked.order.decidedAt,
            checked.order.createdAt,
          ]
        );
        await sendConfirmationEmail(checked.order);
        return Response.json({ ok: true, id: res.rows[0].id });
      } catch (e) {
        console.error("orders POST error:", e);
        if (e && e.code === "23505") {
          return Response.json({ ok: false, error: "Cette référence existe déjà. Veuillez réessayer." }, { status: 409 });
        }
        return Response.json({ ok: false, error: "Enregistrement de la commande impossible." }, { status: 500 });
      }
    }

    if (request.method === "GET") {
      const auth = await verifyAdmin(request);
      if (auth.error) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

      try {
        const { rows } = await pool.query(
          "SELECT * FROM transactions ORDER BY created_at DESC, id DESC"
        );
        return Response.json({ ok: true, data: rows.map(toPublic) });
      } catch (e) {
        console.error("orders GET error:", e);
        return Response.json({ ok: false, error: "Lecture des commandes impossible." }, { status: 500 });
      }
    }

    return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  },
};