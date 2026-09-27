import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { getIcon } from "material-file-icons";
import { ChevronDown, Download, Folder, History, MoreVertical, Share2, Trash2 } from "lucide-react";
import { api } from "../api";
import type { DocumentItem, FolderItem } from "../api";
import { confirmDanger } from "../alertify";
import { toast } from "../toast";
import { ShareModal } from "./ShareModal";
import { AuditTrailModal } from "./AuditTrailModal";
import { PaginationBar } from "./PaginationBar";
import type { PaginationMeta } from "../pagination";
import emptyFolderImg from "../assets/empty-folder.svg";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function FileTypeIcon({ filename }: { filename: string }) {
  const icon = getIcon(filename);
  return (
    <span
      className="file-type-icon"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}

type MenuTarget =
  | { kind: "doc"; id: string }
  | { kind: "folder"; id: string }
  | null;

type SelectionKey = `doc:${string}` | `folder:${string}`;

export function DocumentList({
  documents,
  folders = [],
  currentUserId,
  toolbarLeft,
  onOpenFolder,
  onDeleteFolder,
  onChanged,
  pagination,
  onPageChange,
}: {
  documents: DocumentItem[];
  folders?: FolderItem[];
  currentUserId: string;
  toolbarLeft?: ReactNode;
  onOpenFolder?: (folderId: string) => void;
  onDeleteFolder?: (folderId: string) => Promise<void>;
  onChanged: () => void;
  pagination?: PaginationMeta;
  onPageChange?: (page: number) => void;
}) {
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTarget>(null);
  const [shareDocs, setShareDocs] = useState<{ id: string; name: string }[] | null>(null);
  const [auditTarget, setAuditTarget] = useState<{
    entityType: "document" | "folder";
    entityId: string;
    entityName: string;
  } | null>(null);
  const [selected, setSelected] = useState<Set<SelectionKey>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bulkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected(new Set());
    setBulkOpen(false);
  }, [documents, folders]);

  useEffect(() => {
    if (!menu && !bulkOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) setMenu(null);
      if (bulkRef.current && !bulkRef.current.contains(target)) setBulkOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menu, bulkOpen]);

  const allKeys = useMemo(() => {
    const keys: SelectionKey[] = [
      ...folders.map((f) => `folder:${f.id}` as SelectionKey),
      ...documents.map((d) => `doc:${d.id}` as SelectionKey),
    ];
    return keys;
  }, [folders, documents]);

  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = selected.size > 0;
  const selectedHasShareable = useMemo(
    () =>
      documents.some(
        (d) => selected.has(`doc:${d.id}`) && (d.canManage ?? d.ownerId === currentUserId),
      ),
    [documents, selected, currentUserId],
  );
  const selectedHasDeletable = useMemo(() => {
    const docs = documents.some((d) => selected.has(`doc:${d.id}`) && (d.canDelete ?? false));
    const fols = Boolean(onDeleteFolder) && folders.some((f) => selected.has(`folder:${f.id}`));
    return docs || fols;
  }, [documents, folders, selected, onDeleteFolder]);

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

  async function download(id: string) {
    window.open(api.downloadUrl(id), "_blank");
    setMenu(null);
  }

  function removeDoc(id: string) {
    setMenu(null);
    confirmDanger("Move this document to trash?", () => {
      void (async () => {
        setBusyId(id);
        try {
          await api.deleteDocument(id);
          toast.success("Document moved to trash");
          onChanged();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Delete failed");
        } finally {
          setBusyId(null);
        }
      })();
    });
  }

  function removeFolder(id: string) {
    if (!onDeleteFolder) return;
    setMenu(null);
    confirmDanger("Move this folder and its files to trash?", () => {
      void (async () => {
        setBusyId(id);
        try {
          await onDeleteFolder(id);
          toast.success("Folder moved to trash");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Delete failed");
        } finally {
          setBusyId(null);
        }
      })();
    });
  }

  function openShareForSelection() {
    setBulkOpen(false);
    const files = documents.filter(
      (d) => selected.has(`doc:${d.id}`) && (d.canManage ?? d.ownerId === currentUserId),
    );
    if (!files.length) {
      toast.error("Folders cannot be shared. Select at least one file you can share.");
      return;
    }
    setShareDocs(
      files.map((d) => ({
        id: d.id,
        name: d.title || d.filename,
      })),
    );
  }

  function deleteSelection() {
    setBulkOpen(false);
    const docIds = documents
      .filter((d) => selected.has(`doc:${d.id}`) && (d.canDelete ?? false))
      .map((d) => d.id);
    const folderIds = onDeleteFolder
      ? folders.filter((f) => selected.has(`folder:${f.id}`)).map((f) => f.id)
      : [];
    if (!docIds.length && !folderIds.length) return;

    const parts = [];
    if (docIds.length) parts.push(`${docIds.length} file(s)`);
    if (folderIds.length) parts.push(`${folderIds.length} folder(s)`);
    confirmDanger(`Move ${parts.join(" and ")} to trash?`, () => {
      void (async () => {
        setBusyId("bulk");
        try {
          for (const id of docIds) {
            await api.deleteDocument(id);
          }
          for (const id of folderIds) {
            if (onDeleteFolder) await onDeleteFolder(id);
          }
          toast.success("Selected items moved to trash");
          setSelected(new Set());
          onChanged();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Delete failed");
        } finally {
          setBusyId(null);
        }
      })();
    });
  }

  const empty =
    folders.length === 0 &&
    documents.length === 0 &&
    (!pagination || pagination.total === 0);
  const showToolbar = Boolean(toolbarLeft) || !empty;

  return (
    <div className="file-browser">
      {showToolbar && (
        <div className="trash-toolbar">
          <div className="file-browser-toolbar-left">{toolbarLeft}</div>
          <div className="trash-toolbar-right">
            {!empty ? (
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
                    {selectedHasShareable && (
                      <button type="button" role="menuitem" onClick={openShareForSelection}>
                        <Share2 size={16} />
                        Share
                      </button>
                    )}
                    {selectedHasDeletable && (
                      <button type="button" role="menuitem" onClick={deleteSelection}>
                        <Trash2 size={16} />
                        Delete
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {empty && (
        <div className="empty-folder">
          <img src={emptyFolderImg} alt="" className="empty-folder-art" width={220} height={180} />
          <p className="empty-folder-title">No files or folders found</p>
          <p className="empty-folder-sub">There are no files or folders in this directory.</p>
        </div>
      )}
      {!empty && (
        <table className="file-table">
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
              <th className="col-type">Type</th>
              <th className="col-name">Name</th>
              <th className="col-size">Size</th>
              <th className="col-date">Created On</th>
              <th className="col-actions" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {folders.map((folder) => {
              const key: SelectionKey = `folder:${folder.id}`;
              const menuOpen = menu?.kind === "folder" && menu.id === folder.id;
              return (
                <tr key={key} className={selected.has(key) ? "is-selected" : undefined}>
                  <td className="col-check">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggleKey(key)}
                      aria-label={`Select folder ${folder.name}`}
                    />
                  </td>
                  <td className="col-type">
                    <Folder size={28} className="file-type-folder" aria-hidden />
                  </td>
                  <td className="col-name">
                    <button
                      type="button"
                      className="file-name-link"
                      onClick={() => onOpenFolder?.(folder.id)}
                    >
                      {folder.name}
                    </button>
                  </td>
                  <td className="col-size muted">—</td>
                  <td className="col-date muted">{formatDate(folder.createdAt)}</td>
                  <td className="col-actions">
                    <div className="row-menu-wrap" ref={menuOpen ? menuRef : undefined}>
                      <button
                        type="button"
                        className="row-menu-btn"
                        aria-label="Folder actions"
                        aria-expanded={menuOpen}
                        disabled={busyId === folder.id || busyId === "bulk"}
                        onClick={() =>
                          setMenu(menuOpen ? null : { kind: "folder", id: folder.id })
                        }
                      >
                        <MoreVertical size={18} />
                      </button>
                      {menuOpen && (
                        <div className="row-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenu(null);
                              setAuditTarget({
                                entityType: "folder",
                                entityId: folder.id,
                                entityName: folder.name,
                              });
                            }}
                          >
                            <History size={16} />
                            Audit trail
                          </button>
                          {onDeleteFolder && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => removeFolder(folder.id)}
                            >
                              <Trash2 size={16} />
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {documents.map((doc) => {
              const key: SelectionKey = `doc:${doc.id}`;
              const menuOpen = menu?.kind === "doc" && menu.id === doc.id;
              const canManage = doc.canManage ?? doc.ownerId === currentUserId;
              const canDelete = doc.canDelete ?? false;
              return (
                <tr key={doc.id} className={selected.has(key) ? "is-selected" : undefined}>
                  <td className="col-check">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggleKey(key)}
                      aria-label={`Select ${doc.title || doc.filename}`}
                    />
                  </td>
                  <td className="col-type">
                    <FileTypeIcon filename={doc.filename} />
                  </td>
                  <td className="col-name">
                    <button
                      type="button"
                      className="file-name-link"
                      onClick={() => navigate(`/preview/${doc.id}`)}
                    >
                      {doc.title || doc.filename}
                    </button>
                  </td>
                  <td className="col-size muted">{formatBytes(doc.sizeBytes)}</td>
                  <td className="col-date muted">{formatDate(doc.createdAt)}</td>
                  <td className="col-actions">
                    <div className="row-menu-wrap" ref={menuOpen ? menuRef : undefined}>
                      <button
                        type="button"
                        className="row-menu-btn"
                        aria-label="File actions"
                        aria-expanded={menuOpen}
                        disabled={busyId === doc.id || busyId === "bulk"}
                        onClick={() =>
                          setMenu(menuOpen ? null : { kind: "doc", id: doc.id })
                        }
                      >
                        <MoreVertical size={18} />
                      </button>
                      {menuOpen && (
                        <div className="row-menu" role="menu">
                          <button type="button" role="menuitem" onClick={() => void download(doc.id)}>
                            <Download size={16} />
                            Download
                          </button>
                          {canManage && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMenu(null);
                                setShareDocs([
                                  { id: doc.id, name: doc.title || doc.filename },
                                ]);
                              }}
                            >
                              <Share2 size={16} />
                              Share
                            </button>
                          )}
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenu(null);
                              setAuditTarget({
                                entityType: "document",
                                entityId: doc.id,
                                entityName: doc.title || doc.filename,
                              });
                            }}
                          >
                            <History size={16} />
                            Audit trail
                          </button>
                          {canDelete && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => removeDoc(doc.id)}
                            >
                              <Trash2 size={16} />
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {shareDocs && (
        <ShareModal
          documents={shareDocs}
          onClose={() => {
            setShareDocs(null);
            setSelected(new Set());
          }}
        />
      )}

      {auditTarget && (
        <AuditTrailModal
          entityType={auditTarget.entityType}
          entityId={auditTarget.entityId}
          entityName={auditTarget.entityName}
          onClose={() => setAuditTarget(null)}
        />
      )}

      {pagination && onPageChange ? (
        <PaginationBar meta={pagination} onPageChange={onPageChange} />
      ) : null}
    </div>
  );
}
