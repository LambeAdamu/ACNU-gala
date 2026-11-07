import { readFileSync } from "node:fs";

const ASSET_DIR = new URL("../_assets/email/", import.meta.url);

export const MAIL_IMAGE_CIDS = Object.freeze({
  logo: "acnu-logo",
  watermarkLight: "acnu-wm-light",
  watermarkDark: "acnu-wm-dark",
});

const ASSET_FILES = Object.freeze({
  logo: "logo.png",
  watermarkLight: "watermark-light.png",
  watermarkDark: "watermark-dark.png",
});

const loaded = {};

for (const key of Object.keys(ASSET_FILES)) {
  const file = ASSET_FILES[key];
  try {
    loaded[key] = readFileSync(new URL(file, ASSET_DIR));
  } catch {
    console.warn(`mail-assets: ${file} unavailable`);
  }
}

export function hasMailImage(key) {
  return Boolean(loaded[key]);
}

export function getMailAttachments() {
  const attached = ["logo", "watermarkLight", "watermarkDark"];
  return attached
    .filter((key) => loaded[key])
    .map((key) => ({
      filename: ASSET_FILES[key],
      content: loaded[key],
      cid: MAIL_IMAGE_CIDS[key],
      contentType: "image/png",
      contentDisposition: "inline",
    }));
}
