import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { requirePlatformAdmin } from "../services/platform";
import {
  getSmtpSettings,
  isSmtpConfigured,
  sendTestMail,
  upsertSmtpSettings,
} from "../services/mailer";
import {
  defaultLocalPath,
  getStorageSettings,
  isStorageConfigured,
  testStorageConnection,
  upsertStorageSettings,
} from "../services/storageSettings";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);
settingsRouter.use(async (req, _res, next) => {
  try {
    await requirePlatformAdmin(req.user!.id);
    next();
  } catch (err) {
    next(err);
  }
});

const smtpSchema = z.object({
  fromEmail: z.string().email().or(z.literal("")),
  fromName: z.string().max(120).optional().default(""),
  host: z.string().max(255).optional().default(""),
  port: z.coerce.number().int().min(1).max(65535).optional().default(587),
  username: z.string().max(255).optional().default(""),
  password: z.string().max(500).optional(),
  useSecureConnection: z.boolean().optional().default(false),
});

function serializeSmtp(cfg: Awaited<ReturnType<typeof getSmtpSettings>>) {
  return cfg
    ? {
        fromEmail: cfg.fromEmail,
        fromName: cfg.fromName,
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        passwordSet: Boolean(cfg.password),
        useSecureConnection: cfg.useSecureConnection,
        configured: isSmtpConfigured(cfg),
      }
    : {
        fromEmail: "",
        fromName: "",
        host: "",
        port: 587,
        username: "",
        passwordSet: false,
        useSecureConnection: false,
        configured: false,
      };
}

function serializeStorage(cfg: Awaited<ReturnType<typeof getStorageSettings>>) {
  return {
    provider: cfg?.provider ?? "local",
    localPath: cfg?.localPath || defaultLocalPath(),
    s3Bucket: cfg?.s3Bucket ?? "",
    s3Region: cfg?.s3Region ?? "",
    s3AccessKeyId: cfg?.s3AccessKeyId ?? "",
    s3SecretSet: Boolean(cfg?.s3SecretAccessKey),
    s3Endpoint: cfg?.s3Endpoint ?? "",
    s3ForcePathStyle: cfg?.s3ForcePathStyle ?? false,
    configured: isStorageConfigured(cfg),
  };
}

settingsRouter.get("/smtp", async (_req, res, next) => {
  try {
    const cfg = await getSmtpSettings();
    res.json({ smtp: serializeSmtp(cfg) });
  } catch (err) {
    next(err);
  }
});

settingsRouter.put("/smtp", async (req, res, next) => {
  try {
    const body = smtpSchema.parse(req.body ?? {});
    const cfg = await upsertSmtpSettings({
      fromEmail: body.fromEmail,
      fromName: body.fromName,
      host: body.host,
      port: body.port,
      username: body.username,
      password: body.password,
      useSecureConnection: body.useSecureConnection,
    });
    res.json({ smtp: serializeSmtp(cfg) });
  } catch (err) {
    next(err);
  }
});

settingsRouter.post("/smtp/test", async (_req, res, next) => {
  try {
    const result = await sendTestMail();
    if (!result.sent) {
      throw new HttpError(400, result.reason ?? "Test email failed");
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const storageSchema = z.object({
  provider: z.enum(["local", "s3"]),
  localPath: z.string().max(1000).optional().default(""),
  s3Bucket: z.string().max(255).optional().default(""),
  s3Region: z.string().max(100).optional().default(""),
  s3AccessKeyId: z.string().max(255).optional().default(""),
  s3SecretAccessKey: z.string().max(500).optional(),
  s3Endpoint: z.string().max(500).optional().default(""),
  s3ForcePathStyle: z.boolean().optional().default(false),
});

settingsRouter.get("/storage", async (_req, res, next) => {
  try {
    const cfg = await getStorageSettings();
    res.json({ storage: serializeStorage(cfg) });
  } catch (err) {
    next(err);
  }
});

settingsRouter.put("/storage", async (req, res, next) => {
  try {
    const body = storageSchema.parse(req.body ?? {});
    if (body.provider === "s3") {
      if (!body.s3Bucket || !body.s3Region || !body.s3AccessKeyId) {
        throw new HttpError(400, "S3 bucket, region, and access key are required");
      }
      const existing = await getStorageSettings();
      if (!body.s3SecretAccessKey && !existing?.s3SecretAccessKey) {
        throw new HttpError(400, "S3 secret access key is required");
      }
    }
    const cfg = await upsertStorageSettings({
      provider: body.provider,
      localPath: body.localPath,
      s3Bucket: body.s3Bucket,
      s3Region: body.s3Region,
      s3AccessKeyId: body.s3AccessKeyId,
      s3SecretAccessKey: body.s3SecretAccessKey,
      s3Endpoint: body.s3Endpoint,
      s3ForcePathStyle: body.s3ForcePathStyle,
    });
    res.json({ storage: serializeStorage(cfg) });
  } catch (err) {
    next(err);
  }
});

settingsRouter.post("/storage/test", async (_req, res, next) => {
  try {
    const result = await testStorageConnection();
    if (!result.ok) {
      throw new HttpError(400, result.reason ?? "Storage test failed");
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
