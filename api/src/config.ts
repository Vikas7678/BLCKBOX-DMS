import path from "path";
import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  databaseUrl: required("DATABASE_URL", "postgresql://blckbox:blckbox@localhost:5433/blckbox"),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  jwtCookieName: process.env.JWT_COOKIE_NAME ?? "blckbox_token",
  jwtExpiresDays: Number(process.env.JWT_EXPIRES_DAYS ?? 7),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  publicWebUrl: process.env.PUBLIC_WEB_URL ?? "http://localhost:5173",
  /** Base URL Document Server uses to fetch files (host.docker.internal from the OO container). */
  publicApiUrl: process.env.PUBLIC_API_URL ?? "http://host.docker.internal:4000/api",
  /** Browser-facing API URL (image preview, etc.). */
  browserApiUrl: process.env.BROWSER_API_URL ?? "http://localhost:4000/api",
  /** Browser-facing Document Server URL. */
  onlyOfficeUrl: process.env.ONLYOFFICE_URL ?? "http://localhost:8080",
  /** Must match JWT_SECRET in docker-compose-only-office. */
  onlyOfficeJwtSecret: process.env.ONLYOFFICE_JWT_SECRET ?? "blckbox-onlyoffice-jwt-secret-change-me",
  storagePath: path.resolve(process.env.STORAGE_PATH ?? "./data/uploads"),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024),
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
};
