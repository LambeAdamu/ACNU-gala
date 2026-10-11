/* TEMPORARY diagnostic endpoint — delete after debugging.
 * Deliberately does NOT import firebase-admin so it always boots. Reports
 * env-var presence as booleans (never values) and whether the firebase-admin
 * submodules resolve on the deployed runtime. */
export default {
  async fetch() {
    const report = {
      ok: true,
      node: process.version,
      env: {
        FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
        FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
        FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
        ADMIN_EMAILS: !!process.env.ADMIN_EMAILS,
        CLOUDINARY_CLOUD_NAME: !!process.env.CLOUDINARY_CLOUD_NAME,
      },
      modules: {},
    };
    for (const spec of [
      "firebase-admin",
      "firebase-admin/app",
      "firebase-admin/firestore",
      "firebase-admin/auth",
    ]) {
      try {
        await import(spec);
        report.modules[spec] = "ok";
      } catch (e) {
        report.modules[spec] = "ERR: " + (e && (e.message || e));
      }
    }
    return Response.json(report);
  },
};
