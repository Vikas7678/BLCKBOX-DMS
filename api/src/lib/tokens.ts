import crypto from "crypto";

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function inviteExpiryDate(days = 7): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
