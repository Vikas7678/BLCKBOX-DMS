import { useCallback, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api";
import { SearchableDropdown, type SearchableOption } from "./SearchableDropdown";

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
  const [selected, setSelected] = useState<PickerUser | null>(null);
  const [options, setOptions] = useState<SearchableOption<string>[]>([]);
  const [error, setError] = useState("");

  const exclude = useMemo(() => new Set(excludeUserIds), [excludeUserIds]);
  const excludeRef = useRef(exclude);
  excludeRef.current = exclude;

  const loadUsers = useCallback(
    (q: string) => {
      void api
        .listAddableUsers(workspaceId, q)
        .then((r) => {
          const blocked = excludeRef.current;
          setOptions(
            r.users
              .filter((u) => !blocked.has(u.id))
              .map((u) => ({
                value: u.id,
                label: u.name || u.email,
                sublabel: u.email,
                data: u,
              })),
          );
          setError("");
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to load users");
          setOptions([]);
        });
    },
    [workspaceId],
  );

  const mergedOptions = selected
    ? [
        {
          value: selected.id,
          label: selected.name || selected.email,
          sublabel: selected.email,
          data: selected,
        },
        ...options.filter((o) => o.value !== selected.id),
      ]
    : options;

  return (
    <div className="picker-modal-root" role="dialog" aria-modal="true" aria-label="Select user">
      <button type="button" className="picker-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="picker-modal">
        <header className="picker-modal-header">
          <h2>Select user</h2>
          <button type="button" className="picker-modal-close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="picker-modal-body">
          {error && <p className="error">{error}</p>}
          <SearchableDropdown
            value={selected?.id ?? null}
            options={mergedOptions}
            onSearch={loadUsers}
            placeholder="Select user…"
            searchPlaceholder="Search name or email"
            aria-label="Select user"
            emptyMessage="No users available to add"
            onChange={(_id, opt) => {
              if (!opt) {
                setSelected(null);
                return;
              }
              const data = opt.data as PickerUser | undefined;
              setSelected(
                data ?? { id: String(opt.value), email: opt.sublabel || "", name: opt.label },
              );
            }}
          />
        </div>
        <footer className="picker-modal-footer">
          <button type="button" className="folder-drawer-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-teal"
            disabled={!selected}
            onClick={() => {
              if (selected) onAdd([selected]);
            }}
          >
            Add selected user
          </button>
        </footer>
      </div>
    </div>
  );
}
