import { useEffect, useState, type ComponentType } from "react";
import {
  FileText,
  Folder,
  FolderKanban,
  LineChart,
  LogIn,
  LogOut,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { api } from "../api";
import type { DashboardData } from "../api";
import { errMessage } from "../helpers/errors";

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString();
}

const CARDS = [
  { key: "users" as const, label: "Users", icon: Users, color: "blue" },
  { key: "documents" as const, label: "Documents", icon: FileText, color: "green" },
  { key: "workspaces" as const, label: "Workspaces", icon: FolderKanban, color: "purple" },
  { key: "trash" as const, label: "Trash", icon: Trash2, color: "orange" },
];

type LucideIcon = ComponentType<{ size?: number; className?: string }>;

function entityIcon(
  entityType: string,
  action?: string,
): { icon: LucideIcon; color: string } {
  if (entityType === "folder") {
    return { icon: Folder, color: "orange" };
  }
  if (entityType === "workspace") {
    return { icon: FolderKanban, color: "purple" };
  }
  if (entityType === "user") {
    if (action === "user.login") {
      return { icon: LogIn, color: "blue" };
    }
    if (action === "user.logout") {
      return { icon: LogOut, color: "blue" };
    }
    return { icon: User, color: "blue" };
  }
  return { icon: FileText, color: "green" };
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api
      .getDashboard()
      .then(setData)
      .catch((err) => setError(errMessage(err, "Failed to load dashboard")));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading dashboard…</p>;

  const { stats, recentActivity, cards } = data;
  const visibleCards = CARDS.filter((card) => cards[card.key]);

  return (
    <div>
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Overview of your workspaces and activity</p>
        </div>
      </header>

      <div className="stat-grid">
        {visibleCards.map((card) => {
          const Icon = card.icon;
          const value = stats[card.key];
          return (
            <div key={card.key} className="stat-card">
              <div className="stat-card-body">
                <span className="stat-label">{card.label}</span>
                <strong className="stat-value">{value ?? 0}</strong>
              </div>
              <span
                className={`stat-card-icon-wrap stat-card-icon-wrap--${card.color}`}
                aria-hidden
              >
                <Icon size={18} className="stat-card-icon" />
              </span>
            </div>
          );
        })}
      </div>

      <section className="dashboard-panel">
        <header className="dashboard-panel-header">
          <span className="stat-card-icon-wrap stat-card-icon-wrap--river" aria-hidden>
            <LineChart size={18} className="stat-card-icon" />
          </span>
          <h2>Recent activity</h2>
        </header>
        <ul className="activity-list">
          {recentActivity.length === 0 ? (
            <li className="activity-list-item">
              <div className="activity-list-text muted">No recent file or folder activity yet.</div>
            </li>
          ) : (
            recentActivity.map((item) => {
              const { icon: EntityIcon, color } = entityIcon(item.entityType, item.action);
              return (
                <li key={item.id} className="activity-list-item activity-list-item--rich">
                  <span
                    className={`activity-list-icon activity-list-icon--${color}`}
                    aria-hidden
                  >
                    <EntityIcon size={16} />
                  </span>
                  <div className="activity-list-text">
                    <div className="activity-entity-line">
                      <strong className="activity-entity-name">{item.entityName}</strong>
                      <span className="activity-phrase muted">{item.actionPhrase}</span>
                    </div>
                    <div className="activity-meta-line muted">
                      <span className="activity-actor-icon" aria-hidden>
                        <User size={12} />
                      </span>
                      <span className="activity-actor-name">{item.actorName}</span>
                      {item.path ? (
                        <>
                          <span className="activity-meta-sep" aria-hidden>
                            ·
                          </span>
                          <Folder size={12} aria-hidden />
                          <span className="activity-path" title={item.path}>
                            {item.path}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <time className="muted activity-list-meta">{formatWhen(item.at)}</time>
                </li>
              );
            })
          )}
        </ul>
      </section>
    </div>
  );
}
