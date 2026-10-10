/* Gala & Awards 2027 — ACNU. cloudinary-config.js: public Cloudinary values for
 * unsigned direct uploads from the browser. Keep in sync with .env's
 * CLOUDINARY_CLOUD_NAME / CLOUDINARY_UNSIGNED_PRESET.
 *
 * Chosen integration: unsigned direct upload with a LOCKED preset. The cloud
 * name + preset are meant to be public, so the preset itself is what keeps the
 * account safe. In the Cloudinary dashboard, the preset `gala_proofs_unsigned`
 * MUST be restricted to:
 *   • Folder:          gala-proofs
 *   • Allowed formats: jpg, jpeg, png, webp, pdf
 *   • Max file size:   8 MB  (mirrors MAX_PROOF_BYTES in payments.js / api/orders.js)
 * Without those restrictions anyone could push arbitrary files to the account.
 * Exposed on `window` (not a bare const) because payments.js reads window.CloudConfig. */
window.CloudConfig = {
  cloudName: "zettrr65",
  unsignedPreset: "gala_proofs_unsigned",
};