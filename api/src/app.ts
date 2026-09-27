import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ZodError } from "zod";
import { config } from "./config";
import { errorHandler, HttpError } from "./middleware/error";
import { authRouter } from "./routes/auth";
import { documentsRouter } from "./routes/documents";
import { workspacesRouter } from "./routes/workspaces";
import { invitesRouter, sharePublicRouter } from "./routes/share";
import { dashboardRouter } from "./routes/dashboard";
import { usersRouter } from "./routes/users";
import { settingsRouter } from "./routes/settings";
import { sharesRouter } from "./routes/shares";
import { auditRouter } from "./routes/audit";
import { getStorage } from "./services/storageSettings";

export async function createApp() {
  await getStorage();

  const app = express();
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/shares", sharesRouter);
  app.use("/api/audit-trails", auditRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/workspaces", workspacesRouter);
  app.use("/api/invites", invitesRouter);
  app.use("/api/s", sharePublicRouter);

  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof ZodError) {
      return next(new HttpError(400, err.errors.map((e) => e.message).join(", ")));
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "LIMIT_FILE_SIZE") {
      return next(new HttpError(400, "File too large"));
    }
    return next(err);
  });

  app.use(errorHandler);
  return app;
}
