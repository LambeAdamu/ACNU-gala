import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const publicPackage = path.join(scriptDir, "..", "public", "package.json");
const requirePublic = createRequire(publicPackage);
const jsQR = requirePublic("jsqr");
const { PNG } = requirePublic("pngjs");

process.env.SITE_URL = process.env.SITE_URL || "https://acnu-gala.vercel.app";

try {
  const codes = await import("../public/api/_lib/codes.js");
  const qr = await import("../public/api/_lib/qr.js");

  const code = codes.generateTicketCode();
  const url = qr.ticketUrl(code);
  const pngBuffer = await qr.makeQrPng(url);
  const png = PNG.sync.read(pngBuffer);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

  assert.ok(decoded, "QR could not be decoded");
  assert.equal(decoded.data, url, "Decoded QR text does not match the ticket URL");

  const seen = new Set();
  for (let i = 0; i < 10000; i += 1) {
    const generated = codes.generateTicketCode();
    assert.equal(generated.length, codes.CODE_LENGTH);
    assert.ok(codes.isValidCodeFormat(generated), `Invalid code format: ${generated}`);
    assert.ok(!seen.has(generated), `Duplicate code generated: ${generated}`);
    seen.add(generated);
  }

  console.log(`QR decode: ok (${url})`);
  console.log(`Codes: ok (10000 unique, length ${codes.CODE_LENGTH}, alphabet ${codes.CODE_ALPHABET.length})`);
  process.exit(0);
} catch (error) {
  console.log(`failed: ${error && error.message ? error.message : "unknown"}`);
  process.exit(1);
}
