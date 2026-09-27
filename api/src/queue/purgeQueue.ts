import { Queue } from "bullmq";
import { createRedisConnection } from "../lib/redis";

export const PURGE_QUEUE_NAME = "trash-purge";

export type PurgeItem =
  | { kind: "document"; documentId: string }
  | { kind: "folder"; workspaceId: string; folderId: string };

export type PurgeJobData = {
  requestedByUserId: string;
  items: PurgeItem[];
};

let queue: Queue<PurgeJobData> | null = null;

export function getPurgeQueue(): Queue<PurgeJobData> {
  if (!queue) {
    queue = new Queue<PurgeJobData>(PURGE_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    });
  }
  return queue;
}

export async function enqueuePurgeJob(data: PurgeJobData): Promise<{ jobId: string }> {
  const job = await getPurgeQueue().add("purge", data, {
    jobId: `purge-${data.requestedByUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  return { jobId: String(job.id) };
}
