/* Gala & Awards 2027 — ACNU. api/_lib/mail.js (Vercel Serverless).
 * Transaction e-mails sent via Gmail SMTP (nodemailer):
 *   - buyer confirmation after an order is persisted (existing behaviour)
 *   - admin notification when a new transaction awaits validation
 *   - buyer thank-you when an admin approves the transaction
 * A skipped or failed message must never fail or roll back the order itself.
 *
 * Env: MAIL_USER, MAIL_APP_PASSWORD, MAIL_FROM_NAME (optional),
 *      MAIL_BCC (optional), SITE_URL (optional), ADMIN_NOTIFY_EMAIL (optional),
 *      MAIL_DRY_RUN (optional). */

import nodemailer from "nodemailer";
import { isValidCodeFormat } from "./codes.js";

const HOST_SMTP = "smtp.gmail.com";
const SMTP_PORT = 465;
const SMTP_TIMEOUT = 8000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const EVENT_LINE =
  "samedi 6 février 2027 au Cordia Hall, Palms City – Douala";

export const TIER_LABELS = {
  premium: "Premium",
  vip: "VIP",
  classic: "Classique",
};

const PAY_METHOD_LABELS = {
  momomo: "Mobile Money (MTN MoMo)",
  orange: "Orange Money",
};

export function stripControls(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

export function sanitizeHeader(value) {
  return stripControls(value);
}

export function escapeHtml(value) {
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

export function isValidEmail(value) {
  const email = String(value || "");
  if (email.length === 0 || email.length > 254) return false;
  if (/[\r\n]/.test(email)) return false;
  return EMAIL_RE.test(email);
}

export function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return sanitizeHeader(value);
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatFcfa(value) {
  const amount = formatAmount(value);
  return (amount || "0") + " FCFA";
}

export function formatDateAfricaDouala(value) {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Douala",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(safe);
  const get = (type) =>
    (parts.find((part) => part.type === type) || {}).value || "";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("day")}/${get("month")}/${get("year")} à ${hour}:${get("minute")}`;
}

function label(map, key, fallback) {
  return map[key] || fallback;
}

function fromAddress() {
  const name = sanitizeHeader(process.env.MAIL_FROM_NAME || "ACNU Gala & Awards");
  const address = sanitizeHeader(process.env.MAIL_USER || "");
  return address ? { name, address } : undefined;
}

function siteUrl() {
  const raw = sanitizeHeader(process.env.SITE_URL || "https://acnu-gala.vercel.app");
  return raw.replace(/\/+$/, "");
}

function ticketLink(code) {
  const normalized = stripControls(code).toUpperCase();
  if (!isValidCodeFormat(normalized)) return "";
  try {
    const url = new URL(siteUrl() + "/t/" + normalized);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function normalizeTickets(order) {
  const source = Array.isArray(order && order.tickets) ? order.tickets : [];
  const out = [];
  for (const item of source) {
    const tier = stripControls(item && item.tier);
    const qty = Number(item && item.qty);
    if (!tier || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({ tier, qty: Math.round(qty), label: label(TIER_LABELS, tier, tier) });
  }
  if (!out.length) {
    const tier = stripControls(order && order.tier);
    const qty = Number(order && order.qty);
    if (tier && Number.isFinite(qty) && qty > 0) {
      out.push({ tier, qty: Math.round(qty), label: label(TIER_LABELS, tier, tier) });
    }
  }
  if (!out.length) {
    const qty = Number(order && order.qty);
    if (Number.isFinite(qty) && qty > 0) {
      out.push({ tier: "", qty: Math.round(qty), label: "Billet" });
    }
  }
  return out;
}

function participantsByTier(order) {
  const map = {};
  const source = Array.isArray(order && order.participants) ? order.participants : [];
  for (const item of source) {
    const tier = stripControls(item && item.tier);
    const name = stripControls(item && item.name);
    if (!tier || !name) continue;
    if (!map[tier]) map[tier] = [];
    map[tier].push(name);
  }
  return map;
}

function adminTicketSummary(order) {
  const tickets = normalizeTickets(order);
  if (!tickets.length) return "—";
  return tickets.map((t) => `${t.qty} × ${t.label}`).join(", ");
}

function buyerTicketLines(order) {
  const participants = participantsByTier(order);
  const tickets = normalizeTickets(order);
  return tickets.map((t) => {
    const names = participants[t.tier] || [];
    const suffix = names.length ? " — " + names.join(", ") : "";
    return `• ${t.qty} × ${t.label}${suffix}`;
  });
}

function buyerTicketListHtml(order) {
  const participants = participantsByTier(order);
  const tickets = normalizeTickets(order);
  if (!tickets.length) return "";
  return (
    '<ul style="margin:8px 0 0;padding:0 0 0 20px;">' +
    tickets
      .map((t) => {
        const names = participants[t.tier] || [];
        const suffix = names.length
          ? " — " + escapeHtml(names.join(", "))
          : "";
        return `<li style="margin:4px 0;">${t.qty} × ${escapeHtml(t.label)}${suffix}</li>`;
      })
      .join("") +
    "</ul>"
  );
}

function issuedTicketItems(order) {
  const source = Array.isArray(order && order.issuedTickets) ? order.issuedTickets : [];
  return source
    .map((ticket) => {
      const code = stripControls(ticket && ticket.code).toUpperCase();
      const link = ticketLink(code);
      if (!code || !link) return null;
      return {
        code,
        link,
        tier: stripControls(label(TIER_LABELS, ticket.tier, ticket.tier)),
        name: stripControls(ticket.participantName),
      };
    })
    .filter(Boolean);
}

function issuedTicketLines(order) {
  return issuedTicketItems(order).map(
    (ticket) => `• ${ticket.tier}${ticket.name ? " — " + ticket.name : ""} : ${ticket.link}`
  );
}

function issuedTicketListHtml(order) {
  const items = issuedTicketItems(order);
  if (!items.length) return "";
  return (
    '<ul style="margin:8px 0 0;padding:0 0 0 20px;">' +
    items
      .map(
        (ticket) =>
          `<li style="margin:4px 0;">${escapeHtml(ticket.tier)}${ticket.name ? " — " + escapeHtml(ticket.name) : ""} : <a href="${escapeHtml(ticket.link)}">${escapeHtml(ticket.link)}</a></li>`
      )
      .join("") +
    "</ul>"
  );
}

export function buildAdminEmail(order) {
  const reference = sanitizeHeader(order && order.id);
  const buyerEmail = sanitizeHeader(order && order.email);
  const buyerName = stripControls(order && order.name);
  const phone = stripControls(order && order.tel);
  const amount = formatFcfa(order && order.amount);
  const orderDate = formatDateAfricaDouala(order && order.createdAt);
  const method = stripControls(
    label(PAY_METHOD_LABELS, order && order.payMethod, order && order.payMethod)
  );
  const payerRef = stripControls(order && order.ref);
  const proofUrl = stripControls(order && order.proofUrl);
  const tickets = adminTicketSummary(order);
  const subject = `Nouvelle transaction à valider — ${reference} — ${amount}`;
  const to = sanitizeHeader(
    process.env.ADMIN_NOTIFY_EMAIL || process.env.MAIL_USER || ""
  );
  const replyTo = isValidEmail(buyerEmail) ? buyerEmail : undefined;
  const dashboardUrl = `${siteUrl()}/admin`;

  const text = [
    "Une nouvelle transaction vient d'être soumise et attend votre validation.",
    "",
    `Référence : ${reference}`,
    `Date : ${orderDate}`,
    `Acheteur : ${buyerName}`,
    `Email : ${buyerEmail}`,
    `Téléphone : ${phone}`,
    `Billets : ${tickets}`,
    `Montant : ${amount}`,
    `Moyen de paiement : ${method} — ${payerRef}`,
    `Preuve : ${proofUrl || "non fournie"}`,
    "",
    `Ouvrir le tableau de bord : ${dashboardUrl}`,
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f1ea;color:#23201b;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="background:#1a1713;color:#f5f2ec;padding:28px 32px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;font-size:22px;">ACNU Gala &amp; Awards 2027</h1>
      <p style="margin:8px 0 0;color:#cfccc6;">Nouvelle transaction à valider</p>
    </div>
    <div style="background:#ffffff;padding:28px 32px;border-radius:0 0 12px 12px;">
      <p style="margin:0 0 16px;">Une nouvelle transaction vient d'être soumise et attend votre validation.</p>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="padding:8px 0;color:#6b6660;">Référence</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(reference)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Date</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(orderDate)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Acheteur</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(buyerName)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Email</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(buyerEmail)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Téléphone</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(phone)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Billets</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(tickets)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Montant</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(amount)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Moyen de paiement</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(method)} — ${escapeHtml(payerRef)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Preuve</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(proofUrl || "non fournie")}</td></tr>
      </table>
      <p style="margin:24px 0 0;">
        <a href="${escapeHtml(dashboardUrl)}" style="color:#1a1713;">Ouvrir le tableau de bord</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  return {
    from: fromAddress(),
    to,
    replyTo,
    subject: sanitizeHeader(subject),
    text,
    html,
  };
}

export function buildBuyerApprovalEmail(order) {
  const reference = sanitizeHeader(order && order.id);
  const buyerEmail = sanitizeHeader(order && order.email);
  const buyerName = stripControls(order && order.name);
  const amount = formatFcfa(order && order.amount);
  const subject = `Votre paiement est validé — Gala & Awards 2027 (${reference})`;
  const lines = buyerTicketLines(order);

  const text = [
    `Bonjour ${buyerName},`,
    "",
    `Merci pour votre paiement ! Votre transaction ${reference} a bien été validée.`,
    "",
    "Voici vos billets :",
    ...lines,
    ...(issuedTicketLines(order).length
      ? ["", "Vos liens de billets :", ...issuedTicketLines(order)]
      : []),
    "",
    `Montant payé : ${amount}`,
    "",
    `Rendez-vous le ${EVENT_LINE}.`,
    "",
    "Pour toute question, répondez simplement à cet e-mail.",
    "",
    "L'équipe d'organisation — ACNU Gala & Awards 2027",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f1ea;color:#23201b;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="background:#1a1713;color:#f5f2ec;padding:28px 32px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;font-size:22px;">ACNU Gala &amp; Awards 2027</h1>
      <p style="margin:8px 0 0;color:#cfccc6;">Votre paiement est validé</p>
    </div>
    <div style="background:#ffffff;padding:28px 32px;border-radius:0 0 12px 12px;">
      <p style="margin:0 0 16px;">Bonjour <strong>${escapeHtml(buyerName)}</strong>,</p>
      <p style="margin:0 0 16px;">Merci pour votre paiement ! Votre transaction <strong>${escapeHtml(reference)}</strong> a bien été validée.</p>
      <p style="margin:0 0 4px;font-weight:bold;">Voici vos billets :</p>
      ${buyerTicketListHtml(order)}
      ${issuedTicketListHtml(order) ? `<p style="margin:16px 0 4px;font-weight:bold;">Vos liens de billets :</p>${issuedTicketListHtml(order)}` : ""}
      <p style="margin:20px 0 0;">Montant payé : <strong>${escapeHtml(amount)}</strong></p>
      <p style="margin:16px 0 0;">Rendez-vous le ${escapeHtml(EVENT_LINE)}.</p>
      <p style="margin:16px 0 0;color:#6b6660;">Pour toute question, répondez simplement à cet e-mail.</p>
      <p style="margin:28px 0 0;color:#6b6660;">L'équipe d'organisation — ACNU Gala &amp; Awards 2027</p>
    </div>
  </div>
</body>
</html>`;

  return {
    from: fromAddress(),
    to: buyerEmail,
    replyTo: fromAddress(),
    subject: sanitizeHeader(subject),
    text,
    html,
  };
}

function createTransport(mailUser, mailPass) {
  return nodemailer.createTransport({
    host: HOST_SMTP,
    port: SMTP_PORT,
    secure: true,
    auth: { user: mailUser, pass: mailPass },
    connectionTimeout: SMTP_TIMEOUT,
    greetingTimeout: SMTP_TIMEOUT,
    socketTimeout: SMTP_TIMEOUT,
  });
}

async function deliver(type, orderRef, message) {
  const reference = sanitizeHeader(orderRef);
  const dryRun = String(process.env.MAIL_DRY_RUN || "") === "1";

  if (dryRun) {
    console.log(`mail dry-run type=${type} ref=${reference} subject=${message.subject}`);
    return { ok: true, dryRun: true };
  }

  if (!message.to || !isValidEmail(message.to)) {
    console.warn(`mail ${type} ref=${reference} skipped: no valid email`);
    return { ok: false, skipped: true, error: "NO_VALID_EMAIL" };
  }

  const mailUser = sanitizeHeader(process.env.MAIL_USER || "");
  const mailPass = process.env.MAIL_APP_PASSWORD || "";
  if (!mailUser || !mailPass || !isValidEmail(mailUser)) {
    console.warn(`mail ${type} ref=${reference} skipped: no credentials`);
    return { ok: false, skipped: true, error: "NO_CREDENTIALS" };
  }

  const transporter = createTransport(mailUser, mailPass);
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("mail timeout");
        error.code = "ETIMEDOUT";
        reject(error);
      }, SMTP_TIMEOUT);
      if (timer.unref) timer.unref();
    });
    const info = await Promise.race([transporter.sendMail(message), timeout]);
    console.log(`mail ${type} ref=${reference} ok`);
    return {
      ok: true,
      messageId: info && info.messageId,
      accepted: (info && info.accepted) || [],
    };
  } catch (error) {
    console.error(
      `mail ${type} ref=${reference} failed code=${error && error.code ? error.code : "unknown"}`
    );
    return { ok: false, error: error && error.code ? error.code : "unknown" };
  } finally {
    clearTimeout(timer);
    try {
      transporter.close();
    } catch (error) {
      /* ignore */
    }
  }
}

