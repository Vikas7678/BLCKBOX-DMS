import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { ChevronDown, Folder, RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react";
import { api } from "../api";
import type { TrashDocumentItem, TrashFolderItem } from "../api";
import { useAuth } from "../AuthContext";
import { canAccessTrash } from "../permissions";
import { usePurgeSettledRefresh } from "../realtime";
import { confirmDanger } from "../alertify";
import { toast } from "../toast";
import { PaginationBar } from "../components/PaginationBar";
import {emptyMeta, type PaginationMeta, toPaginationMeta} from "../pagination";
import emptyTrashImg from "../assets/empty-trash.svg";
import { errMessage } from "../helpers/errors";
import { formatDate } from "../helpers/date";
import { FileTypeIcon } from "../components/FileTypeIcon";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}


type TrashRow =
  | { kind: "folder"; item: TrashFolderItem }
  | { kind: "doc"; item: TrashDocumentItem };

type SelectionKey = `doc:${string}` | `folder:${string}`;


export function TrashPage() {
  const { user } = useAuth();
  const allowed = canAccessTrash(user?.platformRole);
  const [docs, setDocs] = useState<TrashDocumentItem[]>([]);
  const [folders, setFolders] = useState<TrashFolderItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>(emptyMeta());
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<SelectionKey>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const bulkRef = useRef<HTMLDivElement>(null);

  async function load(opts?: { page?: number; q?: string }) {
    const p = opts?.page ?? page;
    const q = opts?.q ?? appliedQ;
    const res = await api.listTrash({ page: p, q });
    setDocs(res.documents);
    setFolders(res.folders);
    setMeta(toPaginationMeta(res));
  }

  usePurgeSettledRefresh(() => {
    void load().catch(() => undefined);
  });

  useEffect(() => {
    if (!allowed) return;
    void load().catch((err) =>
      toast.error(errMessage(err, "Failed to load trash")),
    );
  }, [allowed, page, appliedQ]);

  useEffect(() => {
    setSelected(new Set());
    setBulkOpen(false);
  }, [page, appliedQ]);

  useEffect(() => {
    if (!bulkOpen) return;
    function onDocClick(e: MouseEvent) {
      if (bulkRef.current && !bulkRef.current.contains(e.target as Node)) {
        setBulkOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [bulkOpen]);

  const rows = useMemo(() => {
    const all: TrashRow[] = [
      ...folders.map((item) => ({ kind: "folder" as const, item })),
      ...docs.map((item) => ({ kind: "doc" as const, item })),
    ];
    return all;
  }, [docs, folders]);

  const allKeys = useMemo(
    () =>
      rows.map((row) =>
        row.kind === "folder"
          ? (`folder:${row.item.id}` as SelectionKey)
          : (`doc:${row.item.id}` as SelectionKey),
      ),
    [rows],
  );

  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = selected.size > 0;

  function toggleKey(key: SelectionKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allKeys));
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setAppliedQ(filter.trim());
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } catch (err) {
      toast.error(errMessage(err, "Refresh failed"));
    } finally {
      setRefreshing(false);
    }
  }

  async function restoreDoc(id: string) {
    setBusyId(id);
    try {
      await api.restoreDocument(id);
      toast.success("Document restored");
      await load();
    } catch (err) {
      toast.error(errMessage(err, "Restore failed"));
    } finally {
      setBusyId(null);
    }
  }

  async function restoreFolder(workspaceId: string, folderId: string) {
    setBusyId(folderId);
    try {
      await api.restoreFolder(workspaceId, folderId);
      toast.success("Folder restored");
      await load();
    } catch (err) {
      toast.error(errMessage(err, "Restore failed"));
    } finally {
      setBusyId(null);
    }
  }

  function purgeDoc(id: string) {
    confirmDanger("Permanently delete this file? This cannot be undone.", () => {
      void (async () => {
        setBusyId(id);
        try {
          const res = await api.purgeDocument(id);
          toast.info(res.message || "Your delete request has been queued");
          await load();
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(`doc:${id}`);
            return next;
          });
        } catch (err) {
          toast.error(errMessage(err, "Delete failed"));
        } finally {
          setBusyId(null);
        }
      })();
    });
  }

  function purgeFolder(workspaceId: string, folderId: string) {
    confirmDanger("Permanently delete this folder and its files? This cannot be undone.", () => {
      void (async () => {
        setBusyId(folderId);
        try {
          const res = await api.purgeFolder(workspaceId, folderId);
          toast.info(res.message || "Your delete request has been queued");
          await load();
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(`folder:${folderId}`);
            return next;
          });
        } catch (err) {
          toast.error(errMessage(err, "Delete failed"));
        } finally {
          setBusyId(null);
        }
      })();
    });
  }

  function restoreSelection() {
    setBulkOpen(false);
    const selectedRows = rows.filter((row) =>
      selected.has(row.kind === "folder" ? `folder:${row.item.id}` : `doc:${row.item.id}`),
    );
    if (!selectedRows.length) return;
    void (async () => {
      setBusyId("bulk");
      try {
        for (const row of selectedRows) {
          if (row.kind === "folder") {
            await api.restoreFolder(row.item.workspaceId, row.item.id);
          } else {
            await api.restoreDocument(row.item.id);
          }
        }
        toast.success(`Restored ${selectedRows.length} item(s)`);
        setSelected(new Set());
        await load();
      } catch (err) {
        toast.error(errMessage(err, "Restore failed"));
      } finally {
        setBusyId(null);
      }
    })();
  }

  function deleteSelection() {
    setBulkOpen(false);
    const selectedRows = rows.filter((row) =>
      selected.has(row.kind === "folder" ? `folder:${row.item.id}` : `doc:${row.item.id}`),
    );
    if (!selectedRows.length) return;
    confirmDanger(
      `Permanently delete ${selectedRows.length} item(s)? This cannot be undone.`,
      () => {
        void (async () => {
          setBusyId("bulk");
          try {
            const documents = selectedRows
              .filter((r) => r.kind === "doc")
              .map((r) => r.item.id);
            const folders = selectedRows
              .filter((r) => r.kind === "folder")
              .map((r) => ({
                workspaceId: r.item.workspaceId,
                folderId: r.item.id,
              }));
            const res = await api.purgeTrashItems({ documents, folders });
            toast.info(res.message || "Your delete request has been queued");
            setSelected(new Set());
            await load();
          } catch (err) {
            toast.error(errMessage(err, "Delete failed"));
          } finally {
            setBusyId(null);
          }
        })();
      },
    );
  }

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="trash-page">
      <header className="page-header">
        <div>
          <h1>Trash</h1>
          <p className="muted">Soft-deleted files and folders. Restore or permanently delete.</p>
        </div>
      </header>

      <div className="trash-toolbar">
        <form className="trash-search" onSubmit={applySearch}>
          <Search size={16} aria-hidden />
          <input
            type="search"
            placeholder="Search by filename"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Search by filename"
          />
        </form>
        <div className="trash-toolbar-right">
          <div className="selected-items-menu" ref={bulkRef}>
            <button
              type="button"
              className="selected-items-btn"
              disabled={!someSelected}
              aria-expanded={bulkOpen}
              onClick={() => setBulkOpen((v) => !v)}
            >
              Selected items
              <ChevronDown size={16} aria-hidden />
            </button>
            {bulkOpen && someSelected ? (
              <div className="selected-items-panel" role="menu">
                <button type="button" role="menuitem" onClick={restoreSelection}>
                  <RotateCcw size={16} />
                  Restore
                </button>
                <button type="button" role="menuitem" onClick={deleteSelection}>
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="trash-refresh"
            aria-label="Refresh"
            title="Refresh"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw size={20} strokeWidth={2.75} className={refreshing ? "spin" : undefined} />
          </button>
        </div>
      </div>

      {meta.total === 0 ? (
        <div className="empty-folder trash-empty">
          <img
            src={emptyTrashImg}
            alt=""
            className="empty-folder-art"
            width={280}
            height={160}
          />
          <p className="empty-folder-title">
            {appliedQ ? "No matching items" : "No items in trash"}
          </p>
          <p className="empty-folder-sub">
            {appliedQ
              ? "Try a different search."
              : "There are no files or folders in trash."}
          </p>
        </div>
      ) : (
        <>
          <table className="file-table trash-table">
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th>Item</th>
                <th className="col-size">File Size</th>
                <th className="col-date">Deleted On</th>
                <th>Deleted By</th>
                <th className="col-trash-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.kind === "folder") {
                  const f = row.item;
                  const key: SelectionKey = `folder:${f.id}`;
                  return (
                    <tr key={key} className={selected.has(key) ? "is-selected" : undefined}>
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggleKey(key)}
                          aria-label={`Select folder ${f.name}`}
                        />
                      </td>
                      <td>
                        <div className="trash-item">
                          <Folder size={28} className="file-type-folder" aria-hidden />
                          <div>
                            <div className="file-name-link">{f.name}</div>
                            <div className="trash-path">/{f.path.replace(/ \/ /g, "/")}</div>
                          </div>
                        </div>
                      </td>
                      <td className="muted">{formatBytes(f.sizeBytes)}</td>
                      <td className="muted">{formatDate(f.deletedAt)}</td>
                      <td className="muted">{f.deletedBy}</td>
                      <td className="col-trash-actions">
                        <button
                          type="button"
                          className="trash-action"
                          disabled={busyId === f.id || busyId === "bulk"}
                          onClick={() => void restoreFolder(f.workspaceId, f.id)}
                        >
                          Restore
                        </button>
                        <span className="trash-action-sep" aria-hidden>
                          |
                        </span>
                        <button
                          type="button"
                          className="trash-action"
                          disabled={busyId === f.id || busyId === "bulk"}
                          onClick={() => purgeFolder(f.workspaceId, f.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                }

                const d = row.item;
                const key: SelectionKey = `doc:${d.id}`;
                return (
                  <tr key={key} className={selected.has(key) ? "is-selected" : undefined}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => toggleKey(key)}
                        aria-label={`Select ${d.title || d.filename}`}
                      />
                    </td>
                    <td>
                      <div className="trash-item">
                        <FileTypeIcon filename={d.filename} />
                        <div>
                          <div className="file-name-link">{d.title || d.filename}</div>
                          <div className="trash-path">
                            /{d.path === "/" ? d.filename : d.path.replace(/ \/ /g, "/")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="muted">{formatBytes(d.sizeBytes)}</td>
                    <td className="muted">{formatDate(d.deletedAt)}</td>
                    <td className="muted">{d.deletedBy}</td>
                    <td className="col-trash-actions">
                      <button
                        type="button"
                        className="trash-action"
                        disabled={busyId === d.id || busyId === "bulk"}
                        onClick={() => void restoreDoc(d.id)}
                      >
                        Restore
                      </button>
                      <span className="trash-action-sep" aria-hidden>
                        |
                      </span>
                      <button
                        type="button"
                        className="trash-action"
                        disabled={busyId === d.id || busyId === "bulk"}
                        onClick={() => purgeDoc(d.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <PaginationBar meta={meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
