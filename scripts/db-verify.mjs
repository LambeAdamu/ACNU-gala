import pg from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.log("MISSING: DATABASE_URL");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query("BEGIN TRANSACTION READ ONLY");

  const tables = await client.query(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name`
  );

  const columns = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = 'transactions'
      ORDER BY ordinal_position`
  );

  const tickets = await client.query(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_name = 'tickets'`
  );

  const ticketColumns = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = 'tickets'
      ORDER BY ordinal_position`
  );

  const count = await client.query("SELECT count(*)::int AS n FROM transactions");
  const ticketCount = tickets.rows.length
    ? await client.query("SELECT count(*)::int AS n FROM tickets")
    : { rows: [{ n: 0 }] };

  console.log("Tables:");
  for (const row of tables.rows) {
    console.log(`  ${row.table_schema}.${row.table_name}`);
  }

  console.log("transactions columns:");
  for (const row of columns.rows) {
    console.log(
      `  ${row.column_name} | ${row.data_type} | ${row.udt_name} | nullable=${row.is_nullable} | default=${row.column_default || "-"}`
    );
  }

  console.log(
    `tickets table: ${tickets.rows.length ? JSON.stringify(tickets.rows) : "NO"}`
  );
  if (ticketColumns.rows.length) {
    console.log("tickets columns:");
    for (const row of ticketColumns.rows) {
      console.log(
        `  ${row.column_name} | ${row.data_type} | ${row.udt_name} | nullable=${row.is_nullable} | default=${row.column_default || "-"}`
      );
    }
  }
  console.log(`transactions rows: ${count.rows[0].n}`);
  console.log(`tickets rows: ${ticketCount.rows[0].n}`);

  await client.query("ROLLBACK");
  await client.end();
  process.exit(0);
} catch (error) {
  try {
    await client.end();
  } catch {}
  const code = (error && error.code) || "unknown";
  const message = String((error && error.message) || "unknown").replace(
    /postgres(ql)?:\/\/[^\s]+/gi,
    "[REDACTED]"
  );
  console.log(`failed code=${code} message=${message}`);
  process.exit(1);
}
