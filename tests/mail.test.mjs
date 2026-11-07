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
  buildOrderConfirmationEmail,
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

const issuedTickets = [
  {
    code: "ABCDEFGHJKMNPQRS",
    tier: "vip",
    participantName: "Alice",
    status: "valid",
  },
  {
    code: "23456789ABCDEFGH",
    tier: "classic",
    participantName: "Carol",
    status: "valid",
  },
];

function cidReferences(html) {
  return [...new Set([...html.matchAll(/cid:[a-z0-9-]+/gi)].map((m) => m[0]))];
}

function cidAttachments(mail) {
  return new Set((mail.attachments || []).map((asset) => `cid:${asset.cid}`));
}

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

test("buyer thank-you subject, event line, ticket lines and CID branding", async () => {
  const mail = await buildBuyerApprovalEmail(order);
  assert.equal(
    mail.subject,
    "Votre paiement est validé — Gala & Awards 2027"
  );
  assert.ok(mail.text.includes("• 2 × VIP — Alice, Bob <b>"));
  assert.ok(mail.text.includes("• 1 × Classique — Carol"));
  assert.ok(mail.text.includes(`Rendez-vous le ${EVENT_LINE}.`));
  assert.ok(mail.html.includes('src="cid:acnu-logo"'));
  assert.ok(mail.html.includes('background="cid:acnu-wm-light"'));
  assert.ok(mail.html.includes("prefers-color-scheme: dark"));
  assert.ok(mail.html.includes("cid:acnu-wm-dark"));
  assert.equal(mail.attachments.length, 3);
  assert.deepEqual(
    mail.attachments.map((asset) => asset.filename).sort(),
    ["logo.png", "watermark-dark.png", "watermark-light.png"]
  );
  assert.ok(mail.attachments.every((asset) => asset.contentDisposition === "inline"));
  assert.ok(mail.attachments.every((asset) => asset.contentType === "image/png"));
  const imageSources = [...mail.html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/gi)].map(
    (match) => match[1]
  );
  assert.deepEqual(imageSources, ["cid:acnu-logo"]);
  assert.ok(!/url\(\s*["']?https?:/i.test(mail.html));
  assert.ok(mail.html.includes("Bob &lt;b&gt;"));
});

test("order confirmation wording, CID branding and no transaction id", () => {
  const mail = buildOrderConfirmationEmail(order);
  assert.equal(
    mail.subject,
    "ACNU Gala & Awards 2027 — Réception de votre commande"
  );
  assert.ok(!/TX-/.test(mail.subject));
  assert.ok(!/Référence de transaction/i.test(mail.text));
  assert.ok(!/TX-/.test(mail.text));
  assert.ok(!/TX-/.test(mail.html));
  assert.match(
    mail.text,
    /Référence de paiement : Mobile Money \(MoMo\) 672691175/
  );
  assert.ok(mail.html.includes("Réception de votre commande"));
  assert.ok(mail.html.includes('src="cid:acnu-logo"'));
  assert.ok(mail.html.includes('background="cid:acnu-wm-light"'));
  assert.ok(mail.html.includes("prefers-color-scheme: dark"));
  assert.ok(mail.html.includes("cid:acnu-wm-dark"));
  assert.equal(mail.attachments.length, 3);
  assert.deepEqual(
    mail.attachments.map((asset) => asset.filename).sort(),
    ["logo.png", "watermark-dark.png", "watermark-light.png"]
  );
  assert.ok(mail.attachments.every((asset) => asset.contentDisposition === "inline"));
});

test("admin alert stays image-free and keeps the transaction reference", () => {
  const mail = buildAdminEmail(order);
  assert.equal(mail.attachments, undefined);
  assert.ok(!/<img/i.test(mail.html));
  assert.match(mail.subject, /TX-ABC123/);
  assert.ok(mail.text.includes("TX-ABC123"));
});

test("buyer emails reference only attached CID images", async () => {
  const confirmation = buildOrderConfirmationEmail(order);
  const approval = await buildBuyerApprovalEmail({ ...order, issuedTickets });
  for (const mail of [confirmation, approval]) {
    const cids = cidAttachments(mail);
    const references = cidReferences(mail.html);
    assert.ok(references.length > 0);
    assert.ok(references.every((reference) => cids.has(reference)));
    assert.ok(!/(?:src|background)="https?:/i.test(mail.html));
    assert.ok(!/url\(\s*["']?https?:/i.test(mail.html));
  }
});

test("CR/LF is stripped from headers and invalid reply-to is omitted", async () => {
  const hostile = {
    ...order,
    email: "buyer@example.com\r\nBcc: evil@example.com",
  };
  const admin = buildAdminEmail(hostile);
  assert.equal(admin.replyTo, undefined);
  assert.ok(!/[\r\n]/.test(admin.subject));
  assert.ok(!/[\r\n]/.test(admin.from.name));
  assert.ok(!/[\r\n]/.test(admin.from.address));

  const buyer = await buildBuyerApprovalEmail(hostile);
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

test("buyer approval includes ticket links, one QR per ticket and PDF passes", async () => {
  const mail = await buildBuyerApprovalEmail({ ...order, issuedTickets });
  const link = "https://example.test/t/ABCDEFGHJKMNPQRS";
  assert.ok(mail.text.includes(link));
  assert.ok(mail.html.includes(link));

  const qrReferences = [
    ...mail.html.matchAll(/cid:qr-([A-Z0-9]+)/g),
  ].map((match) => match[1]);
  assert.equal(qrReferences.length, issuedTickets.length);
  assert.deepEqual(
    new Set(qrReferences),
    new Set(issuedTickets.map((ticket) => ticket.code))
  );

  const qrAttachments = mail.attachments.filter((asset) =>
    String(asset.cid).startsWith("qr-")
  );
  assert.equal(qrAttachments.length, issuedTickets.length);
  assert.deepEqual(
    new Set(qrAttachments.map((asset) => asset.cid.slice(3))),
    new Set(qrReferences)
  );

  const pdfAttachments = mail.attachments.filter(
    (asset) => asset.contentType === "application/pdf"
  );
  assert.equal(pdfAttachments.length, issuedTickets.length);
  for (const pdf of pdfAttachments) {
    assert.equal(Buffer.from(pdf.content).subarray(0, 5).toString("latin1"), "%PDF-");
  }
});

test("neither buyer email contains a TX- transaction reference", async () => {
  const confirmation = buildOrderConfirmationEmail(order);
  const approval = await buildBuyerApprovalEmail({ ...order, issuedTickets });
  for (const mail of [confirmation, approval]) {
    const combined = [mail.subject, mail.text, mail.html].join("\n");
    assert.ok(!/TX-/.test(combined));
    assert.ok(!combined.includes(order.id));
  }
});

test("logo and watermark CIDs are present and each has a matching attachment", async () => {
  const mail = await buildBuyerApprovalEmail({ ...order, issuedTickets });
  const references = cidReferences(mail.html);
  const attachments = cidAttachments(mail);
  for (const cid of ["cid:acnu-logo", "cid:acnu-wm-light", "cid:acnu-wm-dark"]) {
    assert.ok(references.includes(cid), `${cid} missing from HTML`);
    assert.ok(attachments.has(cid), `${cid} missing from attachments`);
  }
  for (const reference of references) {
    assert.ok(attachments.has(reference), `${reference} has no attachment`);
  }
});

test("MAIL_DRY_RUN sends nothing but reports success", async () => {
  const admin = await sendAdminNewTransactionEmail(order);
  assert.equal(admin.ok, true);
  assert.equal(admin.dryRun, true);

  const buyer = await sendBuyerApprovalEmail({ ...order, issuedTickets });
  assert.equal(buyer.ok, true);
  assert.equal(buyer.dryRun, true);
});
