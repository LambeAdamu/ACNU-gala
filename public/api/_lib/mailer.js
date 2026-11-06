import nodemailer from "nodemailer";
import { MAIL } from "./config.js";

const HOST = "smtp.gmail.com";
const PORT = 465;
const TIMEOUT_MS = 10000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let transporter = null;

function cleanHeader(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function isValidEmail(value) {
  const email = cleanHeader(value);
  return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email);
}

function normalizeRecipients(value) {
  const list = Array.isArray(value) ? value : [value];
  const recipients = list.map(cleanHeader).filter(Boolean);
  if (!recipients.length || recipients.some((email) => !isValidEmail(email))) {
    return { ok: false, error: "INVALID_RECIPIENT" };
  }
  return { ok: true, recipients };
}

function formatFrom() {
  const name = cleanHeader(MAIL.fromName).replace(/"/g, "'");
  return `"${name}" <${MAIL.user}>`;
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: true,
      auth: { user: MAIL.user, pass: MAIL.appPassword },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, text, html, from, attachments } = {}) {
  try {
    const recipientCheck = normalizeRecipients(to);
    if (!recipientCheck.ok) return recipientCheck;

    const safeSubject = cleanHeader(subject) || "(sans objet)";
    const safeFrom = cleanHeader(from) ? cleanHeader(from) : formatFrom();

    if (MAIL.dryRun) {
      console.log(`[mail:dry-run] to=${recipientCheck.recipients.join(",")} subject=${safeSubject}`);
      return { ok: true, dryRun: true };
    }

    if (!MAIL.user || !MAIL.appPassword) {
      return { ok: false, error: "MAIL_NOT_CONFIGURED" };
    }

    const info = await getTransporter().sendMail({
      from: safeFrom,
      to: recipientCheck.recipients.join(", "),
      subject: safeSubject,
      text,
      html,
      attachments,
    });

    return { ok: true, messageId: info.messageId, accepted: info.accepted || [] };
  } catch (error) {
    const code = (error && error.code) || "MAIL_SEND_FAILED";
    console.error(`mailer: send failed. code=${code}`);
    return { ok: false, error: code };
  }
}
