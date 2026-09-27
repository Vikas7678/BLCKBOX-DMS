import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "../api";
import type { MyShareItem } from "../api";
import { toast } from "../toast";
import { confirmDanger } from "../alertify";
import { PaginationBar } from "../components/PaginationBar";
import { emptyMeta, type PaginationMeta } from "../pagination";
import emptyMySharesImg from "../assets/empty-my-shares.svg";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString();
}

function shareDocs(s: MyShareItem) {
  if (s.documents?.length) return s.documents;
  return s.document ? [s.document] : [];
}

function accessFlags(s: MyShareItem): string {
  const flags: string[] = [];
  if (s.hasPassword) flags.push("password");
  if (s.allowDownload) flags.push("download");
  return flags.length ? flags.join(" · ") : "";
}

export function MySharesPage() {
  const [shares, setShares] = useState<MyShareItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>(emptyMeta());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const res = await api.listMyShares({ page });
      setShares(res.shares);
      setMeta({
        page: res.page,
        limit: res.limit,
        total: res.total,
        totalPages: res.totalPages,
      });
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load shares");
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await api.listMyShares({ page });
      setShares(res.shares);
      setMeta({
        page: res.page,
        limit: res.limit,
        total: res.total,
        totalPages: res.totalPages,
      });
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, [page]);

  const activeShares = useMemo(
    () => shares.filter((s) => s.status === "active"),
    [shares],
  );

  const selectableKeys = useMemo(
    () => activeShares.map((s) => `${s.kind}:${s.id}`),
    [activeShares],
  );

  const allSelected =
    selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k));
  const someSelected = selected.size > 0;

  function toggleKey(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableKeys));
  }

  function revokeSelected() {
    const items = shares.filter((s) => selected.has(`${s.kind}:${s.id}`));
    if (!items.length) return;
    confirmDanger(`Revoke ${items.length} selected share(s)?`, () => {
      void (async () => {
        setBusy(true);
        try {
          for (const item of items) {
            if (item.kind === "internal") await api.revokeInternalShare(item.id);
            else await api.revokeExternalShare(item.id);
          }
          toast.success(`Revoked ${items.length} share(s)`);
          await load();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Revoke failed");
        } finally {
          setBusy(false);
        }
      })();
    });
  }

  return (
    <div className="trash-page">
      <header className="page-header">
        <div>
          <h1>My shares</h1>
          <p className="muted">Documents you have shared (internal and external).</p>
        </div>
      </header>

      <div className="trash-toolbar">
        <div />
        <div className="trash-toolbar-right">
          <button
            type="button"
            className="selected-items-btn"
            disabled={!someSelected || busy}
            onClick={revokeSelected}
          >
            Revoke selected
          </button>
          <button
            type="button"
            className="trash-refresh"
            aria-label="Refresh"
            title="Refresh"
            disabled={refreshing || loading}
            onClick={() => void refresh()}
          >
            <RefreshCw
              size={20}
              strokeWidth={2.75}
              className={refreshing ? "spin" : undefined}
            />
          </button>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : meta.total === 0 ? (
        <div className="empty-folder trash-empty">
          <img
            src={emptyMySharesImg}
            alt=""
            className="empty-folder-art"
            width={280}
            height={180}
          />
          <p className="empty-folder-title">No shares yet</p>
          <p className="empty-folder-sub">
            When you share a document internally or externally, it will show up here.
          </p>
        </div>
      ) : (
        <>
        <table className="file-table">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={!selectableKeys.length}
                  aria-label="Select all active shares"
                />
              </th>
              <th>Document</th>
              <th>Type</th>
              <th>Recipient</th>
              <th>Access</th>
              <th>Expires</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shares.map((s) => {
              const key = `${s.kind}:${s.id}`;
              const docs = shareDocs(s);
              const flags = accessFlags(s);
              const canSelect = s.status === "active";
              return (
                <tr key={key} className={selected.has(key) ? "is-selected" : undefined}>
                  <td className="col-check">
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      disabled={!canSelect}
                      onChange={() => toggleKey(key)}
                      aria-label={`Select share ${docs.map((d) => d.title || d.filename).join(", ")}`}
                    />
                  </td>
                  <td>
                    {docs.length === 0 ? (
                      <span className="muted">Deleted</span>
                    ) : (
                      <ul className="my-share-docs">
                        {docs.map((d) => (
                          <li key={d.id}>
                            <button
                              type="button"
                              className="file-name-link"
                              onClick={() => navigate(`/preview/${d.id}`)}
                            >
                              {d.title || d.filename}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{s.kind === "internal" ? "Internal" : "External"}</td>
                  <td>
                    {s.kind === "internal" && s.sharedWith
                      ? `${s.sharedWith.name} (${s.sharedWith.email})`
                      : s.recipientEmail || "—"}
                  </td>
                  <td className="muted">{flags || "—"}</td>
                  <td className="muted">{formatDate(s.expiresAt)}</td>
                  <td>{s.status}</td>
                  <td className="col-actions">
                    {s.url && s.status === "active" && s.kind === "external" ? (
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                          void navigator.clipboard.writeText(s.url!);
                          toast.success("Link copied");
                        }}
                      >
                        Copy
                      </button>
                    ) : null}
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
