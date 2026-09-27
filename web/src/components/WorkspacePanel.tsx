import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Check, LayoutGrid, MoreVertical, Pencil, Plus, PlusCircle, RefreshCw, Search, X } from "lucide-react";
import { api } from "../api";
import type { WorkspaceItem } from "../api";
import { useAuth } from "../AuthContext";
import { canCreateWorkspace } from "../permissions";
import { toast } from "../toast";
import { emptyMeta, type PaginationMeta } from "../pagination";

type Props = {
  onClose: () => void;
};

type PanelView = "list" | "create" | "success";

export function WorkspacePanel({ onClose }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const allowCreate = canCreateWorkspace(user?.platformRole);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>(emptyMeta());
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [view, setView] = useState<PanelView>("list");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);

  const fetchPage = useCallback(async (pageNum: number, q: string, mode: "replace" | "append") => {
    const res = await api.listWorkspaces({ page: pageNum, q });
    setMeta({
      page: res.page,
      limit: res.limit,
      total: res.total,
      totalPages: res.totalPages,
    });
    setPage(res.page);
    if (mode === "append") {
      setWorkspaces((prev) => {
        const seen = new Set(prev.map((w) => w.id));
        const next = res.workspaces.filter((w) => !seen.has(w.id));
        return [...prev, ...next];
      });
    } else {
      setWorkspaces(res.workspaces);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void fetchPage(1, appliedQ, "replace")
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [appliedQ, fetchPage]);

  async function refresh() {
    setRefreshing(true);
    try {
      await fetchPage(1, appliedQ, "replace");
      toast.success("Workspaces refreshed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function loadMore() {
    if (loadingMore || page >= meta.totalPages) return;
    setLoadingMore(true);
    try {
      await fetchPage(page + 1, appliedQ, "append");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  function openCreate() {
    setView("create");
    setFabOpen(false);
    setName("");
    setDescription("");
  }

  function backToList() {
    setView("list");
    setName("");
    setDescription("");
    setCreatedId(null);
  }

  async function createWorkspace(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { workspace } = await api.createWorkspace({
        name: name.trim(),
        description: description.trim(),
      });
      setCreatedId(workspace.id);
      setName("");
      setDescription("");
      await fetchPage(1, appliedQ, "replace");
      setView("success");
      toast.success("Workspace created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create workspace");
    } finally {
      setSaving(false);
    }
  }

  const canLoadMore = !loading && meta.totalPages > page;

  return (
    <aside className="workspace-flyout" aria-label="Workspaces">
      {view === "list" && (
        <>
          <div className="workspace-flyout-filter">
            <Search size={16} aria-hidden />
            <input
              type="search"
              placeholder="Filter workspaces"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setAppliedQ(filter.trim());
                }
              }}
              aria-label="Filter workspaces"
            />
          </div>

          {loading && <p className="workspace-flyout-msg">Loading…</p>}

          <nav className="workspace-flyout-list">
            {!loading && workspaces.length === 0 && (
              <p className="workspace-flyout-msg">No workspaces found.</p>
            )}
            {workspaces.map((ws) => (
              <NavLink
                key={ws.id}
                to={`/workspaces/${ws.id}`}
                className="workspace-flyout-item"
                onClick={onClose}
              >
                {ws.name}
              </NavLink>
            ))}
            {canLoadMore ? (
              <button
                type="button"
                className="workspace-flyout-load-more"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </nav>

          <div className={`workspace-flyout-fabs ${fabOpen ? "is-open" : ""}`}>
            {fabOpen ? (
              <>
                {allowCreate && (
                  <button
                    type="button"
                    className="fab fab-primary"
                    aria-label="Add workspace"
                    title="Add workspace"
                    onClick={openCreate}
                  >
                    <Plus size={20} />
                  </button>
                )}
                <button
                  type="button"
                  className="fab fab-primary"
                  aria-label="Refresh"
                  title="Refresh"
                  disabled={refreshing}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={18} className={refreshing ? "spin" : undefined} />
                </button>
                <button
                  type="button"
                  className="fab fab-muted"
                  aria-label="Collapse actions"
                  title="Collapse"
                  onClick={() => setFabOpen(false)}
                >
                  <X size={18} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="fab fab-more"
                aria-label="More actions"
                title="More actions"
                onClick={() => setFabOpen(true)}
              >
                <MoreVertical size={20} />
              </button>
            )}
          </div>
        </>
      )}

      {view === "create" && (
        <form className="workspace-flyout-create-view" onSubmit={createWorkspace}>
          <button type="button" className="icon-btn-dark create-close" aria-label="Cancel" onClick={backToList}>
            <X size={18} />
          </button>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            required
            autoFocus
            aria-label="Workspace name"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={3}
            aria-label="Description"
          />
          <button type="submit" className="create-ws-submit" disabled={saving}>
            {saving ? "Creating…" : "Create Workspace"}
          </button>
        </form>
      )}

      {view === "success" && (
        <div className="workspace-success-view">
          <button type="button" className="icon-btn-dark create-close" aria-label="Close" onClick={backToList}>
            <X size={18} />
          </button>
          <div className="workspace-success-body">
            <div className="workspace-success-check" aria-hidden>
              <Check size={36} strokeWidth={3} />
            </div>
            <p className="workspace-success-title">Created Successfully</p>
          </div>
          <div className="workspace-success-actions">
            <button
              type="button"
              className="workspace-success-btn"
              onClick={() => {
                if (createdId) navigate(`/workspaces/${createdId}`);
                onClose();
              }}
            >
              <LayoutGrid size={18} /> Browse Workspaces
            </button>
            <button
              type="button"
              className="workspace-success-btn"
              onClick={() => {
                if (createdId) navigate(`/workspaces/${createdId}`);
                onClose();
              }}
            >
              <Pencil size={18} /> Edit Workspace
            </button>
            <button type="button" className="workspace-success-btn" onClick={openCreate}>
              <PlusCircle size={18} /> Add another Workspace
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
