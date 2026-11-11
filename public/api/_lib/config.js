const DEFAULT_FROM_NAME = "ACNU Gala & Awards";

function parsePositiveInt(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeSiteUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

export const VIP_TABLES = parsePositiveInt(process.env.VIP_TABLES);

export const TIERS = Object.freeze({
  classic: Object.freeze({ perTable: 10, tables: 16 }),
  vip: Object.freeze({ perTable: 10, tables: VIP_TABLES }),
  premium: Object.freeze({ perTable: 1, tables: 5 }),
});

export const SITE_URL = normalizeSiteUrl(process.env.SITE_URL);

export const EVENT = Object.freeze({
  name: "Gala & Awards 2027",
  date: "2027-02-06",
  dateLabel: "samedi 6 février 2027",
  venue: "Cordia Hall, Palms City – Douala",
});

export const ADMIN_EMAILS = Object.freeze(
  String(process.env.ADMIN_EMAILS || "acnubureau.littoral@gmail.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

export const MAIL = Object.freeze({
  user: String(process.env.MAIL_USER ?? "").trim(),
  appPassword: String(process.env.MAIL_APP_PASSWORD ?? ""),
  fromName: String(process.env.MAIL_FROM_NAME ?? "").trim() || DEFAULT_FROM_NAME,
  notifyEmail: String(process.env.ADMIN_NOTIFY_EMAIL ?? "").trim() || String(process.env.MAIL_USER ?? "").trim(),
  dryRun: isTruthy(process.env.MAIL_DRY_RUN),
});

export function tierCapacity(tier) {
  const config = TIERS[tier];
  if (!config) return { ok: false, error: "Unknown tier" };
  if (config.tables == null) {
    return {
      ok: false,
      error: tier === "vip" ? "VIP tables not configured" : "Tables not configured",
    };
  }
  return {
    ok: true,
    tier,
    tables: config.tables,
    perTable: config.perTable,
    seats: config.tables * config.perTable,
  };
}

export function validateConfig({ requireMail = false, requireSite = false } = {}) {
  const errors = [];
  const warnings = [];

  if (requireMail) {
    if (!MAIL.user) errors.push("MAIL_USER is missing");
    if (!MAIL.appPassword) errors.push("MAIL_APP_PASSWORD is missing");
  }

  if (requireSite && !SITE_URL) errors.push("SITE_URL is missing or invalid");

  if (TIERS.vip.tables == null) warnings.push("VIP tables not configured");

  return { ok: errors.length === 0, errors, warnings };
}
