import { useEffect, useState } from "react";
import { Clock, History, User, X } from "lucide-react";
import { api } from "../api";
import type { AuditTrailItem } from "../api";
import { PaginationBar } from "./PaginationBar";
import { emptyMeta, type PaginationMeta } from "../pagination";
import { toast } from "../toast";

type Props = {
  entityType: "document" | "folder";
  entityId: string;
  entityName: string;
  onClose: () => void;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function AuditTrailModal({ entityType, entityId, entityName, onClose }: Props) {
  const [items, setItems] = useState<AuditTrailItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>(emptyMeta());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const load =
      entityType === "document"
        ? api.listDocumentAuditTrails(entityId, { page })
        : api.listFolderAuditTrails(entityId, { page });
    void load
      .then((res) => {
        setItems(res.items);
        setMeta({
          page: res.page,
          limit: res.limit,
          total: res.total,
          totalPages: res.totalPages,
        });
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to load audit trail"))
      .finally(() => setLoading(false));
  }, [entityType, entityId, page]);

  return (
    <>
      <button type="button" className="folder-drawer-backdrop" aria-label="Close audit trail" onClick={onClose} />
      <aside className="folder-drawer audit-trail-drawer" aria-label="Audit trail">
        <header className="folder-drawer-header">
          <div className="audit-trail-title">
            <History size={18} aria-hidden />
            <div>
              <h2>Audit trail</h2>
              <p className="muted audit-trail-subtitle">{entityName}</p>
            </div>
          </div>
          <button type="button" className="folder-drawer-close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="folder-drawer-body audit-trail-body">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="muted">No activity recorded yet.</p>
          ) : (
            <ul className="audit-trail-list">
              {items.map((item) => (
                <li key={item.id} className="audit-trail-item">
                  <div className="audit-trail-row">
                    <span className="audit-trail-actor-icon" aria-hidden>
                      <User size={12} />
                    </span>
                    <span className="audit-trail-actor-name">{item.actorName}</span>
                    <span className="audit-trail-phrase">{item.actionPhrase}</span>
                    <span className="audit-trail-entity-name">{item.entityName}</span>
                  </div>
                  <div className="audit-trail-date">
                    <Clock size={11} aria-hidden />
                    <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!loading && meta.total > 0 ? (
            <PaginationBar meta={meta} onPageChange={setPage} />
          ) : null}
        </div>
      </aside>
    </>
  );
}
