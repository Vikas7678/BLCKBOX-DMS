/** Dashboard stats + role-scoped recent activity. */
import { request } from "./client";
import type { DashboardData } from "./types";

export const dashboardApi = {
  getDashboard: () => request<DashboardData>("/dashboard"),
};
