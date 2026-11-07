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
import { getMailAttachments, hasMailImage, MAIL_IMAGE_CIDS } from "./mail-assets.js";
import { buildTicketPdf } from "./pass.js";
import { makeQrPng, ticketUrl } from "./qr.js";

const HOST_SMTP = "smtp.gmail.com";
const SMTP_PORT = 465;
const SMTP_TIMEOUT = 8000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

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

const HEADER_BG = "#1a1713";
const BODY_BG = "#ffffff";
const WATERMARK_CLASS = "acnu-wm";

function logoHtml() {
  if (!hasMailImage("logo")) return "";
  const cid = MAIL_IMAGE_CIDS.logo;
  return `<!--[if mso]><v:oval xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" style="width:56px;height:56px;" fillcolor="${HEADER_BG}" strokecolor="${HEADER_BG}"><v:imagedata src="cid:${cid}" o:title="Logo ACNU" /></v:oval><![endif]--><!--[if !mso]><!-- --><img src="cid:${cid}" alt="Logo ACNU" width="56" height="56" style="display:block;width:56px;height:56px;border:0;border-radius:50%;" /><!--<![endif]-->`;
}

function emailStyleBlock() {
  if (!hasMailImage("watermarkDark")) return "";
  const dark = MAIL_IMAGE_CIDS.watermarkDark;
  return `<style>@media (prefers-color-scheme: dark){.${WATERMARK_CLASS}{background-image:url(cid:${dark})!important;}}</style>`;
}

function watermarkCellOpen(backgroundColor, size) {
  if (!hasMailImage("watermarkLight")) {
    return `<td align="left" valign="middle" style="background-color:${backgroundColor};">`;
  }
  const light = MAIL_IMAGE_CIDS.watermarkLight;
  const css = `background-color:${backgroundColor};background-image:url(cid:${light});background-repeat:no-repeat;background-position:center;background-size:${size};`;
  return `<!--[if !mso]><!-- --><td class="${WATERMARK_CLASS}" align="left" valign="middle" background="cid:${light}" style="${css}"><!--<![endif]--><!--[if mso]><td align="left" valign="middle" style="background-color:${backgroundColor};"><![endif]-->`;
}

