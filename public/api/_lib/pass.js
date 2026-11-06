import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { EVENT } from "./config.js";
import { makeQrPng } from "./qr.js";

const PAGE_WIDTH = 420;
const PAGE_HEIGHT = 595;
const CARD = { x: 24, y: 24, width: 372, height: 248 };
const LEFT = CARD.x + 20;
const TEXT_WIDTH = 208;
const QR_SIZE = 104;
const QR_X = CARD.x + CARD.width - 20 - QR_SIZE;
const QR_Y = 112;

const INK = rgb(0.12, 0.1, 0.08);
const MUTED = rgb(0.38, 0.36, 0.33);
const WHITE = rgb(1, 1, 1);
const GOLD = rgb(0.68, 0.5, 0.18);
const TIER_ACCENTS = Object.freeze({
  premium: rgb(0.72, 0.55, 0.2),
  vip: rgb(0.48, 0.5, 0.56),
  classic: rgb(0.55, 0.38, 0.24),
});
const TIER_NAMES = Object.freeze({
  premium: "Premium",
  vip: "VIP",
  classic: "Classique",
});
const TEMPLATE_URLS = Object.freeze({
  premium: new URL("./assets/premium.jpg", import.meta.url),
  vip: new URL("./assets/vip.jpg", import.meta.url),
  classic: new URL("./assets/classic.jpg", import.meta.url),
});

function cleanText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/\u0152/g, "OE")
    .replace(/\u0153/g, "oe")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function isJpeg(bytes) {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}

function wrapLines(text, font, size, maxWidth) {
  const words = cleanText(text).split(" ").filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitLines(text, font, size, maxWidth, maxLines) {
  const lines = wrapLines(text, font, size, maxWidth);
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && font.widthOfTextAtSize(last + "...", size) > maxWidth) {
    last = last.slice(0, -1).trimEnd();
  }
  kept[maxLines - 1] = last + "...";
  return kept;
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Douala",
  }).format(date);
}

function statusText(ticket) {
  if (ticket.status === "used") {
    const usedAt = formatDate(ticket.used_at);
    return usedAt ? "Billet utilisé le " + usedAt : "Billet déjà utilisé";
  }
  if (ticket.status === "revoked") return "Ce billet a été annulé.";
  return "Valable une seule fois.";
}

function drawCentered(page, text, options) {
  const width = options.font.widthOfTextAtSize(text, options.size);
  page.drawText(text, {
    x: options.x + (options.width - width) / 2,
    y: options.y,
    font: options.font,
    size: options.size,
    color: options.color,
  });
}

export async function buildTicketPdf(ticket, { url } = {}) {
  if (!url) throw new Error("MISSING_TICKET_URL");
  if (!ticket || !ticket.code) throw new Error("MISSING_TICKET");

  const pdf = await PDFDocument.create();
  pdf.setTitle("Billet " + cleanText(ticket.code) + " - " + EVENT.name);
  pdf.setAuthor("ACNU Gala & Awards");
  pdf.setSubject("Billet Gala & Awards 2027");
  pdf.setCreator("ACNU Gala & Awards");

  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const tier = TIER_NAMES[ticket.tier] ? ticket.tier : "classic";
  const accent = TIER_ACCENTS[tier] || GOLD;
  const tierLabel = TIER_NAMES[tier];
  const participant = cleanText(ticket.participant_name) || "Participant";
  const code = cleanText(ticket.code).toUpperCase();
  const reference = cleanText(ticket.transaction_id);
  const issued = formatDate(ticket.issued_at);
  const eventDate = cleanText(EVENT.dateLabel);
  const venue = cleanText(EVENT.venue);

  const templateUrl = TEMPLATE_URLS[tier];
  let templateBytes = null;
  try {
    templateBytes = await readFile(templateUrl);
  } catch (error) {
    console.warn(
      "pass template missing tier=" + tier + " code=" + ((error && error.code) || "unknown")
    );
  }

  if (templateBytes) {
    const image = isJpeg(templateBytes)
      ? await pdf.embedJpg(templateBytes)
      : await pdf.embedPng(templateBytes);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
    });
  } else {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: rgb(0.08, 0.07, 0.06),
    });
  }

  page.drawRectangle({
    x: CARD.x,
    y: CARD.y,
    width: CARD.width,
    height: CARD.height,
    color: WHITE,
    opacity: 0.97,
    borderColor: rgb(0.84, 0.8, 0.73),
    borderWidth: 1,
  });
  page.drawRectangle({
    x: CARD.x,
    y: CARD.y + CARD.height - 4,
    width: CARD.width,
    height: 4,
    color: accent,
  });

  page.drawText(tierLabel.toUpperCase(), {
    x: LEFT,
    y: 246,
    font: bold,
    size: 10,
    color: accent,
  });
  page.drawText(EVENT.name, {
    x: LEFT,
    y: 228,
    font: bold,
    size: 15,
    color: INK,
  });

  const nameLines = fitLines(participant, bold, 18, TEXT_WIDTH, 2);
  nameLines.forEach((line, index) => {
    page.drawText(line, {
      x: LEFT,
      y: 202 - index * 20,
      font: bold,
      size: 18,
      color: INK,
    });
  });

  page.drawText(eventDate, {
    x: LEFT,
    y: 158,
    font: regular,
    size: 8.5,
    color: MUTED,
  });

  const venueLines = fitLines(venue, regular, 8.5, TEXT_WIDTH, 2);
  venueLines.forEach((line, index) => {
    page.drawText(line, {
      x: LEFT,
      y: 146 - index * 11,
      font: regular,
      size: 8.5,
      color: MUTED,
    });
  });

  if (reference) {
    page.drawText("Réf. " + reference, {
      x: LEFT,
      y: 118,
      font: regular,
      size: 8.5,
      color: MUTED,
    });
  }
  if (issued) {
    page.drawText("Émis le " + issued, {
      x: LEFT,
      y: 104,
      font: regular,
      size: 7.5,
      color: MUTED,
    });
  }

  page.drawText(statusText(ticket), {
    x: LEFT,
    y: 88,
    font: bold,
    size: 8.5,
    color: ticket.status === "valid" ? INK : accent,
  });

  const qrPng = await makeQrPng(url, { width: 600 });
  const qr = await pdf.embedPng(qrPng);
  page.drawRectangle({
    x: QR_X - 6,
    y: QR_Y - 6,
    width: QR_SIZE + 12,
    height: QR_SIZE + 12,
    color: WHITE,
    borderColor: rgb(0.88, 0.85, 0.8),
    borderWidth: 1,
  });
  page.drawImage(qr, {
    x: QR_X,
    y: QR_Y,
    width: QR_SIZE,
    height: QR_SIZE,
  });

  drawCentered(page, code, {
    x: QR_X - 6,
    y: 96,
    width: QR_SIZE + 12,
    font: mono,
    size: 9,
    color: INK,
  });
  drawCentered(page, "PRÉSENTEZ CE QR À L'ENTRÉE", {
    x: QR_X - 6,
    y: 84,
    width: QR_SIZE + 12,
    font: regular,
    size: 5.5,
    color: MUTED,
  });

  return pdf.save();
}
