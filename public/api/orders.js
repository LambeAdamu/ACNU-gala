/* Gala & Awards 2027 — ACNU. api/orders.js (Vercel Serverless Function).
 * REST gateway for ticket orders, stored in Firestore:
 *   POST /api/orders  create a new order (open; duplicate-safe on the
 *                     payment reference via paymentRefs/{normalizedRef})
 *   GET  /api/orders  list up to 500 orders, newest first (admin only:
 *                     requires a valid Firebase ID token whose account
 *                     e-mail is in ADMIN_EMAILS)
 * Uses the Web Fetch API export shape (`{ fetch }`).
 *
 * Env: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY,
 *      ADMIN_EMAILS (comma-separated), CLOUDINARY_CLOUD_NAME. */

import { FieldValue } from "firebase-admin/firestore";
import { getDb, getAuth } from "./_lib/firebase.js";

const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const TIERS = { premium: true, vip: true, classic: true };
const STATUSES = { pending: true, approved: true, rejected: true };
const PAY_METHODS = { momomo: true, orange: true };
const MAX_PROOF_BYTES = 8 * 1024 * 1024; // 8 MB — keep in sync with payments.js
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const LIST_LIMIT = 500;

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

/* Firestore stores createdAt as a server Timestamp; the front end expects the
 * same ISO string it received from Postgres. Dates/Timestamps are converted
 * to ISO 8601, plain fields pass through unchanged. */
function ts(value) {
  if (!value) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toPublic(d) {
  return {
    id: d.id,
    buyerKey: d.buyer_key,
    name: d.name,
    email: d.email,
    tel: d.tel,
    tickets: d.tickets || [],
    qty: d.qty,
    tier: d.tier,
    participants: d.participants || [],
    amount: d.amount,
    payMethod: d.pay_method,
    payNum: d.pay_num,
    payDate: d.pay_date,
    ref: d.ref,
    proof: d.proof,
    proofSize: d.proof_size,
    proofUrl: d.proof_url,
    proofPublicId: d.proof_public_id,
    status: d.status,
    decidedBy: d.decided_by,
    decidedAt: d.decided_at ? ts(d.decided_at) : null,
    createdAt: ts(d.created_at),
  };
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
    console.error("orders verifyIdToken error:", e.code || e.message);
    return { error: "Authentification invalide.", status: 401 };
  }
  const email = String(decoded.email || "").trim().toLowerCase();
  if (!email || !ADMIN_EMAILS.includes(email)) return { error: "Accès refusé.", status: 403 };
  return { email };
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
    },
  };
}

export default {
  async fetch(request) {
    try {
      if (request.method === "POST") {
        const body = jsonParse(await request.text().catch(() => ""));
        const checked = validateOrder(body);
        if (checked.error) return Response.json({ ok: false, error: checked.error }, { status: checked.status });

        const o = checked.order;
        const normalizedRef = o.ref.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
        if (!normalizedRef) {
          return Response.json({ ok: false, error: "Référence de paiement invalide." }, { status: 400 });
        }

        try {
          const db = getDb();
          const orderRef = db.collection("orders").doc(o.id);
          const refRef = db.collection("paymentRefs").doc(normalizedRef);

          await db.runTransaction(async (tx) => {
            tx.create(refRef, { orderId: o.id, created_at: FieldValue.serverTimestamp() });
            tx.create(orderRef, {
              id: o.id,
              buyer_key: o.buyerKey,
              name: o.name,
              email: o.email,
              tel: o.tel,
              tickets: o.tickets,
              qty: o.qty,
              tier: o.tier,
              participants: o.participants,
              amount: o.amount,
              pay_method: o.payMethod,
              pay_num: o.payNum,
              pay_date: o.payDate,
              ref: o.ref,
              proof: o.proof,
              proof_size: o.proofSize,
              proof_url: o.proofUrl,
              proof_public_id: o.proofPublicId,
              status: o.status,
              decided_by: o.decidedBy,
              decided_at: o.decidedAt,
              created_at: FieldValue.serverTimestamp(),
            });
          });
          return Response.json({ ok: true, id: o.id });
        } catch (e) {
          console.error("orders POST error:", e.code || e.message);
          const alreadyExists =
            e && (e.code === 6 || e.code === "already-exists" || /ALREADY_EXISTS/.test(String(e.message || "")));
          if (alreadyExists) {
            return Response.json(
              { ok: false, error: "Cette référence existe déjà. Veuillez réessayer." },
              { status: 409 }
            );
          }
          return Response.json({ ok: false, error: "Enregistrement de la commande impossible." }, { status: 500 });
        }
      }

      if (request.method === "GET") {
        const auth = await verifyAdmin(request);
        if (auth.error) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

        try {
          const db = getDb();
          const snap = await db
            .collection("orders")
            .orderBy("created_at", "desc")
            .limit(LIST_LIMIT)
            .get();
          return Response.json({ ok: true, data: snap.docs.map((d) => toPublic(d.data())) });
        } catch (e) {
          console.error("orders GET error:", e.code || e.message);
          return Response.json({ ok: false, error: "Lecture des commandes impossible." }, { status: 500 });
        }
      }

      return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
    } catch (e) {
      console.error("orders fatal error:", (e && (e.stack || e.message)) || e);
      return Response.json({ ok: false, error: "Erreur serveur interne." }, { status: 500 });
    }
  },
};