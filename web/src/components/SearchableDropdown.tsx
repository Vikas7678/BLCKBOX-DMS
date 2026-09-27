import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X } from "lucide-react";

export type SearchableOption<T = string> = {
  value: T;
  label: string;
  sublabel?: string;
  /** Extra payload for multi user picks */
  data?: unknown;
};

type BaseProps<T> = {
  options: SearchableOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Async search — parent updates `options`. Called with debounce. */
  onSearch?: (query: string) => void;
  emptyMessage?: string;
  className?: string;
  "aria-label"?: string;
};

type SingleProps<T> = BaseProps<T> & {
  multiple?: false;
  value: T | null;
  onChange: (value: T | null, option: SearchableOption<T> | null) => void;
};

type MultiProps<T> = BaseProps<T> & {
  multiple: true;
  values: T[];
  onChange: (values: T[], options: SearchableOption<T>[]) => void;
};

export type SearchableDropdownProps<T = string> = SingleProps<T> | MultiProps<T>;

function optionKey<T>(value: T): string {
  return String(value);
}

export function SearchableDropdown<T = string>(props: SearchableDropdownProps<T>) {
  const {
    options,
    placeholder = "Select…",
    disabled = false,
    searchable = true,
    searchPlaceholder = "Search…",
    onSearch,
    emptyMessage = "No results",
    className = "",
    "aria-label": ariaLabel = "Select",
  } = props;

  const multiple = props.multiple === true;
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedValues: T[] = multiple
    ? props.values
    : props.value != null
      ? [props.value]
      : [];

  const selectedSet = new Set(selectedValues.map(optionKey));

  // Also keep labels for multi when option not in current filtered list
  const selectedMetaRef = useRef<Map<string, SearchableOption<T>>>(new Map());
  useEffect(() => {
    for (const o of options) {
      selectedMetaRef.current.set(optionKey(o.value), o);
    }
  }, [options]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const updateMenuPosition = useCallback(() => {
    const trigger = rootRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const maxH = 280;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const top = openUp
      ? Math.max(8, rect.top - Math.min(maxH, spaceAbove) - gap)
      : rect.bottom + gap;
    setMenuStyle({
      position: "fixed",
      top,
      left: rect.left,
      width: rect.width,
      maxHeight: openUp ? Math.min(maxH, spaceAbove) : Math.min(maxH, Math.max(spaceBelow, 160)),
      zIndex: 200,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, updateMenuPosition, options, query]);

  useEffect(() => {
    if (!open) return;
    function onReposition() {
      updateMenuPosition();
    }
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open || !onSearch) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => onSearch(query.trim()), 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, open, onSearch]);

  useEffect(() => {
    if (open && onSearch) onSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on open
  }, [open]);

  const filtered =
    searchable && !onSearch && query.trim()
      ? options.filter((o) => {
          const q = query.trim().toLowerCase();
          return (
            o.label.toLowerCase().includes(q) ||
            (o.sublabel?.toLowerCase().includes(q) ?? false)
          );
        })
      : options;

  function triggerLabel(): ReactNode {
    if (multiple) {
      if (selectedValues.length === 0) return <span className="muted">{placeholder}</span>;
      return (
        <span className="sdd-chips">
          {selectedValues.map((v) => {
            const key = optionKey(v);
            const opt =
              selectedMetaRef.current.get(key) ||
              options.find((o) => optionKey(o.value) === key);
            return (
              <span key={key} className="sdd-chip">
                {opt?.label ?? key}
                <button
                  type="button"
                  className="sdd-chip-remove"
                  aria-label="Remove"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    const nextVals = selectedValues.filter((x) => optionKey(x) !== key);
                    const nextOpts = nextVals
                      .map((x) => selectedMetaRef.current.get(optionKey(x)))
                      .filter(Boolean) as SearchableOption<T>[];
                    (props as MultiProps<T>).onChange(nextVals, nextOpts);
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </span>
      );
    }
    if (props.value == null) return <span className="muted">{placeholder}</span>;
    const opt =
      options.find((o) => optionKey(o.value) === optionKey(props.value)) ||
      selectedMetaRef.current.get(optionKey(props.value));
    return <span>{opt?.label ?? String(props.value)}</span>;
  }

  function pick(opt: SearchableOption<T>) {
    selectedMetaRef.current.set(optionKey(opt.value), opt);
    if (multiple) {
      const exists = selectedSet.has(optionKey(opt.value));
      const nextVals = exists
        ? selectedValues.filter((v) => optionKey(v) !== optionKey(opt.value))
        : [...selectedValues, opt.value];
      const nextOpts = nextVals
        .map((v) => selectedMetaRef.current.get(optionKey(v)))
        .filter(Boolean) as SearchableOption<T>[];
      (props as MultiProps<T>).onChange(nextVals, nextOpts);
      return;
    }
    (props as SingleProps<T>).onChange(opt.value, opt);
    close();
  }

  const menu =
    open &&
    createPortal(
      <div className="sdd-menu" role="presentation" ref={menuRef} style={menuStyle}>
        {searchable && (
          <div className="sdd-search">
            <Search size={14} aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              autoFocus
            />
          </div>
        )}
        <ul id={listId} className="sdd-options" role="listbox" aria-multiselectable={multiple}>
          {filtered.length === 0 ? (
            <li className="sdd-empty muted">{emptyMessage}</li>
          ) : (
            filtered.map((opt) => {
              const selected = selectedSet.has(optionKey(opt.value));
              return (
                <li key={optionKey(opt.value)} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    className={`sdd-option${selected ? " is-selected" : ""}`}
                    onClick={() => pick(opt)}
                  >
                    {multiple && (
                      <span className="sdd-check" aria-hidden>
                        {selected ? "✓" : ""}
                      </span>
                    )}
                    <span className="sdd-option-text">
                      <strong>{opt.label}</strong>
                      {opt.sublabel ? (
                        <span className="muted sdd-sublabel">{opt.sublabel}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>,
      document.body,
    );

  return (
    <div
      className={`sdd ${open ? "sdd--open" : ""} ${className}`.trim()}
      ref={rootRef}
    >
      <button
        type="button"
        className="sdd-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <span className="sdd-trigger-label">{triggerLabel()}</span>
        <ChevronDown size={16} className="sdd-chevron" aria-hidden />
      </button>
      {menu}
    </div>
  );
}
