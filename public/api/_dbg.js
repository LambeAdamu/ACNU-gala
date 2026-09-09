export default async function handler() {
  const hasDb = !!process.env.DATABASE_URL;
  let pgState = "n/a";
  try {
    const pg = await import("pg");
    pgState = typeof pg.default?.Pool === "function" ? "pool-ok" : "pool-missing";
  } catch (e) {
    pgState = "import-fail:" + e.message;
  }
  return Response.json({ hasDb, pg: pgState, node: process.version });
}