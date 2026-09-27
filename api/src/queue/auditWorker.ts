import { Worker } from "bullmq";
import { Prisma } from "@prisma/client";
import { createRedisConnection } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { invalidateAuditCaches } from "../services/auditCache";
import { AUDIT_QUEUE_NAME } from "./auditQueue";
import type { AuditJobData } from "../services/auditTypes";

let worker: Worker<AuditJobData> | null = null;

export function startAuditWorker(): Worker<AuditJobData> {
  if (worker) return worker;

  worker = new Worker<AuditJobData>(
    AUDIT_QUEUE_NAME,
    async (job) => {
      const data = job.data;
      await prisma.auditLog.create({
        data: {
          actorUserId: data.actorUserId,
          actorName: data.actorName,
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId,
          entityName: data.entityName,
          label: data.label,
          workspaceId: data.workspaceId ?? null,
          metadata:
            data.metadata === undefined
              ? undefined
              : (data.metadata as Prisma.InputJsonValue),
        },
      });
      await invalidateAuditCaches(data.entityType, data.entityId);
    },
    {
      connection: createRedisConnection(),
      concurrency: 4,
    },
  );

  worker.on("failed", (job, err) => {
    console.error("Audit job failed", job?.id, err.message);
  });

  console.log("Audit trail worker started (BullMQ + Redis)");
  return worker;
}
