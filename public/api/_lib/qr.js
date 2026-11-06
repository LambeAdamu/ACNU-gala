import QRCode from "qrcode";
import { isValidCodeFormat } from "./codes.js";
import { SITE_URL } from "./config.js";

export function ticketUrl(code, baseUrl = SITE_URL) {
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!isValidCodeFormat(normalized)) {
    throw new Error("Invalid ticket code format");
  }
  if (!baseUrl) {
    throw new Error("SITE_URL is not configured");
  }
  return `${String(baseUrl).replace(/\/+$/, "")}/t/${normalized}`;
}

export async function makeQrPng(url, { width = 600 } = {}) {
  return QRCode.toBuffer(String(url), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 4,
    width,
  });
}
