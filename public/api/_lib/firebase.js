/* Gala & Awards 2027 — ACNU. api/_lib/firebase.js (Vercel Serverless).
 * Shared Firebase Admin bootstrap for the REST handlers.
 *
 * Env (read lazily, at request time): FIREBASE_PROJECT_ID,
 * FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY. Initialized once per
 * runtime; existing apps are reused. A missing variable only throws
 * when a handler actually calls getDb()/getAuth(). */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth as getFirebaseAuth } from "firebase-admin/auth";

let app = null;

/* Normalize the private key: strip surrounding quotes, then turn literal
 * "\n" sequences into real newlines. */
function normalizePrivateKey(key) {
  if (!key) return "";
  let value = String(key).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
}

function getAdminApp() {
  if (app) return app;
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0];
    return app;
  }
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if (!privateKey) {
    throw new Error("FIREBASE_PRIVATE_KEY is not set");
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  app = initializeApp({
    projectId,
    credential: cert({
      projectId,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
  return app;
}

export function getAuth() {
  return getFirebaseAuth(getAdminApp());
}

export function getDb() {
  return getFirestore(getAdminApp());
}