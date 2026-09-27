import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { api } from "../api";

type PickerUser = { id: string; email: string; name: string };

export function AddUsersModal({
  workspaceId,
  excludeUserIds,
  onClose,
  onAdd,
}: {
  workspaceId: string;
  excludeUserIds: string[];
  onClose: () => void;
  onAdd: (users: PickerUser[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<PickerUser[]>([]);
  const [selected, setSelected] = useState<Map<string, PickerUser>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const exclude = useMemo(() => new Set(excludeUserIds), [excludeUserIds]);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      void api
        .listAddableUsers(workspaceId, query)
        .then((r) => {
          if (cancelled) return;
          setUsers(r.users.filter((u) => !exclude.has(u.id)));
          setError("");
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Failed to load users");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [workspaceId, query, exclude]);

  function toggle(user: PickerUser) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.set(user.id, user);
      return next;
    });
  }

  return (
    <div className="picker-modal-root" role="dialog" aria-modal="true" aria-label="Select users">
      <button type="button" className="picker-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="picker-modal">
        <header className="picker-modal-header">
          <h2>Select users</h2>
          <button type="button" className="picker-modal-close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="picker-modal-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            placeholder="Search name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search users"
            autoFocus
          />
        </div>
        <div className="picker-modal-body">
          {error && <p className="error">{error}</p>}
          {loading && <p className="muted">Loading…</p>}
          {!loading && users.length === 0 && (
            <p className="muted">No users available to add.</p>
          )}
          {!loading &&
            users.map((u) => {
              const isSelected = selected.has(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`picker-user-row${isSelected ? " is-selected" : ""}`}
                  onClick={() => toggle(u)}
                >
                  <span className="picker-user-check" aria-hidden>
                    {isSelected ? "−" : "+"}
                  </span>
                  <span className="picker-user-text">
                    <strong>{u.name}</strong>
                    <span className="muted">{u.email}</span>
                  </span>
                </button>
              );
            })}
        </div>
        <footer className="picker-modal-footer">
          <button type="button" className="folder-drawer-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-teal"
            disabled={selected.size === 0}
            onClick={() => onAdd(Array.from(selected.values()))}
          >
            Add selected users ({selected.size})
          </button>
        </footer>
      </div>
    </div>
  );
}
