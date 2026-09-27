/** SMTP and storage settings (admin). */
import { request } from "./client";
import type { SmtpSettings, StorageSettings } from "./types";

export const settingsApi = {
  getSmtpSettings: () => request<{ smtp: SmtpSettings }>("/settings/smtp"),
  updateSmtpSettings: (body: {
    fromEmail: string;
    fromName: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    useSecureConnection: boolean;
  }) =>
    request<{ smtp: SmtpSettings }>("/settings/smtp", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  testSmtpSettings: () =>
    request<{ ok: boolean }>("/settings/smtp/test", { method: "POST", body: "{}" }),

  getStorageSettings: () => request<{ storage: StorageSettings }>("/settings/storage"),
  updateStorageSettings: (body: {
    provider: "local" | "s3";
    localPath?: string;
    s3Bucket?: string;
    s3Region?: string;
    s3AccessKeyId?: string;
    s3SecretAccessKey?: string;
    s3Endpoint?: string;
    s3ForcePathStyle?: boolean;
  }) =>
    request<{ storage: StorageSettings }>("/settings/storage", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  testStorageSettings: () =>
    request<{ ok: boolean }>("/settings/storage/test", { method: "POST", body: "{}" }),
};