function headerHtml(subtitle) {
  const logo = logoHtml();
  const text = `<h1 style="margin:0;font-size:22px;">ACNU Gala &amp; Awards 2027</h1><p style="margin:8px 0 0;color:#cfccc6;">${escapeHtml(subtitle)}</p>`;
  const content = logo
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="56" height="56" valign="middle" style="width:56px;height:56px;">${logo}</td><td width="16" style="width:16px;font-size:0;line-height:0;">&nbsp;</td><td valign="middle">${text}</td></tr></table>`
    : text;
  return `<div style="background:${HEADER_BG};color:#f5f2ec;padding:28px 32px;border-radius:12px 12px 0 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${HEADER_BG};">
    <tr>${watermarkCellOpen(HEADER_BG, "120px auto")}${content}</td></tr>
  </table>
</div>`;
}

function bodyOpen() {
  return `<div style="background:${BODY_BG};padding:28px 32px;border-radius:0 0 12px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BODY_BG};">
    <tr>${watermarkCellOpen(BODY_BG, "300px auto")}`;
}

function bodyClose() {
  return `</td></tr></table></div>`;
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
        tierKey: stripControls(ticket.tier),
        tier: stripControls(label(TIER_LABELS, ticket.tier, ticket.tier)),
        name: stripControls(ticket.participantName),
        status: stripControls(ticket.status) || "valid",
        issuedAt: ticket.issuedAt || ticket.issued_at || "",
        usedAt: ticket.usedAt || ticket.used_at || "",
        participantIndex: ticket.participantIndex ?? ticket.participant_index,
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

function issuedTicketCardsHtml(items, qrCodes) {
  if (!items.length) return "";
  return items
    .map((ticket) => {
      const qr = qrCodes.has(ticket.code)
        ? `<img src="cid:qr-${ticket.code}" alt="QR ${escapeHtml(ticket.code)}" width="160" height="160" style="display:block;width:160px;height:160px;border:0;background:#ffffff;padding:8px;border-radius:8px;margin:0 auto 10px;" />`
        : "";
      return `<div style="margin:16px 0;padding:16px;border:1px solid #e5e0d8;border-radius:12px;text-align:center;">
        ${qr}
        <p style="margin:0 0 4px;font-weight:bold;">${escapeHtml(ticket.name || "Participant")}</p>
        <p style="margin:0 0 6px;color:#6b6660;">${escapeHtml(ticket.tier)}</p>
        <p style="margin:0;font-size:12px;word-break:break-all;"><a href="${escapeHtml(ticket.link)}">${escapeHtml(ticket.link)}</a></p>
      </div>`;
    })
    .join("");
}

async function buildIssuedTicketAttachments(items) {
  const qrAttachments = [];
  const pdfAttachments = [];
  const qrCodes = new Set();

  for (const ticket of items) {
    try {
      const png = await makeQrPng(ticketUrl(ticket.code, siteUrl()), { width: 400 });
      qrAttachments.push({
        filename: `qr-${ticket.code}.png`,
        content: png,
        cid: `qr-${ticket.code}`,
        contentType: "image/png",
        contentDisposition: "inline",
      });
      qrCodes.add(ticket.code);
    } catch (error) {
      console.warn(
        `mail buyer qr skipped code=${ticket.code} error=${(error && error.code) || "unknown"}`
      );
    }

    try {
      const bytes = await buildTicketPdf(
        {
          code: ticket.code,
          transaction_id: "",
          tier: ticket.tierKey,
          participant_name: ticket.name,
          participant_index: ticket.participantIndex,
          status: ticket.status,
          issued_at: ticket.issuedAt,
          used_at: ticket.usedAt,
        },
        { url: ticket.link }
      );
      pdfAttachments.push({
        filename: `billet-${ticket.code}.pdf`,
        content: Buffer.from(bytes),
        contentType: "application/pdf",
        contentDisposition: "attachment",
      });
    } catch (error) {
      console.warn(
        `mail buyer pdf skipped code=${ticket.code} error=${(error && error.code) || "unknown"}`
      );
    }
  }

  return { qrAttachments, pdfAttachments, qrCodes };
}

function attachmentBytes(attachments) {
  return attachments.reduce(
    (total, attachment) =>
      total +
      (attachment && attachment.content && attachment.content.length
        ? attachment.content.length
        : 0),
    0
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

export async function buildBuyerApprovalEmail(order) {
  const buyerEmail = sanitizeHeader(order && order.email);
  const buyerName = stripControls(order && order.name);
  const amount = formatFcfa(order && order.amount);
  const subject = "Votre paiement est validé — Gala & Awards 2027";
  const lines = buyerTicketLines(order);
  const items = issuedTicketItems(order);
  const { qrAttachments, pdfAttachments, qrCodes } =
    await buildIssuedTicketAttachments(items);

  const branding = getMailAttachments();
  let attachments = [...branding, ...qrAttachments, ...pdfAttachments];
  if (
    pdfAttachments.length &&
    attachmentBytes(attachments) > MAX_ATTACHMENT_BYTES
  ) {
    console.warn("mail buyer pdf skipped: attachments exceed 15 MB");
    attachments = [...branding, ...qrAttachments];
  }

  const text = [
    `Bonjour ${buyerName},`,
    "",
    "Merci pour votre paiement ! Votre commande a bien été validée.",
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
<head><meta charset="utf-8">${emailStyleBlock()}</head>
<body style="margin:0;padding:0;background:#f4f1ea;color:#23201b;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    ${headerHtml("Votre paiement est validé")}
    ${bodyOpen()}
      <p style="margin:0 0 16px;">Bonjour <strong>${escapeHtml(buyerName)}</strong>,</p>
      <p style="margin:0 0 16px;">Merci pour votre paiement ! Votre commande a bien été validée.</p>
      <p style="margin:0 0 4px;font-weight:bold;">Voici vos billets :</p>
      ${buyerTicketListHtml(order)}
      ${items.length ? `<p style="margin:16px 0 4px;font-weight:bold;">Vos billets et QR codes :</p>${issuedTicketCardsHtml(items, qrCodes)}` : ""}
      <p style="margin:20px 0 0;">Montant payé : <strong>${escapeHtml(amount)}</strong></p>
      <p style="margin:16px 0 0;">Rendez-vous le ${escapeHtml(EVENT_LINE)}.</p>
      <p style="margin:16px 0 0;color:#6b6660;">Pour toute question, répondez simplement à cet e-mail.</p>
      <p style="margin:28px 0 0;color:#6b6660;">L'équipe d'organisation — ACNU Gala &amp; Awards 2027</p>
    ${bodyClose()}
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
    attachments,
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

export function buildOrderConfirmationEmail(order) {
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
  const subject = "ACNU Gala & Awards 2027 — Réception de votre commande";

  const text = [
    `Bonjour ${buyerName},`,
    "",
    "Nous vous confirmons la bonne réception de votre commande.",
    "",
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
    `Conservez précieusement votre référence de paiement (${payRef}).`,
    "",
    "L'équipe ACNU Gala & Awards 2027",
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8">${emailStyleBlock()}</head>
<body style="margin:0;padding:0;background:#f4f1ea;color:#23201b;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    ${headerHtml("Réception de votre commande")}
    ${bodyOpen()}
      <p style="margin:0 0 16px;">Bonjour <strong>${escapeHtml(buyerName)}</strong>,</p>
      <p style="margin:0 0 20px;">Nous vous confirmons la bonne réception de votre commande pour le Gala &amp; Awards 2027.</p>
      <table style="border-collapse:collapse;width:100%;">
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
        Conservez précieusement votre référence de paiement (<strong>${escapeHtml(payRef)}</strong>).
      </p>
      <p style="margin:28px 0 0;color:#6b6660;">L'équipe ACNU Gala &amp; Awards 2027</p>
    ${bodyClose()}
  </div>
</body>
</html>`;

  const message = {
    from: fromAddress(),
    to: stripControls(order.email),
    subject: sanitizeHeader(subject),
    text,
    html,
    attachments: getMailAttachments(),
  };
  if (process.env.MAIL_BCC) {
    message.bcc = sanitizeHeader(process.env.MAIL_BCC);
  }

  return message;
}

export async function sendOrderConfirmation(order) {
  if (!isValidEmail(order && order.email)) {
    console.warn(
      `mail confirmation ref=${sanitizeHeader(order && order.id)} skipped: no valid email`
    );
    return { skipped: true };
  }

  try {
    const message = buildOrderConfirmationEmail(order);
    return await deliver("confirmation", stripControls(order.id), message);
  } catch (error) {
    console.error(
      `mail confirmation ref=${stripControls(order.id)} build failed code=${(error && error.code) || "unknown"}`
    );
    return { ok: false, error: "MAIL_BUILD_FAILED" };
  }
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
  try {
    const message = await buildBuyerApprovalEmail(order);
    return await deliver("buyer", reference, message);
  } catch (error) {
    console.error(
      `mail buyer ref=${reference} build failed code=${(error && error.code) || "unknown"}`
    );
    return { ok: false, error: "MAIL_BUILD_FAILED" };
  }
}
