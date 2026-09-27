import { Queue } from "bullmq";
import { createRedisConnection } from "../lib/redis";
import type { AuditJobData } from "../services/auditTypes";

export const AUDIT_QUEUE_NAME = "audit-trails";

let queue: Queue<AuditJobData> | null = null;

export function getAuditQueue(): Queue<AuditJobData> {
  if (!queue) {
    queue = new Queue<AuditJobData>(AUDIT_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 200,
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
      },
    });
  }
  return queue;
}

export async function enqueueAuditJob(data: AuditJobData): Promise<{ jobId: string }> {
  const job = await getAuditQueue().add("audit", data, {
    jobId: `audit-${data.entityType}-${data.entityId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  return { jobId: String(job.id) };
}
