import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PaginationMeta } from "../pagination";

type Props = {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  disabled?: boolean;
};

export function PaginationBar({ meta, onPageChange, disabled }: Props) {
  if (meta.total <= 0) return null;
  const canPrev = meta.page > 1;
  const canNext = meta.page < meta.totalPages;
  const from = (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);

  return (
    <div className="pagination-bar">
      <span className="pagination-summary muted">
        Showing {from}–{to} of {meta.total}
      </span>
      <div className="pagination-controls">
        <button
          type="button"
          className="pagination-btn"
          disabled={disabled || !canPrev}
          aria-label="Previous page"
          onClick={() => onPageChange(meta.page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="pagination-page">
          Page {meta.page} of {meta.totalPages}
        </span>
        <button
          type="button"
          className="pagination-btn"
          disabled={disabled || !canNext}
          aria-label="Next page"
          onClick={() => onPageChange(meta.page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