export async function sendOrderConfirmation(order) {
  if (!isValidEmail(order && order.email)) {
    console.warn(
      `mail confirmation ref=${sanitizeHeader(order && order.id)} skipped: no valid email`
    );
    return { skipped: true };
  }

  const orderId = stripControls(order.id);
  const buyerName = stripControls(order.name);
  const tier = stripControls(label(TIER_LABELS, order.tier, order.tier));
  const qty = Number.isFinite(Number(order.qty)) ? Number(order.qty) : 0;
  const amount = formatFcfa(order.amount);
  const payMethod = stripControls(
    label(PAY_METHOD_LABELS, order.payMethod, order.payMethod)
  );
  const payRef = stripControls(order.ref);
  const orderDate = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Douala",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(
    order.createdAt && !Number.isNaN(new Date(order.createdAt).getTime())
      ? new Date(order.createdAt)
      : new Date()
  );
  const hasProof = order.proofUrl ? "Oui" : "Non";
  const subject = `ACNU Gala & Awards 2027 — Réception de votre commande ${orderId}`;

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
      <p style="margin:0 0 16px;">Bonjour <strong>${escapeHtml(buyerName)}</strong>,</p>
      <p style="margin:0 0 20px;">Nous vous confirmons la bonne réception de votre commande pour le Gala &amp; Awards 2027.</p>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="padding:8px 0;color:#6b6660;">Référence de transaction</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(orderId)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Nom de l'acheteur</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(buyerName)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Catégorie de billet</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(tier)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Quantité</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${qty}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Montant</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(amount)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Moyen de paiement</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(payMethod)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Référence de paiement</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(payRef)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Date de la commande</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${escapeHtml(orderDate)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6660;">Preuve de paiement reçue</td><td style="padding:8px 0;text-align:right;font-weight:bold;">${hasProof}</td></tr>
      </table>
      <div style="margin:24px 0 0;background:#f7f4ec;border-left:4px solid #d8a13e;padding:16px 20px;border-radius:0 8px 8px 0;">
        <p style="margin:0 0 6px;color:#6b6660;">Statut de votre paiement</p>
        <p style="margin:0;font-weight:bold;">En attente de vérification par l'administrateur des paiements.</p>
        <p style="margin:8px 0 0;color:#6b6660;">Vos billets vous seront transmis dès que la vérification sera terminée.</p>
      </div>
      <p style="margin:20px 0 0;color:#6b6660;">
        Conservez précieusement votre référence de transaction (<strong>${escapeHtml(orderId)}</strong>)
        et votre référence de paiement (<strong>${escapeHtml(payRef)}</strong>).
      </p>
      <p style="margin:28px 0 0;color:#6b6660;">L'équipe ACNU Gala &amp; Awards 2027</p>
    </div>
  </div>
</body>
</html>`;

  const message = {
    from: fromAddress(),
    to: stripControls(order.email),
    subject: sanitizeHeader(subject),
    text,
    html,
  };
  if (process.env.MAIL_BCC) {
    message.bcc = sanitizeHeader(process.env.MAIL_BCC);
  }

  return deliver("confirmation", orderId, message);
}

export async function sendAdminNewTransactionEmail(order) {
  return deliver("admin", order && order.id, buildAdminEmail(order));
}

export async function sendBuyerApprovalEmail(order) {
  const reference = sanitizeHeader(order && order.id);
  if (!isValidEmail(order && order.email)) {
    console.warn(`mail buyer ref=${reference} skipped: no valid email`);
    return { ok: false, skipped: true, error: "NO_VALID_EMAIL" };
  }
  return deliver("buyer", reference, buildBuyerApprovalEmail(order));
}
