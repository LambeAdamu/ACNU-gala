/* Gala & Awards 2027 — ACNU. api/_lib/mail.js (Vercel Serverless).
 * Buyer confirmation e-mail sent via Gmail SMTP (nodemailer) once an order
 * has been persisted in Postgres/Neon. The message only confirms that the
 * order was RECEIVED and that its payment is awaiting verification by the
 * Payment Administrator — it never claims the payment was approved or that
 * tickets were issued. E-mail failures are silent to the caller: a skipped
 * or failed message must never fail the order itself.
 *
 * Env: MAIL_USER, MAIL_APP_PASSWORD, MAIL_FROM_NAME (optional),
 *      MAIL_BCC (optional). */

import nodemailer from "nodemailer";

const HOST_SMTP = "smtp.gmail.com";
const SMTP_PORT = 465;
const SMTP_TIMEOUT = 8000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const TIER_LABELS = { premium: "Premium", vip: "VIP", classic: "Classique" };
const PAY_METHOD_LABELS = { momomo: "Mobile Money (MTN MoMo)", orange: "Orange Money" };

function stripControls(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function isValidEmail(value) {
  const email = String(value || "");
  if (email.length === 0 || email.length > 254) return false;
  if (/[\r\n]/.test(email)) return false;
  return EMAIL_RE.test(email);
}

function orderDateAfricaDouala(value) {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Douala",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(safe);
}

function label(map, key, fallback) {
  return map[key] || fallback;
}

function formatFcfa(amount) {
  const n = Number(amount);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("fr-FR").format(Math.round(n)) + " FCFA"
    : stripControls(amount) + " FCFA";
}

export async function sendOrderConfirmation(order) {
  const mailUser = String(process.env.MAIL_USER || "").trim();
  const mailPass = process.env.MAIL_APP_PASSWORD || "";

  if (!mailUser || !mailPass) {
    console.warn("mail.js: MAIL_USER or MAIL_APP_PASSWORD is not set — confirmation e-mail skipped.");
    return { skipped: true };
  }

  const buyerEmail = String((order && order.email) || "").trim();
  if (!isValidEmail(buyerEmail)) {
    console.warn("mail.js: invalid buyer e-mail, confirmation skipped (address not logged).");
    return { skipped: true };
  }

  const orderId = stripControls(order.id);
  const buyerName = stripControls(order.name);
  const tier = stripControls(label(TIER_LABELS, order.tier, order.tier));
  const qty = Number.isFinite(Number(order.qty)) ? Number(order.qty) : 0;
  const amount = formatFcfa(order.amount);
  const payMethod = stripControls(label(PAY_METHOD_LABELS, order.payMethod, order.payMethod));
  const payRef = stripControls(order.ref);
  const orderDate = orderDateAfricaDouala(order.createdAt);
  const hasProof = order.proofUrl ? "Oui" : "Non";

  const subject = `ACNU Gala & Awards 2027 — Réception de votre commande ${orderId}`;
  const from = `"${stripControls(process.env.MAIL_FROM_NAME || "ACNU Gala & Awards")}" <${mailUser}>`;

  const text = [
    `Bonjour ${buyerName},`,
    "",
    "Nous vous confirmons la bonne réception de votre commande.",
    "",
    `- Référence de transaction : ${orderId}`,
    `- Nom de l'acheteur : ${buyerName}`,
    `- Catégorie de billet : ${tier}`,
    `- Quantité : ${qty}`,
    `- Montant : ${amount}`,
    `- Moyen de paiement : ${payMethod}`,
    `- Référence de paiement : ${payRef}`,
    `- Date de la commande : ${orderDate}`,
    `- Preuve de paiement reçue : ${hasProof}`,
    "",
    "Votre paiement est en attente de vérification par l'administrateur des paiements.",
    "Vos billets vous seront transmis dès que la vérification sera terminée.",
    "",
    `Conservez précieusement la référence de transaction (${orderId}) et la référence de paiement (${payRef}).`,
    "",
    "L'équipe ACNU Gala & Awards 2027",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f1ea;color:#23201b;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="background:#1a1713;color:#f5f2ec;padding:28px 32px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;font-size:22px;">ACNU Gala &amp; Awards 2027</h1>
      <p style="margin:8px 0 0;color:#cfccc6;">Réception de votre commande</p>
    </div>
    <div style="background:#ffffff;padding:28px 32px;border-radius:0 0 12px 12px;">
      <p style="margin:0 0 16px;">Bonjour <strong>${esc(buyerName)}</strong>,</p>
      <p style="margin:0 0 20px;">Nous vous confirmons la bonne réception de votre commande pour le Gala &amp; Awards 2027.</p>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="padding:8px 0;color:#6b6660;">Référence de transaction</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${esc(orderId)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Nom de l'acheteur</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${esc(buyerName)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Catégorie de billet</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${esc(tier)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Quantité</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${qty}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Montant</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${esc(amount)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Moyen de paiement</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${esc(payMethod)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Référence de paiement</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${esc(payRef)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Date de la commande</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${esc(orderDate)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Preuve de paiement reçue</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${hasProof}</td></tr>
      </table>
      <div style="margin:24px 0 0;background:#f7f4ec;border-left:4px solid #d8a13e;padding:16px 20px;border-radius:0 8px 8px 0;">
        <p style="margin:0 0 6px;color:#6b6660;">Statut de votre paiement</p>
        <p style="margin:0;font-weight:bold;">En attente de vérification par l'administrateur des paiements.</p>
        <p style="margin:8px 0 0;color:#6b6660;">Vos billets vous seront transmis dès que la vérification sera terminée.</p>
      </div>
      <p style="margin:20px 0 0;color:#6b6660;">
        Conservez précieusement votre référence de transaction (<strong>${esc(orderId)}</strong>)
        et votre référence de paiement (<strong>${esc(payRef)}</strong>).
      </p>
      <p style="margin:28px 0 0;color:#6b6660;">L'équipe ACNU Gala &amp; Awards 2027</p>
    </div>
  </div>
</body>
</html>`;

  const transporter = nodemailer.createTransport({
    host: HOST_SMTP,
    port: SMTP_PORT,
    secure: true,
    auth: { user: mailUser, pass: mailPass },
    connectionTimeout: SMTP_TIMEOUT,
    greetingTimeout: SMTP_TIMEOUT,
    socketTimeout: SMTP_TIMEOUT,
  });

  const mailOptions = {
    from,
    to: buyerEmail,
    subject: stripControls(subject),
    text,
    html,
  };
  if (process.env.MAIL_BCC) {
    mailOptions.bcc = stripControls(process.env.MAIL_BCC);
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    return { ok: true, messageId: info.messageId, accepted: info.accepted || [] };
  } catch (e) {
    console.error(
      "mail.js: send failed. code=" + (e && e.code ? e.code : "unknown") +
        " message=" + (e && e.message ? e.message : "unknown")
    );
    return { ok: false };
  }
}