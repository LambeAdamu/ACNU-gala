import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildTicketPdf, passFileName } from "../public/api/_lib/pass.js";

const requirePublic = createRequire(
  new URL("../public/package.json", import.meta.url)
);
const { PDFDocument } = requirePublic("pdf-lib");

const baseTicket = {
  code: "ABCDEFGHJKMNPQRS",
  transaction_id: "TX-ABC123",
  tier: "premium",
  participant_name: "Awa Ngo Bell",
  participant_index: 1,
  status: "valid",
  issued_at: "2026-11-06T00:00:00.000Z",
};

const url = "https://acnu-gala.vercel.app/t/ABCDEFGHJKMNPQRS";

const PAGE_SIZES = {
  premium: [925, 1280],
  vip: [925, 1280],
  classic: [898, 1280],
};

test("buildTicketPdf renders a one-page pass at the template size for each tier", async () => {
  for (const tier of ["premium", "vip", "classic"]) {
    const bytes = await buildTicketPdf(
      { ...baseTicket, tier },
      { url }
    );
    assert.equal(Buffer.from(bytes).subarray(0, 5).toString("latin1"), "%PDF-");

    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    const page = pdf.getPage(0);
    assert.equal(page.getWidth(), PAGE_SIZES[tier][0]);
    assert.equal(page.getHeight(), PAGE_SIZES[tier][1]);
  }
});

test("passFileName strips accents and replaces spaces with hyphens", () => {
  assert.equal(
    passFileName({ tier: "vip", participant_name: "Élodie Ngo Bell" }),
    "Billet-VIP-Elodie-Ngo-Bell.pdf"
  );
  assert.equal(
    passFileName({ tier: "premium", participant_index: 3 }),
    "Billet-Premium-3.pdf"
  );
  assert.equal(
    passFileName({ tier: "classic", participant_name: "Test Élève" }),
    "Billet-Classic-Test-Eleve.pdf"
  );
});

test("buildTicketPdf handles long and unsupported participant names", async () => {
  const bytes = await buildTicketPdf(
    {
      ...baseTicket,
      participant_name: "A".repeat(120) + " Œuvre 😀 " + "B".repeat(120),
    },
    { url }
  );
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
});

test("buildTicketPdf builds a pass regardless of used or revoked status", async () => {
  for (const status of ["used", "revoked"]) {
    const bytes = await buildTicketPdf(
      {
        ...baseTicket,
        status,
        used_at: "2027-02-06T18:00:00.000Z",
      },
      { url }
    );
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
  }
});

test("buildTicketPdf requires the ticket URL", async () => {
  await assert.rejects(
    () => buildTicketPdf(baseTicket),
    /MISSING_TICKET_URL/
  );
});
