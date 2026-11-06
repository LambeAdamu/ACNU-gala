import pg from "pg";
import { issueTicketsForOrder } from "../public/api/_lib/tickets.js";
import { sendBuyerApprovalEmail } from "../public/api/_lib/mail.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const notifyOnly = args.includes("--notify-only");
const notify = notifyOnly || args.includes("--notify");
const refArg = args.find((arg) => arg.startsWith("--ref="));
const ref = refArg ? refArg.slice("--ref=".length) : "";
const dryRun = String(process.env.MAIL_DRY_RUN || "") === "1";
const connectionString = process.env.DATABASE_URL;

function toBackfillOrder(row, tickets) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    tel: row.tel,
    tickets: row.tickets || [],
    qty: row.qty,
    tier: row.tier,
    participants: row.participants || [],
    amount: row.amount,
    payMethod: row.pay_method,
    ref: row.ref,
    createdAt: row.created_at,
    issuedTickets: (tickets || []).map((ticket) => ({
      code: ticket.code,
      tier: ticket.tier,
      participantName: ticket.participant_name,
      status: ticket.status,
    })),
  };
}

async function sendEmail(row, tickets) {
  const result = await sendBuyerApprovalEmail(toBackfillOrder(row, tickets));
  if (result && result.ok) {
    console.log(`emailed ${row.id}`);
    return true;
  }
  const reason = (result && (result.error || (result.skipped && "SKIPPED"))) || "unknown";
  console.log(`email failed ${row.id} code=${reason}`);
  return false;
}

if (!connectionString) {
  console.log("MISSING: DATABASE_URL");
  process.exitCode = 1;
} else if (notify && dryRun) {
  console.log("REFUSED: MAIL_DRY_RUN=1 would not send real email. Unset it first.");
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({ connectionString });
  let failed = false;

  try {
    if (notifyOnly) {
      const params = [];
      let where = "t.status = 'approved' AND k.id IS NOT NULL";
      if (ref) {
        params.push(ref);
        where += ` AND t.id = $${params.length}`;
      }
      const { rows } = await pool.query(
        `SELECT DISTINCT t.*
           FROM transactions t
           JOIN tickets k ON k.transaction_id = t.id
          WHERE ${where}
          ORDER BY t.created_at, t.id`,
        params
      );
      console.log(`approved with tickets to notify: ${rows.length}`);
      let sent = 0;
      let errors = 0;
      for (const row of rows) {
        const { rows: tickets } = await pool.query(
          "SELECT code, tier, participant_name, status FROM tickets WHERE transaction_id = $1 ORDER BY participant_index",
          [row.id]
        );
        if (await sendEmail(row, tickets)) sent += 1;
        else errors += 1;
      }
      console.log(`notify done: emailed=${sent} errors=${errors}`);
    } else {
      const params = [];
      let where = "t.status = 'approved' AND k.id IS NULL";
      if (ref) {
        params.push(ref);
        where += ` AND t.id = $${params.length}`;
      }
      const { rows } = await pool.query(
        `SELECT t.*
           FROM transactions t
           LEFT JOIN tickets k ON k.transaction_id = t.id
          WHERE ${where}
          ORDER BY t.created_at, t.id`,
        params
      );

      console.log(`approved without tickets: ${rows.length}`);
      for (const row of rows) {
        console.log(`  ${row.id} | ${row.tier} | qty=${row.qty}`);
      }

      if (!apply) {
        console.log("dry-run: no changes (use --apply to issue)");
      } else {
        let issued = 0;
        let emailed = 0;
        let errors = 0;
        for (const row of rows) {
          const client = await pool.connect();
          let tickets = [];
          try {
            await client.query("BEGIN");
            const result = await issueTicketsForOrder(client, row);
            if (!result.ok) {
              await client.query("ROLLBACK");
              errors += 1;
              console.log(
                `failed ${row.id} code=${result.error} tier=${result.tier || "-"} remaining=${result.remaining ?? "-"}`
              );
              continue;
            }
            await client.query("COMMIT");
            tickets = result.tickets || [];
            issued += result.issued || 0;
            console.log(`issued ${row.id}: ${result.issued || 0}`);
          } catch (error) {
            try {
              await client.query("ROLLBACK");
            } catch {
              /* ignore */
            }
            errors += 1;
            console.log(
              `failed ${row.id} code=${(error && error.code) || "unknown"}`
            );
            continue;
          } finally {
            client.release();
          }

          if (notify) {
            if (await sendEmail(row, tickets)) emailed += 1;
            else errors += 1;
          }
        }
        console.log(
          `backfill done: issued=${issued} emailed=${emailed} errors=${errors}`
        );
      }
    }
  } catch (error) {
    failed = true;
    const code = (error && error.code) || "unknown";
    const message = String((error && error.message) || "unknown").replace(
      /postgres(ql)?:\/\/[^\s]+/gi,
      "[REDACTED]"
    );
    console.log(`failed code=${code} message=${message}`);
  } finally {
    await pool.end().catch(() => {});
    if (failed) process.exitCode = 1;
  }
}
