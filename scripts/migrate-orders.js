/* Migration: create the `transactions` table (ticket orders from the payment page).
 * Non-destructive: CREATE TABLE IF NOT EXISTS only; never drops or alters existing rows.
 * Run with: node scripts/migrate-orders.js        (reads process.env.DATABASE_URL) */

const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DDL = `
CREATE TABLE IF NOT EXISTS transactions (
  id               TEXT PRIMARY KEY,
  buyer_key        TEXT,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  tel              TEXT NOT NULL,
  tickets          JSONB NOT NULL DEFAULT '[]'::jsonb,
  qty              INTEGER NOT NULL DEFAULT 0,
  tier             TEXT NOT NULL DEFAULT 'classic',
  participants     JSONB NOT NULL DEFAULT '[]'::jsonb,
  amount           BIGINT NOT NULL DEFAULT 0,
  pay_method       TEXT,
  pay_num          TEXT,
  pay_date         TEXT,
  ref              TEXT,
  proof            TEXT,
  proof_size       BIGINT,
  proof_url        TEXT,
  proof_public_id  TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  decided_by       TEXT,
  decided_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function main() {
  await pool.query(DDL);
  const { rows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'transactions' ORDER BY ordinal_position`
  );
  console.log("Table `transactions` ready. Columns:");
  rows.forEach((r) => console.log("  - " + r.column_name + " (" + r.data_type + ")"));
  await pool.end();
}

main().catch((e) => {
  console.error("Migration failed:", e.message);
  process.exit(1);
});