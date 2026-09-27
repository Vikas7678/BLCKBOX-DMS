import { useEffect, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { LayoutDashboard, FolderKanban, Trash2, Users, LogOut, Search, Settings, Share2, Inbox } from "lucide-react";
import { useAuth } from "../AuthContext";
import { api } from "../api";
import { UserAvatar } from "./UserAvatar";
import { WorkspacePanel } from "./WorkspacePanel";
import { canAccessSettings, canAccessTrash, canAccessUsers } from "../permissions";
import { useRealtimeNotifications } from "../realtime";

export function AppShell() {
  const { user, setUser } = useAuth();
  useRealtimeNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const onWorkspaceDetail = /^\/workspaces\/[^/]+/.test(location.pathname);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  async function logout() {
    await api.logout();
    setUser(null);
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  function openWorkspaces(e: MouseEvent) {
    e.preventDefault();
    setWorkspacePanelOpen(true);
  }

  function closeWorkspaces() {
    setWorkspacePanelOpen(false);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">BLCKBOX</div>
        <nav className="sidebar-nav">
          <NavLink to="/" end onClick={closeWorkspaces}>
            <LayoutDashboard size={18} /> Dashboard
          </NavLink>
          <a
            href="#workspaces"
            className={workspacePanelOpen || onWorkspaceDetail ? "active" : undefined}
            onClick={openWorkspaces}
          >
            <FolderKanban size={18} /> Workspaces
          </a>
          {canAccessTrash(user?.platformRole) && (
            <NavLink to="/trash" onClick={closeWorkspaces}>
              <Trash2 size={18} /> Trash
            </NavLink>
          )}
          <NavLink to="/shares/mine" onClick={closeWorkspaces}>
            <Share2 size={18} /> My shares
          </NavLink>
          <NavLink to="/shares/with-me" onClick={closeWorkspaces}>
            <Inbox size={18} /> Shared with me
          </NavLink>
          {canAccessUsers(user?.platformRole) && (
            <NavLink to="/users" onClick={closeWorkspaces}>
              <Users size={18} /> Users
            </NavLink>
          )}
          {canAccessSettings(user?.platformRole) && (
            <NavLink to="/settings" onClick={closeWorkspaces}>
              <Settings size={18} /> Settings
            </NavLink>
          )}
        </nav>
        <button type="button" className="sidebar-logout" onClick={() => void logout()}>
          <LogOut size={18} /> Log out
        </button>
      </aside>

      <div className="shell-body">
        {workspacePanelOpen && (
          <>
            <div
              className="workspace-flyout-backdrop"
              aria-hidden
              onClick={closeWorkspaces}
            />
            <WorkspacePanel onClose={closeWorkspaces} />
          </>
        )}

        <div className="shell-content">
          <header className="topbar">
            <form className="topbar-search" onSubmit={onSearch}>
              <Search size={18} aria-hidden />
              <input
                type="search"
                placeholder="Search workspaces…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search"
              />
            </form>
            <div className="topbar-user">
              <UserAvatar name={user?.name ?? "?"} />
              <span className="topbar-user-name">{user?.name}</span>
            </div>
          </header>
          <main className="shell-main">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
