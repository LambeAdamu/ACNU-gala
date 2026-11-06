import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(scriptDir, "..", "db", "migrations");
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.log("MISSING: DATABASE_URL");
  process.exitCode = 1;
} else if (!fs.existsSync(migrationsDir)) {
  console.log(`MISSING: ${migrationsDir}`);
  process.exitCode = 1;
} else {
  const client = new pg.Client({ connectionString });
  let failed = false;

  try {
    await client.connect();
    await client.query(
      `CREATE TABLE IF NOT EXISTS public.schema_migrations (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`
    );

    const applied = new Set(
      (await client.query("SELECT filename FROM public.schema_migrations")).rows.map(
        (row) => row.filename
      )
    );
    const files = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO public.schema_migrations (filename) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`applied ${file}`);
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* ignore */
        }
        failed = true;
        const code = (error && error.code) || "unknown";
        const message = String((error && error.message) || "unknown").replace(
          /postgres(ql)?:\/\/[^\s]+/gi,
          "[REDACTED]"
        );
        console.log(`failed ${file} code=${code} message=${message}`);
        break;
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
    await client.end().catch(() => {});
    if (failed) process.exitCode = 1;
  }
}
