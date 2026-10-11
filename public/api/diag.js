/* TEMPORARY diagnostic endpoint — delete after debugging.
 * Deliberately does NOT import firebase-admin so it always boots. Reports
 * env-var presence as booleans (never values), the deployment filesystem
 * layout, and whether firebase-admin submodules resolve on the runtime. */
import fs from "node:fs";

function list(p) {
  try {
    return fs.readdirSync(p);
  } catch (e) {
    return "ERR: " + (e && e.message);
  }
}
function exists(p) {
  try {
    return fs.existsSync(p);
  } catch (e) {
    return "ERR: " + (e && e.message);
  }
}

export default {
  async fetch() {
    const report = {
      ok: true,
      node: process.version,
      cwd: process.cwd(),
      env: {
        FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
        FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
        FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
        ADMIN_EMAILS: !!process.env.ADMIN_EMAILS,
        CLOUDINARY_CLOUD_NAME: !!process.env.CLOUDINARY_CLOUD_NAME,
      },
      fs: {
        task: list("/var/task"),
        taskNodeModules: list("/var/task/node_modules"),
        taskPublic: list("/var/task/public"),
        taskPublicNodeModules: list("/var/task/public/node_modules"),
        nmFirebaseRoot: exists("/var/task/node_modules/firebase-admin"),
        nmFirebasePublic: exists("/var/task/public/node_modules/firebase-admin"),
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
