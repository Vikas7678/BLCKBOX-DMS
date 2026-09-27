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

  app.use("/auth", authRouter);
  app.use("/dashboard", dashboardRouter);
  app.use("/users", usersRouter);
  app.use("/settings", settingsRouter);
  app.use("/shares", sharesRouter);
  app.use("/audit-trails", auditRouter);
  app.use("/documents", documentsRouter);
  app.use("/workspaces", workspacesRouter);
  app.use("/invites", invitesRouter);
  app.use("/s", sharePublicRouter);

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
