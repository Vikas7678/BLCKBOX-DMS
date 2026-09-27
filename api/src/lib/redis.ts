import { Redis } from "ioredis";
import { config } from "../config";

let connection: Redis | null = null;

/** Shared Redis connection for BullMQ (maxRetriesPerRequest must be null). */
export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connection;
}

export function createRedisConnection(): Redis {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
