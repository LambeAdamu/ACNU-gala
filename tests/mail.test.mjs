import test from "node:test";
import assert from "node:assert/strict";

process.env.MAIL_USER = "owner@example.com";
process.env.MAIL_APP_PASSWORD = "not-used-in-dry-run";
process.env.MAIL_FROM_NAME = "ACNU Gala & Awards";
process.env.ADMIN_NOTIFY_EMAIL = "admin@example.com";
process.env.SITE_URL = "https://example.test";
process.env.MAIL_DRY_RUN = "1";

const {
  EVENT_LINE,
  buildAdminEmail,
  buildBuyerApprovalEmail,
  sendAdminNewTransactionEmail,
  sendBuyerApprovalEmail,
} = await import("../public/api/_lib/mail.js");

const order = {
  id: "TX-ABC123",
  name: '<script>alert("x")</script> Evil',
  email: "buyer@example.com",
  tel: "+237 600 00 00 00",
  tickets: [
    { tier: "vip", qty: 2 },
    { tier: "classic", qty: 1 },
  ],
  qty: 3,
  tier: "vip",
  participants: [
    { tier: "vip", name: "Alice" },
    { tier: "vip", name: "Bob <b>" },
    { tier: "classic", name: "Carol" },
  ],
  amount: 65000,
  payMethod: "momomo",
  ref: "Mobile Money (MoMo) 672691175",
  proofUrl: "https://res.cloudinary.com/demo/image/upload/proof.png",
  createdAt: "2026-11-10T13:32:00.000Z",
};

test("admin subject, amount formatting and Douala date", () => {
  const mail = buildAdminEmail(order);
  assert.equal(
    mail.subject,
    "Nouvelle transaction à valider — TX-ABC123 — 65 000 FCFA"
  );
  assert.match(mail.text, /Date : 10\/11\/2026 à 14:32/);
  assert.match(mail.text, /Montant : 65 000 FCFA/);
  assert.match(mail.text, /Ouvrir le tableau de bord : https:\/\/example\.test\/admin/);
});

test("admin amount uses a space as thousands separator", () => {
  const mail = buildAdminEmail({ ...order, amount: 1234567 });
  assert.equal(
    mail.subject,
    "Nouvelle transaction à valider — TX-ABC123 — 1 234 567 FCFA"
  );
});

test("admin tier lines use the site labels", () => {
  const mail = buildAdminEmail(order);
  assert.match(mail.text, /Billets : 2 × VIP, 1 × Classique/);
});

test("buyer-supplied values are escaped in HTML and separate in plain text", () => {
  const mail = buildAdminEmail(order);
  assert.ok(mail.html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; Evil"));
  assert.ok(!mail.html.includes('<script>alert("x")</script>'));
  assert.ok(mail.text.includes('<script>alert("x")</script> Evil'));
});

test("buyer thank-you subject, event line and ticket lines", () => {
  const mail = buildBuyerApprovalEmail(order);
  assert.equal(
    mail.subject,
    "Votre paiement est validé — Gala & Awards 2027 (TX-ABC123)"
  );
  assert.ok(mail.text.includes("• 2 × VIP — Alice, Bob <b>"));
  assert.ok(mail.text.includes("• 1 × Classique — Carol"));
  assert.ok(mail.text.includes(`Rendez-vous le ${EVENT_LINE}.`));
  assert.ok(!/<img/i.test(mail.html));
  assert.ok(mail.html.includes("Bob &lt;b&gt;"));
});

test("CR/LF is stripped from headers and invalid reply-to is omitted", () => {
  const hostile = {
    ...order,
    email: "buyer@example.com\r\nBcc: evil@example.com",
  };
  const admin = buildAdminEmail(hostile);
  assert.equal(admin.replyTo, undefined);
  assert.ok(!/[\r\n]/.test(admin.subject));
  assert.ok(!/[\r\n]/.test(admin.from.name));
  assert.ok(!/[\r\n]/.test(admin.from.address));

  const buyer = buildBuyerApprovalEmail(hostile);
  assert.ok(!/[\r\n]/.test(buyer.to));
  assert.ok(!/[\r\n]/.test(buyer.subject));
});

test("MAIL_FROM_NAME cannot inject a header", () => {
  const original = process.env.MAIL_FROM_NAME;
  process.env.MAIL_FROM_NAME = "ACNU\r\nBcc: evil@example.com";
  const mail = buildAdminEmail(order);
  assert.ok(!/[\r\n]/.test(mail.from.name));
  process.env.MAIL_FROM_NAME = original;
});

test("buyer email with invalid address is skipped", async () => {
  const result = await sendBuyerApprovalEmail({
    ...order,
    email: "not-an-email\r\nBcc: evil@example.com",
  });
  assert.equal(result.skipped, true);
  assert.equal(result.ok, false);
});

test("buyer approval includes issued ticket links", () => {
  const mail = buildBuyerApprovalEmail({
    ...order,
    issuedTickets: [
      {
        code: "ABCDEFGHJKMNPQRS",
        tier: "vip",
        participantName: "Alice",
      },
    ],
  });
  const link = "https://example.test/t/ABCDEFGHJKMNPQRS";
  assert.ok(mail.text.includes(link));
  assert.ok(mail.html.includes(link));
});

test("MAIL_DRY_RUN sends nothing but reports success", async () => {
  const admin = await sendAdminNewTransactionEmail(order);
  assert.equal(admin.ok, true);
  assert.equal(admin.dryRun, true);
});
