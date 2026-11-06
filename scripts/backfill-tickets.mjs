import pg from "pg";
import {
  buildTicketPlan,
  issueTicketsForOrder,
} from "../public/api/_lib/tickets.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const ids = args.filter((arg) => arg !== "--apply");
const referencePattern = /^TX-[A-Z0-9]{6}$/;
const connectionString = process.env.DATABASE_URL;

function printPlan(id, plan) {
  const records = plan.map(
    (item) => `${item.tier}[${item.participantIndex}]`
  );
  console.log(`${id}: would issue ${records.length} record(s): ${records.join(", ")}`);
}

if (!ids.length) {
  console.log("Usage: node scripts/backfill-tickets.mjs [--apply] TX-XXXXXX [TX-YYYYYY]");
  process.exitCode = 1;
} else if (!connectionString) {
  console.log("MISSING: DATABASE_URL");
  process.exitCode = 1;
} else {
  const invalid = ids.filter((id) => !referencePattern.test(id));
  if (invalid.length) {
    console.log(`INVALID transaction id(s): ${invalid.join(", ")}`);
    process.exitCode = 1;
  } else {
    const pool = new pg.Pool({ connectionString });
    let failed = false;

    try {
      let planned = 0;
      let issued = 0;
      let existing = 0;
      let refused = 0;
      let notFound = 0;
      let errors = 0;

      for (const id of ids) {
        if (!apply) {
          const { rows } = await pool.query(
            "SELECT * FROM transactions WHERE id = $1",
            [id]
          );
          if (!rows.length) {
            console.log(`${id}: not found`);
            notFound += 1;
            continue;
          }
          const row = rows[0];
          if (row.status !== "approved") {
            console.log(`${id}: refused (status=${row.status})`);
            refused += 1;
            continue;
          }
          const tickets = await pool.query(
            `SELECT code, tier, participant_index, status
               FROM tickets
              WHERE transaction_id = $1
              ORDER BY participant_index`,
            [id]
          );
          if (tickets.rows.length) {
            console.log(
              `${id}: existing=${tickets.rows.length} codes=${tickets.rows.map((ticket) => ticket.code).join(",")}`
            );
            existing += 1;
            continue;
          }
          const plan = buildTicketPlan(row);
          printPlan(id, plan);
          planned += plan.length;
          continue;
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const current = await client.query(
            "SELECT * FROM transactions WHERE id = $1 FOR UPDATE",
            [id]
          );
          if (!current.rows.length) {
            await client.query("ROLLBACK");
            console.log(`${id}: not found`);
            notFound += 1;
            continue;
          }
          const row = current.rows[0];
          if (row.status !== "approved") {
            await client.query("ROLLBACK");
            console.log(`${id}: refused (status=${row.status})`);
            refused += 1;
            continue;
          }
          const result = await issueTicketsForOrder(client, row);
          if (!result.ok) {
            await client.query("ROLLBACK");
            console.log(
              `${id}: failed code=${result.error} tier=${result.tier || "-"} remaining=${result.remaining ?? "-"}`
            );
            errors += 1;
            continue;
          }
          await client.query("COMMIT");
          if (result.issued) {
            console.log(
              `${id}: issued=${result.issued} codes=${result.tickets.map((ticket) => ticket.code).join(",")}`
            );
            issued += result.issued;
          } else {
            console.log(
              `${id}: existing=${result.tickets.length} codes=${result.tickets.map((ticket) => ticket.code).join(",")}`
            );
            existing += 1;
          }
        } catch (error) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* ignore */
          }
          console.log(
            `${id}: failed code=${(error && error.code) || "unknown"}`
          );
          errors += 1;
        } finally {
          client.release();
        }
      }

      if (!apply) {
        console.log(
          `dry-run summary: planned=${planned} existing=${existing} refused=${refused} not_found=${notFound}`
        );
      } else {
        console.log(
          `apply summary: issued=${issued} existing=${existing} refused=${refused} not_found=${notFound} errors=${errors}`
        );
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
}
