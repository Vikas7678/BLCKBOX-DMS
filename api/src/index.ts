import http from "http";
import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./lib/prisma";
import { startPurgeWorker } from "./queue/purgeWorker";
import { startAuditWorker } from "./queue/auditWorker";
import { initSocket } from "./realtime/socket";

async function main() {
  try {
    await prisma.$connect();
    console.log("Database connected");
  } catch (err) {
    console.error("Database connection failed", err);
    process.exit(1);
  }

  const app = await createApp();
  const server = http.createServer(app);
  initSocket(server);
  startPurgeWorker();
  startAuditWorker();

  server.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
