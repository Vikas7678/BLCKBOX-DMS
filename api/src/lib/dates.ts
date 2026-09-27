import { HttpError } from "../middleware/error";

/** Parse a required future expiry; reject past dates and anything beyond 365 days. */
export function parseRequiredExpiry(raw: string): Date {
  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new HttpError(400, "Invalid expiry date");
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new HttpError(400, "Expiry must be in the future");
  }
  const max = Date.now() + 365 * 24 * 60 * 60 * 1000;
  if (expiresAt.getTime() > max) {
    throw new HttpError(400, "Expiry cannot be more than 365 days from now");
  }
  return expiresAt;
}
