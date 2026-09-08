/*
 * admin-create-user.js — one-off server-side script to create an admin user in
 * Firebase Authentication (Email/Password). Uses the Firebase Admin SDK.
 *
 * REQUIREMENTS:
 *   - Node.js installed.
 *   - `npm install` run in this folder (installs firebase-admin).
 *   - A Firebase service-account key file at ../service-account.json (project
 *     root, already git-ignored — keep it secret, NEVER deploy or commit it).
 *   - Email/Password sign-in method ENABLED in the Firebase console
 *     (Authentication > Sign-in method).
 *
 * USAGE:
 *   node admin-create-user.js <email> <password>
 *   Example:
 *   node admin-create-user.js acnubureau.littoral@gmail.com 'A-strong-pass1'
 *
 * The created user can sign in to the admin console immediately — any
 * authenticated Firebase user is granted access (no email allowlist).
 */

const admin = require("firebase-admin");
const path = require("path");

const serviceAccount = require(path.join(__dirname, "..", "service-account.json"));

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("Usage: node admin-create-user.js <email> <password>");
  process.exit(1);
}

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

admin
  .auth()
  .getUserByEmail(email)
  .then((user) => {
    console.log("Account already exists:", user.uid, "— skipping creation.");
    return user;
  })
  .catch((err) => {
    if (err.code === "auth/user-not-found") {
      return admin.auth().createUser({
        email: email,
        password: password,
        emailVerified: false,
      });
    }
    throw err;
  })
  .then((user) => {
    console.log("Success. Admin user:", user.uid, "(" + email + ")");
    console.log("This user can now sign in to the admin console at /admin.html.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Failed to create admin user:", err.message);
    process.exit(1);
  });
