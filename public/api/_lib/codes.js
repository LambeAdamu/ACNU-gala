import { randomBytes } from "node:crypto";

export const CODE_LENGTH = 16;
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;

export function generateTicketCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] & 31];
  }
  return code;
}

export function isValidCodeFormat(code) {
  return typeof code === "string" && CODE_PATTERN.test(code);
}
