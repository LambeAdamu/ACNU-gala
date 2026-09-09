export default async function handler() {
  const probe = {
    hasDb: !!process.env.DATABASE_URL,
    node: process.version,
    esmPlain: "ok",
  };
  try {
    const pg = await import("pg");
    probe.pgImport = "ok";
    probe.pgPoolType = typeof (pg.default || {}).Pool;
  } catch (e) {
    probe.pgImport = "fail: " + (e && e.message ? e.message : String(e)).slice(0, 120);
  }
  return Response.json(probe);
}