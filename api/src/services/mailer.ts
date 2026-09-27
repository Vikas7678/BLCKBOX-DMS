import nodemailer from "nodemailer";
import { prisma } from "../lib/prisma";
import { getOrCreatePlatformSettings } from "./platformSettings";

export type SmtpConfig = {
  fromEmail: string;
  fromName: string;
  host: string;
  port: number;
  username: string;
  password: string;
  useSecureConnection: boolean;
};

export async function getSmtpSettings(): Promise<SmtpConfig | null> {
  const row = await getOrCreatePlatformSettings();
  return {
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    host: row.host,
    port: row.port,
    username: row.username,
    password: row.password,
    useSecureConnection: row.useSecureConnection,
  };
}

export function isSmtpConfigured(cfg: SmtpConfig | null): boolean {
  if (!cfg) return false;
  return Boolean(cfg.host && cfg.port && cfg.fromEmail);
}

export async function upsertSmtpSettings(
  data: Partial<SmtpConfig> & { password?: string },
): Promise<SmtpConfig> {
  const existing = await getOrCreatePlatformSettings();
  const password =
    data.password !== undefined && data.password !== ""
      ? data.password
      : existing.password;

  const row = await prisma.platformSettings.update({
    where: { id: existing.id },
    data: {
      fromEmail: data.fromEmail?.trim() ?? existing.fromEmail,
      fromName: data.fromName?.trim() ?? existing.fromName,
      host: data.host?.trim() ?? existing.host,
      port: data.port ?? existing.port,
      username: data.username?.trim() ?? existing.username,
      password,
      useSecureConnection: data.useSecureConnection ?? existing.useSecureConnection,
    },
  });

  return {
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    host: row.host,
    port: row.port,
    username: row.username,
    password: row.password,
    useSecureConnection: row.useSecureConnection,
  };
}

function createTransport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.useSecureConnection,
    auth: cfg.username
      ? {
          user: cfg.username,
          pass: cfg.password,
        }
      : undefined,
  });
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const cfg = await getSmtpSettings();
  if (!isSmtpConfigured(cfg) || !cfg) {
    console.log(`[mail:skip] SMTP not configured — to=${opts.to} subject=${opts.subject}`);
    console.log(`[mail:skip] ${opts.text}`);
    return { sent: false, reason: "SMTP is not configured" };
  }

  const from = cfg.fromName
    ? `"${cfg.fromName}" <${cfg.fromEmail}>`
    : cfg.fromEmail;

  try {
    const transport = createTransport(cfg);
    await transport.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html ?? opts.text.replace(/\n/g, "<br/>"),
    });
    return { sent: true };
  } catch (err) {
    console.error("[mail:error]", err);
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "Failed to send email",
    };
  }
}

export async function sendTestMail(): Promise<{ sent: boolean; reason?: string }> {
  const cfg = await getSmtpSettings();
  if (!isSmtpConfigured(cfg) || !cfg) {
    return { sent: false, reason: "SMTP is not configured" };
  }
  return sendMail({
    to: cfg.fromEmail,
    subject: "BLCKBOX SMTP test",
    text: "This is a test email from BLCKBOX. Your SMTP settings are working.",
  });
}
