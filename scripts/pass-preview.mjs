import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTicketPdf } from "../public/api/_lib/pass.js";

const tiers = ["premium", "vip", "classic"];
const participants = {
  premium: "Awa Ngo Bell",
  vip: "Michel Roger Ngadeu",
  classic: "Clarisse Mballa",
};
const codes = {
  premium: "ABCDEFGHJKMNPQRS",
  vip: "HJKMNPQRSTUVWXYZ",
  classic: "23456789ABCDEFGH",
};

let failed = false;

for (const tier of tiers) {
  try {
    const pdf = await buildTicketPdf(
      {
        code: codes[tier],
        transaction_id: "TX-PREVIEW",
        tier,
        participant_name: participants[tier],
        participant_index: 1,
        status: "valid",
        issued_at: "2026-11-06T00:00:00.000Z",
      },
      {
        url: "https://acnu-gala.vercel.app/t/" + codes[tier],
      }
    );
    const outputPath = path.join(os.tmpdir(), `acnu-pass-preview-${tier}.pdf`);
    fs.writeFileSync(outputPath, pdf);
    console.log(`${tier}: ${pdf.length} bytes -> ${outputPath}`);
  } catch (error) {
    failed = true;
    console.log(`failed ${tier}: ${error && error.message ? error.message : "unknown"}`);
  }
}

process.exit(failed ? 1 : 0);
