import { useEffect, useMemo, useState, type FormEvent, type DragEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CloudUpload, FolderPlus, LayoutGrid, Settings, X } from "lucide-react";
import { api } from "../api";
import type { DocumentItem, FolderItem, WorkspaceItem } from "../api";
import { useAuth } from "../AuthContext";
import { canDeleteContent } from "../permissions";
import { toast } from "../toast";
import { DocumentList } from "../components/DocumentList";
import { UploadModal } from "../components/UploadModal";
import { collectFromDataTransfer, type QueuedDropFile } from "../helpers/dropFiles";
import { emptyMeta, toPaginationMeta, type PaginationMeta } from "../pagination";
import { errMessage } from "../helpers/errors";

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

export function WorkspacePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceItem | null>(null);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [tableFolders, setTableFolders] = useState<FolderItem[]>([]);
  const [contentsMeta, setContentsMeta] = useState<PaginationMeta>(emptyMeta());
  const [page, setPage] = useState(1);
  const [memberCount, setMemberCount] = useState(0);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(
    searchParams.get("folder"),
  );
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [showDropzone, setShowDropzone] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<QueuedDropFile[]>([]);
  const [pendingEmptyFolders, setPendingEmptyFolders] = useState<string[]>([]);

  useEffect(() => {
    setActiveFolderId(searchParams.get("folder"));
  }, [searchParams]);

  function openFolder(folderId: string | null) {
    setActiveFolderId(folderId);
    setPage(1);
    if (folderId) setSearchParams({ folder: folderId });
    else setSearchParams({});
  }

  async function load() {
    if (!id) return;
    const [w, contents, m, f] = await Promise.all([
      api.getWorkspace(id),
      api.listWorkspaceContents(id, activeFolderId, { page }),
      api.listMembers(id),
      api.listFolders(id),
    ]);
    setWorkspace(w.workspace);
    setDocs(contents.documents);
    setTableFolders(contents.folders);
    setContentsMeta(toPaginationMeta(contents));
    setMemberCount(m.members.length);
    setFolders(f.folders);
  }

  useEffect(() => {
    void load().catch((err) =>
      toast.error(errMessage(err, "Failed to load")),
    );
  }, [id, activeFolderId, page]);

  function openUpload(files: QueuedDropFile[] = [], emptyFolders: string[] = []) {
    setPendingFiles(files);
    setPendingEmptyFolders(emptyFolders);
    setUploadOpen(true);
  }

  async function onExplorerDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setShowDropzone(false);
    const { files, emptyFolders } = await collectFromDataTransfer(e.dataTransfer);
    if (!files.length && !emptyFolders.length) return;
    openUpload(files, emptyFolders);
  }

  function closeCreateFolder() {
    setCreatingFolder(false);
    setFolderName("");
    setFolderDescription("");
  }

  async function createFolder(e?: FormEvent) {
    e?.preventDefault();
    if (!id || !folderName.trim()) return;
    setSavingFolder(true);
    try {
      const { folder } = await api.createFolder(id, folderName.trim(), activeFolderId);
      closeCreateFolder();
      toast.success("Folder created");
      await load();
      openFolder(folder.id);
    } catch (err) {
      toast.error(errMessage(err, "Could not create folder"));
    } finally {
      setSavingFolder(false);
    }
  }

  async function deleteFolder(folderId: string) {
    if (!id) return;
    await api.deleteFolder(id, folderId);
    if (
      activeFolderId === folderId ||
      (activeFolderId &&
        folderAncestors(activeFolderId, folders).some((f) => f.id === folderId))
    ) {
      openFolder(null);
    }
    await load();
  }

  const breadcrumb = useMemo(
    () => (activeFolderId ? folderAncestors(activeFolderId, folders) : []),
    [activeFolderId, folders],
  );

  if (!workspace || !user) {
    return <p className="muted">Loading…</p>;
  }

  const memberLabel = `${memberCount} member${memberCount === 1 ? "" : "s"}`;

  return (
    <div className="workspace-page">
      <div className="workspace-toolbar">
        <div className="workspace-toolbar-left">
          <div className="workspace-mark" aria-hidden>
            <LayoutGrid size={22} />
          </div>
          <div>
            <div className="workspace-title-row">
              <h1>{workspace.name}</h1>
              <button
                type="button"
                className="workspace-gear"
                aria-label="Workspace settings"
                title="Workspace settings"
                onClick={() => navigate(`/workspaces/${id}/settings`)}
              >
                <Settings size={18} />
              </button>
            </div>
            <p className="workspace-members-count">{memberLabel}</p>
          </div>
        </div>

        <div className="workspace-toolbar-right">
          <button
            type="button"
            className="workspace-primary-btn"
            onClick={() => openUpload()}
          >
            <CloudUpload size={18} />
            Upload Files
          </button>
          <button
            type="button"
            className="workspace-primary-btn"
            onClick={() => setCreatingFolder(true)}
          >
            <FolderPlus size={18} />
            Create Folder
          </button>
        </div>
      </div>

      <section
        className="workspace-docs-section"
        onDragEnter={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes("Files")) setShowDropzone(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes("Files")) setShowDropzone(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setShowDropzone(false);
        }}
        onDrop={(e) => void onExplorerDrop(e)}
      >
        {showDropzone && (
          <div className="workspace-drop-overlay" aria-hidden>
            <CloudUpload size={40} />
            <p>Drop files or folders to upload</p>
          </div>
        )}
        <DocumentList
          documents={docs}
          folders={tableFolders}
          currentUserId={user.id}
          pagination={contentsMeta}
          onPageChange={setPage}
          toolbarLeft={
            <nav className="file-breadcrumb" aria-label="Breadcrumb">
              <button
                type="button"
                className={!activeFolderId ? "crumb current" : "crumb"}
                onClick={() => openFolder(null)}
              >
                {workspace.name}
              </button>
              {breadcrumb.map((folder, index) => {
                const isLast = index === breadcrumb.length - 1;
                return (
                  <span key={folder.id} className="crumb-segment">
                    <span className="crumb-sep" aria-hidden>
                      &gt;
                    </span>
                    {isLast ? (
                      <span className="crumb current">{folder.name}</span>
                    ) : (
                      <button
                        type="button"
                        className="crumb"
                        onClick={() => openFolder(folder.id)}
                      >
                        {folder.name}
                      </button>
                    )}
                  </span>
                );
              })}
            </nav>
          }
          onOpenFolder={openFolder}
          onDeleteFolder={canDeleteContent(user.platformRole) ? deleteFolder : undefined}
          onChanged={() => void load()}
        />
      </section>

      {creatingFolder && (
        <>
          <button
            type="button"
            className="folder-drawer-backdrop"
            aria-label="Close create folder"
            onClick={closeCreateFolder}
          />
          <aside className="folder-drawer" aria-label="Create New Folder">
            <header className="folder-drawer-header">
              <h2>Create New Folder</h2>
              <button
                type="button"
                className="folder-drawer-close"
                aria-label="Close"
                onClick={closeCreateFolder}
              >
                <X size={18} />
              </button>
            </header>
            <form className="folder-drawer-body" onSubmit={(e) => void createFolder(e)}>
              <label>
                <span>
                  Folder Name <span className="req">*</span>
                </span>
                <input
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <label>
                Description
                <textarea
                  rows={5}
                  value={folderDescription}
                  onChange={(e) => setFolderDescription(e.target.value)}
                  placeholder="Optional"
                />
              </label>
              <div className="folder-drawer-footer">
                <button type="submit" className="folder-drawer-create" disabled={savingFolder}>
                  {savingFolder ? "Creating…" : "Create Folder"}
                </button>
                <button type="button" className="folder-drawer-cancel" onClick={closeCreateFolder}>
                  Cancel
                </button>
              </div>
            </form>
          </aside>
        </>
      )}

      {uploadOpen && id && (
        <UploadModal
          workspaceId={id}
          parentFolderId={activeFolderId}
          folders={folders}
          initialFiles={pendingFiles}
          initialEmptyFolders={pendingEmptyFolders}
          onClose={() => {
            setUploadOpen(false);
            setPendingFiles([]);
            setPendingEmptyFolders([]);
            void load();
          }}
          onComplete={() => {
            void load();
          }}
        />
      )}
    </div>
  );
}
