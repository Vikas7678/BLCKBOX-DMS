import { Worker } from "bullmq";
import { createRedisConnection } from "../lib/redis";
import { emitToUser } from "../realtime/socket";
import { PURGE_QUEUE_NAME, type PurgeJobData } from "./purgeQueue";
import { runPurgeItems } from "./purgeRunner";

let worker: Worker<PurgeJobData> | null = null;

export function startPurgeWorker(): Worker<PurgeJobData> {
  if (worker) return worker;

  worker = new Worker<PurgeJobData>(
    PURGE_QUEUE_NAME,
    async (job) => {
      const result = await runPurgeItems(job.data.items, job.data.requestedByUserId);
      return result;
    },
    {
      connection: createRedisConnection(),
      concurrency: 2,
    },
  );

  worker.on("completed", (job, result) => {
    const userId = job.data.requestedByUserId;
    const purged = result?.purged ?? 0;
    const failed = result?.failed ?? 0;
    emitToUser(userId, "purge:complete", {
      jobId: job.id,
      purged,
      failed,
      message:
        failed > 0
          ? `Permanent delete finished with ${failed} error(s). ${purged} item(s) removed.`
          : `Permanent delete complete. ${purged} item(s) removed.`,
    });
  });

  worker.on("failed", (job, err) => {
    if (!job) return;
    emitToUser(job.data.requestedByUserId, "purge:failed", {
      jobId: job.id,
      message: err.message || "Permanent delete failed",
    });
  });

  console.log("Trash purge worker started (BullMQ + Redis)");
  return worker;
}
