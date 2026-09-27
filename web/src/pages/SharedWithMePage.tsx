import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { api } from "../api";
import type { SharedWithMeItem } from "../api";
import { toast } from "../toast";
import { PaginationBar } from "../components/PaginationBar";
import { emptyMeta, type PaginationMeta } from "../pagination";
import emptySharedWithMeImg from "../assets/empty-shared-with-me.svg";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function SharedWithMePage() {
  const [shares, setShares] = useState<SharedWithMeItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>(emptyMeta());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const res = await api.listSharedWithMe({ page });
      setShares(res.shares);
      setMeta({
        page: res.page,
        limit: res.limit,
        total: res.total,
        totalPages: res.totalPages,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await api.listSharedWithMe({ page });
      setShares(res.shares);
      setMeta({
        page: res.page,
        limit: res.limit,
        total: res.total,
        totalPages: res.totalPages,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, [page]);

  return (
    <div className="settings-page">
      <header className="page-header">
        <div>
          <h1>Shared with me</h1>
          <p className="muted">
            Documents other BLCKBOX users shared with you. View only — delete is not allowed.
          </p>
        </div>
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
      </header>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : meta.total === 0 ? (
        <div className="empty-folder trash-empty">
          <img
            src={emptySharedWithMeImg}
            alt=""
            className="empty-folder-art"
            width={280}
            height={180}
          />
          <p className="empty-folder-title">Nothing shared with you</p>
          <p className="empty-folder-sub">
            When a colleague shares a document with your account, it will appear here.
          </p>
        </div>
      ) : (
        <>
        <table className="file-table">
          <thead>
            <tr>
              <th>Document</th>
              <th>Shared by</th>
              <th>Expires</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {shares.map((s) => (
              <tr key={s.id}>
                <td>
                  <button
                    type="button"
                    className="file-name-link"
                    onClick={() => navigate(`/preview/${s.document.id}`)}
                  >
                    {s.document.title || s.document.filename}
                  </button>
                </td>
                <td>
                  {s.sharedBy.name} ({s.sharedBy.email})
                </td>
                <td className="muted">{formatDate(s.expiresAt)}</td>
                <td className="muted">{s.message || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <PaginationBar meta={meta} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
