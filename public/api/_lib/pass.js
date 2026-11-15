import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PASS_LAYOUT } from "./pass-layout.js";
import { makeQrPng } from "./qr.js";

const INK = rgb(0.1, 0.08, 0.06);
const FALLBACK_NAME = "Participant";
const MIN_NAME_SIZE = 10;
const MAX_NAME_SIZE = 40;
const NAME_FONT = StandardFonts.TimesRomanBold;
const CODE_FONT = StandardFonts.Courier;
const TIER_LABELS = Object.freeze({
  premium: "Premium",
  vip: "VIP",
  classic: "Classic",
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

function stripAccents(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0152/g, "OE")
    .replace(/\u0153/g, "oe")
    .replace(/\u00C6/g, "AE")
    .replace(/\u00E6/g, "ae")
    .replace(/\u00D8/g, "O")
    .replace(/\u00F8/g, "o");
}

function fileSafe(value) {
  return stripAccents(value)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function passFileName(ticket) {
  const tier = ticket && PASS_LAYOUT[ticket.tier] ? ticket.tier : "classic";
  const holder =
    tier === "premium"
      ? String((ticket && ticket.participant_index) ?? "1").trim() || "1"
      : cleanText(ticket && ticket.participant_name) || FALLBACK_NAME;
  const safe = fileSafe(holder) || (tier === "premium" ? "1" : FALLBACK_NAME);
  return `Billet-${TIER_LABELS[tier]}-${safe}.pdf`;
}

function breakWord(word, font, size, maxWidth) {
  const chunks = [];
  let chunk = "";
  for (const char of word) {
    const candidate = chunk + char;
    if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      chunks.push(chunk);
      chunk = char;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function wrapLines(text, font, size, maxWidth) {
  const words = cleanText(text).split(" ").filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      if (line) {
        lines.push(line);
        line = "";
      }
      const chunks = breakWord(word, font, size, maxWidth);
      for (let index = 0; index < chunks.length - 1; index += 1) {
        lines.push(chunks[index]);
      }
      line = chunks[chunks.length - 1] || "";
      continue;
    }

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

function fitName(text, font, box) {
  const boxWidth = box.x2 - box.x1;
  const boxHeight = box.y2 - box.y1;
  const pad = Math.max(4, Math.min(boxWidth, boxHeight) * 0.08);
  const maxWidth = boxWidth - pad * 2;
  const maxHeight = boxHeight - pad * 2;
  const maxSize = Math.min(MAX_NAME_SIZE, maxHeight * 0.9);

  if (maxSize > MIN_NAME_SIZE) {
    let lo = MIN_NAME_SIZE;
    let hi = maxSize;
    let best = 0;
    while (hi - lo > 0.25) {
      const mid = (lo + hi) / 2;
      if (font.widthOfTextAtSize(text, mid) <= maxWidth) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    if (best >= MIN_NAME_SIZE) {
      return { lines: [text], size: Math.floor(best * 2) / 2, wrapped: false };
    }
  }

  const lines = fitLines(text, font, MIN_NAME_SIZE, maxWidth, 2);
  return { lines, size: MIN_NAME_SIZE, wrapped: lines.length > 1 };
}

function fitTableNumber(text, font, box) {
  const boxWidth = box.x2 - box.x1;
  const boxHeight = box.y2 - box.y1;
  const pad = Math.max(2, Math.min(boxWidth, boxHeight) * 0.1);
  const maxWidth = boxWidth - pad * 2;
  const maxHeight = boxHeight - pad * 2;
  let lo = 8;
  let hi = Math.max(lo, Math.min(48, maxHeight / 0.78));
  let best = lo;
  while (hi - lo > 0.25) {
    const mid = (lo + hi) / 2;
    if (
      font.widthOfTextAtSize(text, mid) <= maxWidth &&
      mid * 0.78 <= maxHeight
    ) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Math.max(8, Math.floor(best * 2) / 2);
}

function layoutQr(box, code, font) {
  const boxWidth = box.x2 - box.x1;
  const boxHeight = box.y2 - box.y1;
  const pad = Math.min(boxWidth, boxHeight) * 0.04;
  const maxCodeWidth = boxWidth - pad * 2;

  let codeSize = Math.min(10, boxHeight * 0.055);
  let codeWidth = font.widthOfTextAtSize(code, codeSize);
  if (codeWidth > maxCodeWidth) {
    codeSize = Math.max(4.5, (codeSize * maxCodeWidth) / codeWidth);
    codeWidth = font.widthOfTextAtSize(code, codeSize);
  }

  const codeLine = codeSize * 1.15;
  const gap = Math.max(2, codeSize * 0.25);
  let qrSize = Math.min(boxWidth - pad * 2, boxHeight - pad * 2 - codeLine - gap);
  let drawCode = qrSize > 20;
  if (!drawCode) {
    qrSize = Math.min(boxWidth - pad * 2, boxHeight - pad * 2);
  }

  return { pad, codeSize, codeWidth, codeLine, gap, qrSize, drawCode };
}

function drawCenteredText(page, text, options) {
  const width = options.font.widthOfTextAtSize(text, options.size);
  page.drawText(text, {
    x: options.x + (options.width - width) / 2,
    y: options.y,
    font: options.font,
    size: options.size,
    color: options.color,
  });
}

function drawName(page, font, text, box, pageHeight) {
  const fit = fitName(text, font, box);
  const center = pageHeight - (box.y1 + box.y2) / 2;
  const width = box.x2 - box.x1;

  if (fit.lines.length === 1) {
    drawCenteredText(page, fit.lines[0], {
      x: box.x1,
      width,
      y: center - fit.size * 0.3,
      font,
      size: fit.size,
      color: INK,
    });
  } else {
    const leading = fit.size * 1.02;
    const first = center + leading / 2 - fit.size * 0.3;
    fit.lines.forEach((line, index) => {
      drawCenteredText(page, line, {
        x: box.x1,
        width,
        y: first - index * leading,
        font,
        size: fit.size,
        color: INK,
      });
    });
  }

  return fit;
}

function drawTableNumber(page, font, text, box, pageHeight) {
  const size = fitTableNumber(text, font, box);
  const center = pageHeight - (box.y1 + box.y2) / 2;
  drawCenteredText(page, text, {
    x: box.x1,
    width: box.x2 - box.x1,
    y: center - size * 0.33,
    font,
    size,
    color: INK,
  });
  return size;
}

async function drawQrAndCode(page, pdf, qrBox, code, codeFont, pageHeight, url) {
  const layout = layoutQr(qrBox, code, codeFont);
  const qrPng = await makeQrPng(url, {
    width: Math.min(1000, Math.max(300, Math.round(layout.qrSize * 4))),
  });
  const image = await pdf.embedPng(qrPng);
  const boxWidth = qrBox.x2 - qrBox.x1;
  const x = qrBox.x1 + (boxWidth - layout.qrSize) / 2;
  const y = pageHeight - qrBox.y1 - layout.pad - layout.qrSize;
  page.drawImage(image, {
    x,
    y,
    width: layout.qrSize,
    height: layout.qrSize,
  });

  if (layout.drawCode) {
    const remainingTop = qrBox.y1 + layout.pad + layout.qrSize + layout.gap;
    const remainingBottom = qrBox.y2 - layout.pad;
    const centerTop = (remainingTop + remainingBottom) / 2;
    drawCenteredText(page, code, {
      x: qrBox.x1,
      width: boxWidth,
      y: pageHeight - centerTop - layout.codeSize * 0.33,
      font: codeFont,
      size: layout.codeSize,
      color: INK,
    });
  }

  return layout;
}

export async function inspectPassLayout(ticket) {
  const tier = ticket && PASS_LAYOUT[ticket.tier] ? ticket.tier : "classic";
  const config = PASS_LAYOUT[tier];
  const code = cleanText(ticket && ticket.code).toUpperCase();
  const pdf = await PDFDocument.create();
  const nameFont = await pdf.embedFont(NAME_FONT);
  const codeFont = await pdf.embedFont(CODE_FONT);
  const qr = layoutQr(config.qrBox, code, codeFont);

  if (tier === "premium") {
    const table = String((ticket && ticket.participant_index) ?? "1").trim() || "1";
    return {
      tier,
      table: { text: table, size: fitTableNumber(table, nameFont, config.tableBox) },
      qr: { size: qr.qrSize, codeSize: qr.codeSize, drawCode: qr.drawCode },
    };
  }

  const participant = cleanText(ticket && ticket.participant_name) || FALLBACK_NAME;
  const fit = fitName(participant, nameFont, config.nameBox);
  return {
    tier,
    name: {
      text: participant,
      size: fit.size,
      wrapped: fit.wrapped,
      lines: fit.lines,
    },
    qr: { size: qr.qrSize, codeSize: qr.codeSize, drawCode: qr.drawCode },
  };
}

export async function buildTicketPdf(ticket, { url } = {}) {
  if (!url) throw new Error("MISSING_TICKET_URL");
  if (!ticket || !ticket.code) throw new Error("MISSING_TICKET");

  const tier = PASS_LAYOUT[ticket.tier] ? ticket.tier : "classic";
  const config = PASS_LAYOUT[tier];
  const code = cleanText(ticket.code).toUpperCase();
  const participant = cleanText(ticket.participant_name) || FALLBACK_NAME;
  const tableNumber =
    String(ticket.participant_index ?? "1").trim() || "1";

  const templateUrl = new URL("./assets/" + config.template, import.meta.url);
  let templateBytes;
  try {
    templateBytes = await readFile(templateUrl);
  } catch (error) {
    console.warn(
      "pass template missing tier=" + tier + " code=" + ((error && error.code) || "unknown")
    );
    throw new Error("MISSING_TEMPLATE");
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle("Billet " + code + " - " + TIER_LABELS[tier]);
  pdf.setAuthor("ACNU Gala & Awards");
  pdf.setSubject("Billet Gala & Awards 2027");
  pdf.setCreator("ACNU Gala & Awards");

  const image = isJpeg(templateBytes)
    ? await pdf.embedJpg(templateBytes)
    : await pdf.embedPng(templateBytes);
  const pageWidth = image.width;
  const pageHeight = image.height;
  const page = pdf.addPage([pageWidth, pageHeight]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });

  const nameFont = await pdf.embedFont(NAME_FONT);
  const codeFont = await pdf.embedFont(CODE_FONT);

  if (tier === "premium") {
    drawTableNumber(page, nameFont, tableNumber, config.tableBox, pageHeight);
  } else {
    drawName(page, nameFont, participant, config.nameBox, pageHeight);
  }

  await drawQrAndCode(
    page,
    pdf,
    config.qrBox,
    code,
    codeFont,
    pageHeight,
    url
  );

  return pdf.save();
}
