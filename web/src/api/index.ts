/**
 * Public API surface for the web app.
 * Domain modules are merged into one `api` object so existing `import { api } from "../api"` keeps working.
 */
import { authApi } from "./auth";
import { auditApi } from "./audit";
import { dashboardApi } from "./dashboard";
import { documentsApi } from "./documents";
import { settingsApi } from "./settings";
import { sharesApi } from "./shares";
import { usersApi } from "./users";
import { workspacesApi } from "./workspaces";

export type { ListParams } from "./client";
export type * from "./types";

export const api = {
  ...authApi,
  ...dashboardApi,
  ...usersApi,
  ...settingsApi,
  ...documentsApi,
  ...sharesApi,
  ...workspacesApi,
  ...auditApi,
};
