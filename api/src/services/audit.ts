import { prisma } from "../lib/prisma";
import { getRedisConnection } from "../lib/redis";
import { enqueueAuditJob } from "../queue/auditQueue";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTION_PHRASES,
  type AuditAction,
  type AuditEntityType,
  type AuditJobData,
} from "./auditTypes";
import {
  getCachedAuditList,
  getCachedRecentActivity,
  setCachedAuditList,
  setCachedRecentActivity,
} from "./auditCache";
import { resolveEntityPath } from "./auditPath";
import { paginationMeta, parsePagination } from "../lib/pagination";

export async function resolveActorName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  return user?.name || user?.email || "Unknown";
}

type RecordAuditInput = {
  actorUserId: string;
  actorName?: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  entityName: string;
  label?: string;
  workspaceId?: string | null;
  metadata?: Record<string, unknown>;
};

/** Fire-and-forget enqueue; never throws to callers (logs failures). */
export function recordAudit(input: RecordAuditInput): void {
  void (async () => {
    try {
      await enqueueAuditFromInput(input);
    } catch (err) {
      console.error("Failed to enqueue audit", err);
    }
  })();
}

/**
 * Same as recordAudit, but only enqueues if Redis SET NX succeeds
 * (dedupe Strict Mode / double-fetch, e.g. preview).
 */
export function recordAuditOnce(
  input: RecordAuditInput,
  opts: { key: string; ttlSeconds: number },
): void {
  void (async () => {
    try {
      const result = await getRedisConnection().set(
        opts.key,
        "1",
        "EX",
        opts.ttlSeconds,
        "NX",
      );
      if (result !== "OK") return;
      await enqueueAuditFromInput(input);
    } catch (err) {
      console.error("Failed to enqueue audit once", err);
    }
  })();
}

async function enqueueAuditFromInput(input: RecordAuditInput): Promise<void> {
  const actorName = input.actorName ?? (await resolveActorName(input.actorUserId));
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  if (typeof metadata.path !== "string" || !metadata.path) {
    const path = await resolveEntityPath({
      entityType: input.entityType,
      entityId: input.entityId,
      entityName: input.entityName,
    });
    if (path) metadata.path = path;
  }
  const data: AuditJobData = {
    actorUserId: input.actorUserId,
    actorName,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName,
    label: input.label ?? `${AUDIT_ACTION_LABELS[input.action]}: ${input.entityName}`,
    workspaceId: input.workspaceId ?? null,
    metadata: Object.keys(metadata).length ? metadata : undefined,
  };
  await enqueueAuditJob(data);
}

export type AuditLogDto = {
  id: string;
  actorUserId: string;
  actorName: string;
  action: string;
  actionLabel: string;
  actionPhrase: string;
  entityType: string;
  entityId: string;
  entityName: string;
  label: string;
  workspaceId: string | null;
  metadata: unknown;
  createdAt: string;
};

function mapRow(row: {
  id: string;
  actorUserId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string;
  label: string;
  workspaceId: string | null;
  metadata: unknown;
  createdAt: Date;
}): AuditLogDto {
  const action = row.action as AuditAction;
  const actionLabel = AUDIT_ACTION_LABELS[action] ?? row.action;
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    action: row.action,
    actionLabel,
    actionPhrase: AUDIT_ACTION_PHRASES[action] ?? row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityName: row.entityName,
    label: row.label,
    workspaceId: row.workspaceId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listEntityAuditTrails(
  entityType: AuditEntityType,
  entityId: string,
  query: Record<string, unknown>,
) {
  const { page, limit, skip } = parsePagination(query);

  const cached = await getCachedAuditList<{
    items: AuditLogDto[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }>(entityType, entityId, page, limit);
  if (cached) return cached;

  const where = { entityType, entityId };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  const payload = {
    items: rows.map(mapRow),
    ...paginationMeta(total, page, limit),
  };
  await setCachedAuditList(entityType, entityId, page, limit, payload);
  return payload;
}

export type RecentActivityItem = {
  id: string;
  entityType: AuditEntityType | string;
  entityName: string;
  action: string;
  actionPhrase: string;
  actorName: string;
  path: string | null;
  at: string;
};

function pathFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const path = (metadata as { path?: unknown }).path;
  return typeof path === "string" && path.trim() ? path.trim() : null;
}

export async function listRecentAuditActivity(input: {
  limit?: number;
  userId: string;
  platformRole: "admin" | "owner" | "member";
  workspaceIds: string[];
}): Promise<RecentActivityItem[]> {
  const limit = input.limit ?? 10;
  const cached = await getCachedRecentActivity<RecentActivityItem[]>(input.userId);
  if (cached) return cached;

  const where =
    input.platformRole === "admin"
      ? undefined
      : {
          OR: [
            { actorUserId: input.userId },
            ...(input.workspaceIds.length
              ? [{ workspaceId: { in: input.workspaceIds } }]
              : []),
          ],
        };

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const items: RecentActivityItem[] = await Promise.all(
    rows.map(async (r) => {
      const action = r.action as AuditAction;
      let path = pathFromMetadata(r.metadata);
      if (!path) {
        path = await resolveEntityPath({
          entityType: r.entityType as AuditEntityType,
          entityId: r.entityId,
          entityName: r.entityName,
        });
      }
      return {
        id: r.id,
        entityType: r.entityType,
        entityName: r.entityName,
        action: r.action,
        actionPhrase: AUDIT_ACTION_PHRASES[action] ?? r.action,
        actorName: r.actorName,
        path,
        at: r.createdAt.toISOString(),
      };
    }),
  );
  await setCachedRecentActivity(input.userId, items);
  return items;
}
