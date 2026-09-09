export default {
  async fetch(request) {
    const probe = { ok: true, method: request.method, node: process.version, hasDb: !!process.env.DATABASE_URL };
    if (request.method === "POST") {
      try {
        const pg = await import("pg");
        probe.pgImport = "ok";
        probe.pgPool = typeof (pg.default || {}).Pool;
      } catch (e) {
        probe.pgImport = "fail: " + (e && e.message ? e.message : String(e)).slice(0, 120);
      }
    }
    return Response.json(probe);
  },
};