/* Gala & Awards 2027 — ACNU. api/tickets/[code].js
 * GET  /api/tickets/:code              staff ticket lookup (no buyer PII)
 * GET  /api/tickets/:code?format=qr    staff QR image
 * GET  /api/tickets/:code?format=pdf   staff PDF pass
 * POST /api/tickets/:code              staff check-in (mark present)
 *
 * All methods require a valid Firebase ID token whose e-mail passes isStaff().
 * Env: DATABASE_URL, FIREBASE_WEB_API_KEY, DOOR_STAFF_EMAILS, SITE_URL. */

import pg from "pg";
import { verifyStaff } from "../_lib/admin.js";
import { EVENT, SITE_URL } from "../_lib/config.js";
import { isValidCodeFormat } from "../_lib/codes.js";
import { buildTicketPdf } from "../_lib/pass.js";
import { makeQrPng, ticketUrl } from "../_lib/qr.js";
import { checkInTicket, toStaffTicket } from "../_lib/tickets.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TICKET_SELECT = `SELECT code, transaction_id, tier, participant_name, participant_index,
                              status, issued_at, used_at, used_by
                         FROM tickets WHERE code = $1`;

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

    if (request.method === "GET") {
      const auth = await verifyStaff(request);
      if (auth.error) {
        return json({ ok: false, error: auth.error }, auth.status);
      }

      if (url.searchParams.get("format") === "qr") {
        try {
          const png = await makeQrPng(ticketUrl(code, baseUrl(request)));
          return new Response(png, {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "private, max-age=86400",
            },
          });
        } catch (error) {
          console.error(
            "ticket QR error code=" + ((error && error.code) || "unknown")
          );
          return json({ ok: false, error: "QR code indisponible." }, 500);
        }
      }

      try {
        const { rows } = await pool.query(TICKET_SELECT, [code]);
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
          ticket: toStaffTicket(rows[0]),
          event: EVENT,
        });
      } catch (error) {
        console.error(
          "ticket GET error code=" + ((error && error.code) || "unknown")
        );
        return json({ ok: false, error: "Lecture du billet impossible." }, 500);
      }
    }

    if (request.method === "POST") {
      const auth = await verifyStaff(request);
      if (auth.error) {
        return json({ ok: false, error: auth.error }, auth.status);
      }

      try {
        /* The staff member's verified e-mail is the only accepted used_by
         * value; client-supplied identity is ignored. */
        const result = await checkInTicket(pool, code, auth.email);
        if (result.notFound) {
          return json({ ok: false, error: "Billet introuvable." }, 404);
        }
        if (!result.ok) {
          if (result.ticket.status === "revoked") {
            return json(
              {
                ok: false,
                reason: "ticket_revoked",
                error: "Billet annulé — refus d'entrée.",
                ticket: toStaffTicket(result.ticket),
              },
              410
            );
          }
          return json(
            {
              ok: false,
              reason: "ticket_already_used",
              error: "Billet déjà utilisé.",
              ticket: toStaffTicket(result.ticket),
            },
            409
          );
        }
        return json({ ok: true, ticket: toStaffTicket(result.ticket) });
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
