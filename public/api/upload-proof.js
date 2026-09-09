/* Gala & Awards 2027 — ACNU. api/upload-proof.js (Vercel Serverless Function).
 * Receives a payment-proof file (multipart/form-data: transactionId + proof),
 * validates type + size, and stores the bytes in the Postgres `proofs` table.
 * Uses the Web Fetch API export shape (`{ fetch }`) for the Node.js runtime.
 *
 * Env: DATABASE_URL (Postgres/Neon connection string). */

import pg from "pg";

const { Pool } = pg;

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const ALLOWED_CONTENT_TYPE = /^image\/(png|jpe?g|webp)$|^application\/pdf$/;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
    }

    let form;
    try {
      form = await request.formData();
    } catch (e) {
      return Response.json({ ok: false, error: "Corps de requête invalide." }, { status: 400 });
    }

    const transactionId = String(form.get("transactionId") || "").trim();
    const file = form.get("proof");

    if (!transactionId) {
      return Response.json({ ok: false, error: "transactionId manquant." }, { status: 400 });
    }

    const isFile = file && typeof file.arrayBuffer === "function" && typeof file.name === "string";
    if (!isFile || file.size === 0) {
      return Response.json({ ok: false, error: "Fichier manquant." }, { status: 400 });
    }

    if (!ALLOWED_CONTENT_TYPE.test(file.type)) {
      return Response.json({ ok: false, error: "Format non autorisé (PNG/JPG/WebP ou PDF)." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ ok: false, error: "Fichier trop volumineux (max 8 Mo)." }, { status: 413 });
    }

    let buffer;
    try {
      buffer = Buffer.from(await file.arrayBuffer());
    } catch (e) {
      return Response.json({ ok: false, error: "Lecture du fichier impossible." }, { status: 400 });
    }

    try {
      const res = await pool.query(
        `INSERT INTO proofs (transaction_id, file_data, content_type, file_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (transaction_id) DO UPDATE SET
           file_data    = EXCLUDED.file_data,
           content_type = EXCLUDED.content_type,
           file_name    = EXCLUDED.file_name,
           uploaded_at  = now()
         RETURNING id, uploaded_at`,
        [transactionId, buffer, file.type, file.name]
      );

      return Response.json({
        ok: true,
        id: res.rows[0].id,
        url: "/api/proof/" + encodeURIComponent(transactionId),
        uploadedAt: res.rows[0].uploaded_at,
      });
    } catch (e) {
      console.error("upload-proof DB error:", e);
      return Response.json({ ok: false, error: "Échec de l'enregistrement de la preuve." }, { status: 500 });
    }
  },
};