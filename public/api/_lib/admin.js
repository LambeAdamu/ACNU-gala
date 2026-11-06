import { ADMIN_EMAILS } from "./config.js";

export async function verifyAdmin(request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    console.error("admin: FIREBASE_WEB_API_KEY is not set on the server.");
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
    if (!ADMIN_EMAILS.includes(email.toLowerCase())) {
      return { error: "Accès refusé.", status: 403 };
    }
    return { email };
  } catch (error) {
    console.error(
      "admin token lookup error code=" + ((error && error.code) || "unknown")
    );
    return { error: "Vérification de session impossible.", status: 500 };
  }
}
