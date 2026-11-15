import { ADMIN_EMAILS } from "./config.js";

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseEmailList(value) {
  return String(value ?? "")
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
}

export function doorStaffEmails() {
  return parseEmailList(process.env.DOOR_STAFF_EMAILS);
}

export function isAdmin(email) {
  return ADMIN_EMAILS.includes(normalizeEmail(email));
}

export function isStaff(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (isAdmin(normalized)) return true;
  return doorStaffEmails().includes(normalized);
}

async function verifyFirebaseToken(request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    console.error("auth: FIREBASE_WEB_API_KEY is not set on the server.");
    return { error: "Server configuration error.", status: 500 };
  }
  if (!token) return { error: "Authentification requise.", status: 401 };

  try {
    const res = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      }
    );
    if (!res.ok) return { error: "Authentification invalide.", status: 401 };
    const data = await res.json();
    const email = ((data.users && data.users[0] && data.users[0].email) || "").trim();
    if (!email) return { error: "Authentification invalide.", status: 401 };
    return { email: normalizeEmail(email) };
  } catch (error) {
    console.error(
      "auth token lookup error code=" + ((error && error.code) || "unknown")
    );
    return { error: "Vérification de session impossible.", status: 500 };
  }
}

export async function verifyAdmin(request) {
  const auth = await verifyFirebaseToken(request);
  if (auth.error) return auth;
  if (!isAdmin(auth.email)) {
    return { error: "Accès refusé.", status: 403 };
  }
  return { email: auth.email };
}

export async function verifyStaff(request) {
  const auth = await verifyFirebaseToken(request);
  if (auth.error) return auth;
  if (!isStaff(auth.email)) {
    return { error: "Accès refusé.", status: 403 };
  }
  return { email: auth.email };
}
