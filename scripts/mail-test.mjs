import { MAIL } from "../public/api/_lib/config.js";
import { sendMail } from "../public/api/_lib/mailer.js";

const missing = [];
if (!MAIL.user) missing.push("MAIL_USER");
if (!MAIL.appPassword) missing.push("MAIL_APP_PASSWORD");

if (missing.length) {
  console.log(`MISSING: ${missing.join(", ")}`);
} else {
  const result = await sendMail({
    to: MAIL.user,
    subject: "Test ACNU Gala",
    text: "Test ACNU Gala",
  });

  if (result.ok) {
    console.log("ok");
  } else {
    console.log(`failed code=${result.error || "UNKNOWN"}`);
    process.exitCode = 1;
  }
}
