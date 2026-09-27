import { useEffect, useMemo, useRef, useState, type DragEvent, type InputHTMLAttributes } from "react";
import { Check, CloudUpload, Loader2, X } from "lucide-react";
import { api } from "../api";
import type { FolderItem } from "../api";
import { errMessage } from "../helpers/errors";
import { FileTypeIcon } from "./FileTypeIcon";
import {
  collectFromDataTransfer,
  collectFromFileList,
  pathSegments,
  type QueuedDropFile,
} from "../helpers/dropFiles";

export type UploadQueueItem = {
  id: string;
  name: string;
  size: number;
  file: File;
  relativePath: string;
  status: "waiting" | "uploading" | "success" | "failed";
  progress: number;
  error?: string;
};

type Props = {
  workspaceId: string;
  parentFolderId: string | null;
  folders: FolderItem[];
  initialFiles?: QueuedDropFile[];
  initialEmptyFolders?: string[];
  onClose: () => void;
  onComplete: () => void;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}


function makeId(file: File, relativePath: string) {
  return `${relativePath}${file.name}_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2, 8)}`;
}

export function UploadModal({
  workspaceId,
  parentFolderId,
  folders,
  initialFiles = [],
  initialEmptyFolders = [],
  onClose,
  onComplete,
}: Props) {
  const [queue, setQueue] = useState<UploadQueueItem[]>(() =>
    initialFiles.map((f) => ({
      id: makeId(f.file, f.relativePath),
      name: f.file.name,
      size: f.file.size,
      file: f.file,
      relativePath: f.relativePath,
      status: "waiting",
      progress: 0,
    })),
  );
  const [emptyFolders, setEmptyFolders] = useState<string[]>(initialEmptyFolders);
  const [dragOver, setDragOver] = useState(false);
  const [started, setStarted] = useState(initialFiles.length > 0);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderCacheRef = useRef<Map<string, string>>(new Map());
  /** In-flight create promises so parallel callers share one create per path. */
  const folderInflightRef = useRef<Map<string, Promise<string>>>(new Map());
  const cancelledRef = useRef(false);
  const workerLockRef = useRef(false);
  const emptyFoldersDoneRef = useRef(false);
  const knownFoldersRef = useRef<FolderItem[]>([...folders]);

  useEffect(() => {
    knownFoldersRef.current = [...folders];
  }, [folders]);

  const counts = useMemo(() => {
    const total = queue.length;
    const uploaded = queue.filter((q) => q.status === "success").length;
    const failed = queue.filter((q) => q.status === "failed").length;
    const remaining = total - uploaded - failed;
    const overall =
      total === 0 ? 0 : Math.round(((uploaded + failed) / total) * 100);
    return { total, uploaded, failed, remaining, overall };
  }, [queue]);

  const showProgress = started && queue.length > 0;

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const completedNotified = useRef(false);

  useEffect(() => {
    if (!started || busy || queue.length === 0) return;
    if (workerLockRef.current) return;
    const next = queue.find((q) => q.status === "waiting");
    if (!next) {
      if (
        !completedNotified.current &&
        queue.every((q) => q.status === "success" || q.status === "failed")
      ) {
        completedNotified.current = true;
        onComplete();
      }
      return;
    }
    completedNotified.current = false;
    workerLockRef.current = true;
    void runOne(next).finally(() => {
      workerLockRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drive sequential queue
  }, [started, busy, queue]);

  function appendFiles(files: QueuedDropFile[], foldersPaths: string[] = []) {
    setQueue((prev) => {
      const next = [...prev];
      for (const f of files) {
        next.push({
          id: makeId(f.file, f.relativePath),
          name: f.file.name,
          size: f.file.size,
          file: f.file,
          relativePath: f.relativePath,
          status: "waiting",
          progress: 0,
        });
      }
      return next;
    });
    if (foldersPaths.length) {
      setEmptyFolders((prev) => [...prev, ...foldersPaths]);
      emptyFoldersDoneRef.current = false;
    }
    setStarted(true);
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const { files, emptyFolders: empties } = await collectFromDataTransfer(e.dataTransfer);
    if (!files.length && !empties.length) return;
    appendFiles(files, empties);
  }

  function onBrowseFiles(list: FileList | null) {
    if (!list?.length) return;
    appendFiles(collectFromFileList(list));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onBrowseFolder(list: FileList | null) {
    if (!list?.length) return;
    appendFiles(collectFromFileList(list));
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  async function ensureFolderPath(relativePath: string): Promise<string | null> {
    const segments = pathSegments(relativePath);
    if (!segments.length) return parentFolderId;

    let parentId = parentFolderId;
    const local = folderCacheRef.current;

    // Keep cache warm from latest known folders.
    for (const f of knownFoldersRef.current) {
      const key = `${f.parentId ?? "root"}/${f.name.toLowerCase()}`;
      if (!local.has(key)) local.set(key, f.id);
    }

    for (const name of segments) {
      const lookup = `${parentId ?? "root"}/${name.toLowerCase()}`;
      let folderId = local.get(lookup);
      if (!folderId) {
        const inflight = folderInflightRef.current.get(lookup);
        if (inflight) {
          folderId = await inflight;
        } else {
          const createPromise = (async () => {
            const { folder } = await api.createFolder(workspaceId, name, parentId);
            local.set(lookup, folder.id);
            knownFoldersRef.current.push({
              id: folder.id,
              name: folder.name,
              parentId: folder.parentId ?? null,
              workspaceId,
              createdAt: folder.createdAt,
            });
            return folder.id;
          })().finally(() => {
            folderInflightRef.current.delete(lookup);
          });
          folderInflightRef.current.set(lookup, createPromise);
          folderId = await createPromise;
        }
      }
      parentId = folderId;
    }

    return parentId;
  }

  async function ensureEmptyFoldersOnce() {
    if (emptyFoldersDoneRef.current) return;
    emptyFoldersDoneRef.current = true;
    for (const path of emptyFolders) {
      if (cancelledRef.current) return;
      await ensureFolderPath(path);
    }
  }

  async function runOne(item: UploadQueueItem) {
    setBusy(true);
    setQueue((prev) =>
      prev.map((q) =>
        q.id === item.id ? { ...q, status: "uploading", progress: 0, error: undefined } : q,
      ),
    );

    try {
      await ensureEmptyFoldersOnce();
      const folderId = await ensureFolderPath(item.relativePath);
      if (cancelledRef.current) return;

      await api.uploadDocumentWithProgress(
        item.file,
        { workspaceId, folderId: folderId ?? undefined },
        (percent) => {
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, progress: percent } : q)),
          );
        },
      );

      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id ? { ...q, status: "success", progress: 100 } : q,
        ),
      );
    } catch (err) {
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? {
                ...q,
                status: "failed",
                error: errMessage(err, "Upload failed"),
              }
            : q,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function retryFailed() {
    setQueue((prev) =>
      prev.map((q) =>
        q.status === "failed" ? { ...q, status: "waiting", progress: 0, error: undefined } : q,
      ),
    );
  }

  const allDone =
    queue.length > 0 && queue.every((q) => q.status === "success" || q.status === "failed");

  return (
    <div className="upload-modal-root" role="dialog" aria-modal="true" aria-label="Upload files">
      <button type="button" className="upload-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="upload-modal">
        <header className="upload-modal-header">
          <h2>{showProgress ? "Uploading files" : "Upload files"}</h2>
          <button type="button" className="upload-modal-close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {!showProgress ? (
          <div
            className={`upload-dropzone${dragOver ? " is-dragover" : ""}`}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => void onDrop(e)}
          >
            <CloudUpload size={48} className="upload-dropzone-icon" aria-hidden />
            <p className="upload-dropzone-title">Drag & drop files or folders here</p>
            <p className="muted">You can drop nested folders; structure is preserved.</p>
            <div className="upload-dropzone-actions">
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                multiple
                onChange={(e) => onBrowseFiles(e.target.files)}
              />
              <input
                ref={folderInputRef}
                type="file"
                className="sr-only"
                multiple
                {...({ webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>)}
                onChange={(e) => onBrowseFolder(e.target.files)}
              />
              <button
                type="button"
                className="btn-teal"
                onClick={() => fileInputRef.current?.click()}
              >
                Browse files
              </button>
              <button
                type="button"
                className="btn-teal btn-teal-outline"
                onClick={() => folderInputRef.current?.click()}
              >
                Browse folder
              </button>
            </div>
          </div>
        ) : (
          <div className="upload-progress-panel">
            <div className="upload-progress-counts">
              <span>
                Total: <strong>{counts.total}</strong>
              </span>
              <span>
                Uploaded: <strong>{counts.uploaded}</strong>
              </span>
              <span>
                Remaining: <strong>{counts.remaining}</strong>
              </span>
              <span>
                Failed: <strong>{counts.failed}</strong>
              </span>
            </div>
            <div
              className="upload-overall-bar"
              role="progressbar"
              aria-valuenow={counts.overall}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="upload-overall-bar-fill"
                style={{ width: `${counts.overall}%` }}
              />
            </div>
            <p className="upload-overall-label muted">
              Processed {counts.uploaded + counts.failed} of {counts.total} ({counts.overall}%)
            </p>

            <div className="upload-file-list">
              {queue.map((item) => (
                <div key={item.id} className={`upload-file-row status-${item.status}`}>
                  <FileTypeIcon filename={item.name} />
                  <div className="upload-file-middle">
                    <div className="upload-file-labels">
                      <span className="upload-file-name" title={item.name}>
                        {item.relativePath ? `${item.relativePath}${item.name}` : item.name}
                      </span>
                      <span className="muted">({formatBytes(item.size)})</span>
                      <span className="upload-file-pct">{item.progress}%</span>
                    </div>
                    <div className="upload-file-bar">
                      <div
                        className={`upload-file-bar-fill upload-file-bar-fill--${item.status}`}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                    {item.error && <p className="error upload-file-error">{item.error}</p>}
                  </div>
                  <span className="upload-file-status" aria-hidden>
                    {item.status === "uploading" && <Loader2 size={18} className="spin" />}
                    {item.status === "success" && <Check size={18} className="upload-ok" />}
                    {item.status === "waiting" && <span className="muted">…</span>}
                    {item.status === "failed" && <span className="error">!</span>}
                  </span>
                </div>
              ))}
            </div>

            <div className="upload-progress-actions">
              <div
                className="upload-add-more"
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => void onDrop(e)}
              >
                Drop more files here, or{" "}
                <button type="button" className="linkish" onClick={() => fileInputRef.current?.click()}>
                  browse
                </button>
              </div>
              {counts.failed > 0 && (
                <button type="button" className="btn-teal btn-teal-outline" onClick={retryFailed}>
                  Retry failed
                </button>
              )}
              {allDone && (
                <button type="button" className="btn-teal" onClick={onClose}>
                  Done
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              multiple
              onChange={(e) => onBrowseFiles(e.target.files)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
