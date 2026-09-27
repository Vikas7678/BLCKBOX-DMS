import path from "path";
import { prisma } from "../lib/prisma";
import { config } from "../config";
import { LocalDiskStorage } from "../storage/local";
import { S3Storage } from "../storage/s3";
import type { StorageService } from "../storage/types";
import { getOrCreatePlatformSettings } from "./platformSettings";

export type StorageProvider = "local" | "s3";

export type StorageConfig = {
  provider: StorageProvider;
  localPath: string;
  s3Bucket: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Endpoint: string;
  s3ForcePathStyle: boolean;
};

let cached: { fingerprint: string; service: StorageService } | null = null;

export function invalidateStorageCache(): void {
  cached = null;
}

export async function getStorageSettings(): Promise<StorageConfig | null> {
  const row = await getOrCreatePlatformSettings();
  return {
    provider: row.provider === "s3" ? "s3" : "local",
    localPath: row.localPath,
    s3Bucket: row.s3Bucket,
    s3Region: row.s3Region,
    s3AccessKeyId: row.s3AccessKeyId,
    s3SecretAccessKey: row.s3SecretAccessKey,
    s3Endpoint: row.s3Endpoint,
    s3ForcePathStyle: row.s3ForcePathStyle,
  };
}

export function defaultLocalPath(): string {
  return config.storagePath;
}

export function isStorageConfigured(cfg: StorageConfig | null): boolean {
  if (!cfg) return true;
  if (cfg.provider === "local") return true;
  return Boolean(cfg.s3Bucket && cfg.s3Region && cfg.s3AccessKeyId && cfg.s3SecretAccessKey);
}

export async function upsertStorageSettings(
  data: Partial<StorageConfig> & { s3SecretAccessKey?: string },
): Promise<StorageConfig> {
  const existing = await getOrCreatePlatformSettings();
  const secret =
    data.s3SecretAccessKey !== undefined && data.s3SecretAccessKey !== ""
      ? data.s3SecretAccessKey
      : existing.s3SecretAccessKey;

  const row = await prisma.platformSettings.update({
    where: { id: existing.id },
    data: {
      provider: (data.provider ?? existing.provider) === "s3" ? "s3" : "local",
      localPath: data.localPath?.trim() ?? existing.localPath,
      s3Bucket: data.s3Bucket?.trim() ?? existing.s3Bucket,
      s3Region: data.s3Region?.trim() ?? existing.s3Region,
      s3AccessKeyId: data.s3AccessKeyId?.trim() ?? existing.s3AccessKeyId,
      s3SecretAccessKey: secret,
      s3Endpoint: data.s3Endpoint?.trim() ?? existing.s3Endpoint,
      s3ForcePathStyle: data.s3ForcePathStyle ?? existing.s3ForcePathStyle,
    },
  });

  invalidateStorageCache();

  return {
    provider: row.provider === "s3" ? "s3" : "local",
    localPath: row.localPath,
    s3Bucket: row.s3Bucket,
    s3Region: row.s3Region,
    s3AccessKeyId: row.s3AccessKeyId,
    s3SecretAccessKey: row.s3SecretAccessKey,
    s3Endpoint: row.s3Endpoint,
    s3ForcePathStyle: row.s3ForcePathStyle,
  };
}

function fingerprint(cfg: StorageConfig | null): string {
  if (!cfg) return `local:${defaultLocalPath()}`;
  if (cfg.provider === "local") {
    return `local:${cfg.localPath || defaultLocalPath()}`;
  }
  return [
    "s3",
    cfg.s3Bucket,
    cfg.s3Region,
    cfg.s3AccessKeyId,
    cfg.s3SecretAccessKey,
    cfg.s3Endpoint,
    String(cfg.s3ForcePathStyle),
  ].join("|");
}

function buildService(cfg: StorageConfig | null): StorageService {
  if (!cfg || cfg.provider === "local") {
    const root = path.resolve(cfg?.localPath || defaultLocalPath());
    return new LocalDiskStorage(root);
  }
  return new S3Storage({
    bucket: cfg.s3Bucket,
    region: cfg.s3Region,
    accessKeyId: cfg.s3AccessKeyId,
    secretAccessKey: cfg.s3SecretAccessKey,
    endpoint: cfg.s3Endpoint || undefined,
    forcePathStyle: cfg.s3ForcePathStyle,
  });
}

export async function getStorage(): Promise<StorageService> {
  const cfg = await getStorageSettings();
  const fp = fingerprint(cfg);
  if (cached?.fingerprint === fp) return cached.service;
  const service = buildService(cfg);
  if (service instanceof LocalDiskStorage) {
    await service.ensureReady();
  }
  cached = { fingerprint: fp, service };
  return service;
}

export async function testStorageConnection(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const cfg = await getStorageSettings();
    const service = buildService(cfg);
    await service.ensureReady?.();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Storage connection failed",
    };
  }
}
