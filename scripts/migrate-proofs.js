/* Migration: create the `proofs` table (payment proof uploads).
 * Run with: node scripts/migrate-proofs.js        (reads process.env.DATABASE_URL) */

const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DDL = `
CREATE TABLE IF NOT EXISTS proofs (
  id             BIGSERIAL PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  file_data      BYTEA NOT NULL,
  content_type   TEXT NOT NULL,
  file_name      TEXT NOT NULL,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function main() {
  await pool.query(DDL);
  const { rows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proofs' ORDER BY ordinal_position`
  );
  console.log("Table `proofs` ready. Columns:");
  rows.forEach((r) => console.log("  - " + r.column_name + " (" + r.data_type + ")"));
  await pool.end();
}

main().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});