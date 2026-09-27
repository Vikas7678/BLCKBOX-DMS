import {
  ChevronDown,
  Download,
  History,
  Pencil,
  RefreshCw,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { DocumentItem, FolderItem, OnlyOfficePreviewPayload } from "../api";
import { useAuth } from "../AuthContext";
import { AuditTrailModal } from "../components/AuditTrailModal";
import { FileTypeIcon } from "../components/FileTypeIcon";
import { OnlyOfficePreviewer } from "../components/OnlyOfficePreviewer";
import { PreviewErrorBoundary } from "../components/PreviewErrorBoundary";
import { ShareModal } from "../components/ShareModal";
import { confirmDanger } from "../alertify";
import { toast } from "../toast";
import { errMessage } from "../helpers/errors";
import { formatDate } from "../helpers/date";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}


function getPathExtname(filename: string) {
  const base = filename.includes("/")
    ? filename.slice(filename.lastIndexOf("/") + 1)
    : filename;
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return base.slice(lastDot);
}

function getBaseName(filename: string, extension: string) {
  if (!filename) return "";
  if (!extension) return filename;
  return filename.endsWith(extension)
    ? filename.slice(0, -extension.length)
    : filename;
}

function folderAncestors(folderId: string, folders: FolderItem[]): FolderItem[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: FolderItem[] = [];
  let cursor: FolderItem | undefined = byId.get(folderId);
  while (cursor) {
    chain.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return chain;
}

export function PreviewPage() {
  const { documentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [doc, setDoc] = useState<DocumentItem | null>(null);
  const [payload, setPayload] = useState<OnlyOfficePreviewPayload | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [folderChain, setFolderChain] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(true);
  const [metaOpen, setMetaOpen] = useState(true);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameBase, setRenameBase] = useState("");
  const [renaming, setRenaming] = useState(false);

  const lockedExt = useMemo(
    () => (doc ? getPathExtname(doc.filename) : ""),
    [doc],
  );

  async function loadPreview() {
    if (!documentId) return;
    setLoading(true);
    try {
      const [{ document }, preview] = await Promise.all([
        api.getDocument(documentId),
        api.getOnlyOfficePreview(documentId),
      ]);
      setDoc(document);
      setPayload(preview);

      // Share-only recipients must not see workspace/folder navigation.
      if (document.accessViaInternalShare || !document.workspaceId) {
        setWorkspaceName(null);
        setFolderChain([]);
      } else {
        try {
          const [{ workspace }, { folders }] = await Promise.all([
            api.getWorkspace(document.workspaceId),
            api.listFolders(document.workspaceId),
          ]);
          setWorkspaceName(workspace.name);
          setFolderChain(
            document.folderId ? folderAncestors(document.folderId, folders) : [],
          );
        } catch {
          setWorkspaceName(null);
          setFolderChain([]);
        }
      }
    } catch (err) {
      toast.error(errMessage(err, "Preview failed"));
      navigate(-1);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on document id
  }, [documentId]);

  const canManage = useMemo(() => {
    if (!doc || !user) return false;
    if (typeof doc.canManage === "boolean") return doc.canManage;
    return doc.ownerId === user.id;
  }, [doc, user]);

  const canDelete = useMemo(() => {
    if (!doc || !user) return false;
    if (typeof doc.canDelete === "boolean") return doc.canDelete;
    return false;
  }, [doc, user]);

  function openFolder(folderId: string | null) {
    if (!doc?.workspaceId) return;
    const q = folderId ? `?folder=${folderId}` : "";
    navigate(`/workspaces/${doc.workspaceId}${q}`);
  }

  function download() {
    if (!doc) return;
    window.open(api.downloadUrl(doc.id), "_blank");
  }

  function openRename() {
    if (!doc) return;
    setRenameBase(getBaseName(doc.filename, getPathExtname(doc.filename)));
    setRenameOpen(true);
  }

  async function submitRename(e: FormEvent) {
    e.preventDefault();
    if (!doc) return;
    const base = renameBase.trim();
    if (!base) {
      toast.error("Name is required");
      return;
    }
    const nextName = `${base}${lockedExt}`;
    if (nextName === doc.filename) {
      toast.error("Name is unchanged");
      return;
    }
    setRenaming(true);
    try {
      const { document } = await api.renameDocument(doc.id, nextName);
      setDoc(document);
      setRenameOpen(false);
      toast.success("File renamed");

      // Do not remount OnlyOffice (removeChild crash). Refresh image URL only.
      if (payload?.mode === "image") {
        const preview = await api.getOnlyOfficePreview(document.id);
        setPayload(preview);
      } else if (payload?.mode === "onlyoffice") {
        const prevDoc = (payload.config.document ?? {}) as Record<string, unknown>;
        setPayload({
          ...payload,
          config: {
            ...payload.config,
            document: { ...prevDoc, title: document.filename },
          },
        });
      }
    } catch (err) {
      toast.error(errMessage(err, "Rename failed"));
    } finally {
      setRenaming(false);
    }
  }

  function deleteDoc() {
    if (!doc) return;
    confirmDanger("Move this file to Trash?", () => {
      void (async () => {
        setBusy(true);
        try {
          await api.deleteDocument(doc.id);
          toast.success("Moved to Trash");
          if (doc.workspaceId) navigate(`/workspaces/${doc.workspaceId}`);
          else navigate("/");
        } catch (err) {
          toast.error(errMessage(err, "Delete failed"));
        } finally {
          setBusy(false);
        }
      })();
    });
  }

  const displayName = doc?.title || doc?.filename || "Preview";
  const modifiedAt = doc?.updatedAt || doc?.createdAt;
  const creatorName = doc?.owner?.name || "—";
  const modifierName = doc?.updatedBy?.name || doc?.owner?.name || "—";
  const documentType =
    payload?.mode === "onlyoffice"
      ? (payload.config.documentType as string | undefined)
      : undefined;
  const isImagePreview = payload?.mode === "image";

  return (
    <div className="preview-page">
      {!doc?.accessViaInternalShare && (
        <div className="preview-crumb-row">
          <nav className="file-breadcrumb" aria-label="Breadcrumb">
            {doc?.workspaceId && workspaceName ? (
              <>
                <button type="button" className="crumb" onClick={() => openFolder(null)}>
                  {workspaceName}
                </button>
                {folderChain.map((folder) => (
                  <span key={folder.id} className="crumb-segment">
                    <span className="crumb-sep" aria-hidden>
                      &gt;
                    </span>
                    <button
                      type="button"
                      className="crumb"
                      onClick={() => openFolder(folder.id)}
                    >
                      {folder.name}
                    </button>
                  </span>
                ))}
                <span className="crumb-segment">
                  <span className="crumb-sep" aria-hidden>
                    &gt;
                  </span>
                  <span className="crumb current">{displayName}</span>
                </span>
              </>
            ) : (
              <span className="crumb current">{displayName}</span>
            )}
          </nav>
          <button
            type="button"
            className="trash-refresh"
            aria-label="Refresh"
            title="Refresh"
            disabled={loading}
            onClick={() => void loadPreview()}
          >
            <RefreshCw size={20} strokeWidth={2.75} className={loading ? "spin" : undefined} />
          </button>
        </div>
      )}

      <div className="preview-layout">
        <div className="preview-main">
          <div className="preview-card">
            <header className="preview-file-header">
              <div className="preview-file-card-left">
                {doc && (
                  <FileTypeIcon
                    filename={doc.filename}
                    className="file-type-icon preview-file-icon"
                  />
                )}
                <div>
                  <h1 className="preview-file-name">{displayName}</h1>
                  {doc && (
                    <p className="preview-file-meta muted">
                      {formatBytes(doc.sizeBytes)} · Version 1
                    </p>
                  )}
                </div>
              </div>
              <div className="preview-file-card-right muted">
                {modifierName !== "—" && <div>Modified by {modifierName}</div>}
                {modifiedAt && <div>{formatDate(modifiedAt)}</div>}
              </div>
            </header>

            <div
              className={
                isImagePreview
                  ? "preview-viewer preview-viewer--media"
                  : "preview-viewer preview-viewer--document"
              }
            >
              {loading && !payload && (
                <p className="muted preview-loading">Loading preview…</p>
              )}
              {payload?.mode === "image" && (
                <img
                  src={payload.url}
                  alt={payload.title}
                  className="preview-image"
                />
              )}
              {payload?.mode === "onlyoffice" && doc && (
                <PreviewErrorBoundary resetKey={doc.id}>
                  <OnlyOfficePreviewer
                    documentId={doc.id}
                    documentServerUrl={payload.documentServerUrl}
                    config={payload.config}
                    documentType={documentType}
                  />
                </PreviewErrorBoundary>
              )}
            </div>
          </div>
        </div>

        <aside className="preview-side">
          <section className="preview-side-card">
            <button
              type="button"
              className="preview-side-toggle"
              onClick={() => setActionsOpen((v) => !v)}
            >
              <span>File Actions</span>
              <ChevronDown
                size={16}
                className={actionsOpen ? "preview-chevron open" : "preview-chevron"}
              />
            </button>
            {actionsOpen && (
              <ul className="preview-actions">
                <li>
                  <button type="button" disabled={!doc || busy} onClick={download}>
                    <Download size={16} /> Download Original
                  </button>
                </li>
                {canManage && (
                  <li>
                    <button
                      type="button"
                      disabled={!doc || busy}
                      onClick={() => setShareOpen(true)}
                    >
                      <Share2 size={16} /> Share
                    </button>
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    disabled={!doc || busy}
                    onClick={() => setAuditOpen(true)}
                  >
                    <History size={16} /> Audit trail
                  </button>
                </li>
                {canManage && (
                  <li>
                    <button type="button" disabled={!doc || busy} onClick={openRename}>
                      <Pencil size={16} /> Rename File
                    </button>
                  </li>
                )}
                {canDelete && (
                  <li>
                    <button
                      type="button"
                      className="preview-action-danger"
                      disabled={!doc || busy}
                      onClick={deleteDoc}
                    >
                      <Trash2 size={16} /> Delete Document
                    </button>
                  </li>
                )}
              </ul>
            )}
          </section>

          <section className="preview-side-card">
            <button
              type="button"
              className="preview-side-toggle"
              onClick={() => setMetaOpen((v) => !v)}
            >
              <span>Metadata</span>
              <ChevronDown
                size={16}
                className={metaOpen ? "preview-chevron open" : "preview-chevron"}
              />
            </button>
            {metaOpen && doc && (
              <dl className="preview-metadata">
                <div>
                  <dt>Filename</dt>
                  <dd>{doc.filename}</dd>
                </div>
                <div>
                  <dt>Mime type</dt>
                  <dd>{doc.mimeType}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(doc.sizeBytes)}</dd>
                </div>
                <div>
                  <dt>Created by</dt>
                  <dd>{creatorName}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(doc.createdAt)}</dd>
                </div>
                <div>
                  <dt>Modified by</dt>
                  <dd>{modifierName}</dd>
                </div>
                <div>
                  <dt>Modified</dt>
                  <dd>{modifiedAt ? formatDate(modifiedAt) : "—"}</dd>
                </div>
              </dl>
            )}
          </section>
        </aside>
      </div>

      {renameOpen && doc && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Rename file">
          <div className="create-workspace-modal rename-modal">
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={() => setRenameOpen(false)}
            >
              <X size={18} />
            </button>
            <h2>Rename File</h2>
            <form onSubmit={(e) => void submitRename(e)}>
              <label>
                Name
                <span className="rename-name-row">
                  <input
                    value={renameBase}
                    onChange={(e) => setRenameBase(e.target.value)}
                    autoFocus
                    required
                  />
                  {lockedExt && <span className="rename-ext">{lockedExt}</span>}
                </span>
              </label>
              <div className="actions">
                <button type="button" onClick={() => setRenameOpen(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={renaming}>
                  {renaming ? "Saving…" : "Rename"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {shareOpen && doc && (
        <ShareModal
          documentId={doc.id}
          documentName={doc.title || doc.filename}
          onClose={() => setShareOpen(false)}
        />
      )}

      {auditOpen && doc && (
        <AuditTrailModal
          entityType="document"
          entityId={doc.id}
          entityName={doc.title || doc.filename}
          onClose={() => setAuditOpen(false)}
        />
      )}
    </div>
  );
}
