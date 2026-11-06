/* Gala & Awards 2027 — ACNU. api/tickets/[code].js
 * GET  /api/tickets/:code          public ticket lookup (no buyer PII)
 * GET  /api/tickets/:code?format=qr|pdf public QR image or PDF pass
 * POST /api/tickets/:code          admin check-in
 *
 * Env: DATABASE_URL, FIREBASE_WEB_API_KEY, SITE_URL. */

import pg from "pg";
import { verifyAdmin } from "../_lib/admin.js";
import { EVENT, SITE_URL } from "../_lib/config.js";
import { isValidCodeFormat } from "../_lib/codes.js";
import { buildTicketPdf } from "../_lib/pass.js";
import { makeQrPng, ticketUrl } from "../_lib/qr.js";
import { checkInTicket, toPublicTicket } from "../_lib/tickets.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function readCode(request) {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] || "").trim().toUpperCase();
}

function baseUrl(request) {
  return SITE_URL || new URL(request.url).origin;
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const code = readCode(request);

    if (!isValidCodeFormat(code)) {
      return json({ ok: false, error: "Code de billet invalide." }, 400);
    }

    if (request.method === "GET" && url.searchParams.get("format") === "qr") {
      try {
        const png = await makeQrPng(ticketUrl(code, baseUrl(request)));
        return new Response(png, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=86400, immutable",
          },
        });
      } catch (error) {
        console.error(
          "ticket QR error code=" + ((error && error.code) || "unknown")
        );
        return json({ ok: false, error: "QR code indisponible." }, 500);
      }
    }

    if (request.method === "GET") {
      try {
        const { rows } = await pool.query(
          `SELECT code, transaction_id, tier, participant_name, participant_index,
                  status, issued_at, used_at, used_by
             FROM tickets WHERE code = $1`,
          [code]
        );
        if (!rows.length) {
          return json({ ok: false, error: "Billet introuvable." }, 404);
        }

        if (url.searchParams.get("format") === "pdf") {
          const pdf = await buildTicketPdf(rows[0], {
            url: ticketUrl(code, baseUrl(request)),
          });
          return new Response(pdf, {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="billet-${code}.pdf"`,
              "Cache-Control": "no-store",
            },
          });
        }

        return json({
          ok: true,
          ticket: toPublicTicket(rows[0]),
          event: EVENT,
          ticketUrl: ticketUrl(code, baseUrl(request)),
          qrUrl: `/api/tickets/${code}?format=qr`,
          pdfUrl: `/api/tickets/${code}?format=pdf`,
        });
      } catch (error) {
        console.error(
          "ticket GET error code=" + ((error && error.code) || "unknown")
        );
        return json({ ok: false, error: "Lecture du billet impossible." }, 500);
      }
    }

    if (request.method === "POST") {
      const auth = await verifyAdmin(request);
      if (auth.error) {
        return json({ ok: false, error: auth.error }, auth.status);
      }

      let body = null;
      try {
        body = JSON.parse(await request.text());
      } catch {
        body = null;
      }

      try {
        const result = await checkInTicket(
          pool,
          code,
          (body && body.usedBy) || auth.email || "Admin ACNU"
        );
        if (result.notFound) {
          return json({ ok: false, error: "Billet introuvable." }, 404);
        }
        if (!result.ok) {
          const status = result.ticket.status === "revoked" ? 410 : 409;
          const error =
            result.ticket.status === "revoked"
              ? "Billet annulé."
              : "Billet déjà utilisé.";
          return json(
            { ok: false, error, ticket: toPublicTicket(result.ticket, { admin: true }) },
            status
          );
        }
        return json({
          ok: true,
          ticket: toPublicTicket(result.ticket, { admin: true }),
        });
      } catch (error) {
        console.error(
          "ticket check-in error code=" + ((error && error.code) || "unknown")
        );
        return json({ ok: false, error: "Validation du billet impossible." }, 500);
      }
    }

    return json({ ok: false, error: "Method not allowed." }, 405);
  },
};
