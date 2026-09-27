import { getRedisConnection } from "../lib/redis";
import type { AuditEntityType } from "./auditTypes";

const LIST_TTL_SECONDS = 60;
const RECENT_TTL_SECONDS = 30;

function verKey(entityType: AuditEntityType, entityId: string) {
  return `audit:ver:${entityType}:${entityId}`;
}

function listKey(entityType: AuditEntityType, entityId: string, version: string, page: number, limit: number) {
  return `audit:list:${entityType}:${entityId}:v${version}:p${page}:l${limit}`;
}

const RECENT_KEY = "audit:recent:dashboard:v4";

export async function getAuditListCacheVersion(
  entityType: AuditEntityType,
  entityId: string,
): Promise<string> {
  const v = await getRedisConnection().get(verKey(entityType, entityId));
  return v ?? "0";
}

export async function getCachedAuditList<T>(
  entityType: AuditEntityType,
  entityId: string,
  page: number,
  limit: number,
): Promise<T | null> {
  try {
    const version = await getAuditListCacheVersion(entityType, entityId);
    const raw = await getRedisConnection().get(listKey(entityType, entityId, version, page, limit));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setCachedAuditList(
  entityType: AuditEntityType,
  entityId: string,
  page: number,
  limit: number,
  payload: unknown,
): Promise<void> {
  try {
    const version = await getAuditListCacheVersion(entityType, entityId);
    await getRedisConnection().set(
      listKey(entityType, entityId, version, page, limit),
      JSON.stringify(payload),
      "EX",
      LIST_TTL_SECONDS,
    );
  } catch {
    // cache is best-effort
  }
}

export async function getCachedRecentActivity<T>(): Promise<T | null> {
  try {
    const raw = await getRedisConnection().get(RECENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setCachedRecentActivity(payload: unknown): Promise<void> {
  try {
    await getRedisConnection().set(RECENT_KEY, JSON.stringify(payload), "EX", RECENT_TTL_SECONDS);
  } catch {
    // ignore
  }
}

export async function invalidateAuditCaches(
  entityType: AuditEntityType,
  entityId: string,
): Promise<void> {
  try {
    const redis = getRedisConnection();
    await redis.incr(verKey(entityType, entityId));
    await redis.del(RECENT_KEY);
  } catch {
    // ignore
  }
}
