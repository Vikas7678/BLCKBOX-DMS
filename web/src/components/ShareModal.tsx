import { useCallback, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { getIcon } from "material-file-icons";
import { api } from "../api";
import { PasswordInput } from "./PasswordInput";
import { SearchableDropdown, type SearchableOption } from "./SearchableDropdown";
import { toast } from "../toast";

function defaultExpiryLocal(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIsoFromLocal(local: string): string {
  const d = new Date(local);
  return d.toISOString();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function FileTypeIcon({ filename }: { filename: string }) {
  const icon = getIcon(filename);
  return (
    <span
      className="file-type-icon"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}

export function ShareModal({
  documents: documentsProp,
  documentId,
  documentName,
  onClose,
}: {
  documents?: { id: string; name: string }[];
  /** @deprecated Prefer `documents` */
  documentId?: string;
  documentName?: string;
  onClose: () => void;
}) {
  const documents =
    documentsProp && documentsProp.length
      ? documentsProp
      : documentId
        ? [{ id: documentId, name: documentName || "Document" }]
        : [];
  const documentIds = documents.map((d) => d.id);

  const [mode, setMode] = useState<"internal" | "external">("internal");
  const [message, setMessage] = useState("");
  const [expiresLocal, setExpiresLocal] = useState(defaultExpiryLocal);
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [allowDownload, setAllowDownload] = useState(false);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientDraft, setRecipientDraft] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<{ id: string; email: string; name: string }[]>(
    [],
  );
  const [userOptions, setUserOptions] = useState<SearchableOption<string>[]>([]);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  selectedIdsRef.current = new Set(selectedUsers.map((u) => u.id));
  const [busy, setBusy] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const loadShareUsers = useCallback((q: string) => {
    void api
      .searchShareUsers(q)
      .then((r) => {
        const selected = selectedIdsRef.current;
        setUserOptions(
          r.users
            .filter((u) => !selected.has(u.id))
            .map((u) => ({
              value: u.id,
              label: u.name || u.email,
              sublabel: u.email,
              data: u,
            })),
        );
      })
      .catch(() => setUserOptions([]));
  }, []);

  function addRecipient(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!email) return;
    if (!isValidEmail(email)) {
      toast.error(`Invalid email: ${raw.trim()}`);
      return;
    }
    setRecipients((prev) => (prev.includes(email) ? prev : [...prev, email]));
    setRecipientDraft("");
  }

  function onRecipientKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addRecipient(recipientDraft.replace(/,/g, ""));
    } else if (e.key === "Backspace" && !recipientDraft && recipients.length) {
      setRecipients((prev) => prev.slice(0, -1));
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const expiresAt = toIsoFromLocal(expiresLocal);
      if (Number.isNaN(new Date(expiresAt).getTime()) || new Date(expiresAt) <= new Date()) {
        toast.error("Expiry must be in the future");
        return;
      }

      if (mode === "internal") {
        if (selectedUsers.length === 0) {
          toast.error("Select at least one user to share with");
          return;
        }
        const result = await api.shareBatchInternal({
          documentIds,
          userIds: selectedUsers.map((u) => u.id),
          expiresAt,
          message: message.trim() || undefined,
        });
        toast.success(
          result.emailSent
            ? `Shared ${result.count} file(s) and email sent`
            : `Shared ${result.count} file(s) (email not sent — check SMTP settings)`,
        );
        onClose();
        return;
      }

      if (usePassword && password.trim().length < 4) {
        toast.error("Password must be at least 4 characters");
        return;
      }

      const pending = recipientDraft.trim().toLowerCase();
      const allRecipients = [...recipients];
      if (pending) {
        if (!isValidEmail(pending)) {
          toast.error(`Invalid email: ${recipientDraft.trim()}`);
          return;
        }
        if (!allRecipients.includes(pending)) allRecipients.push(pending);
      }

      const { share } = await api.shareBatchExternal({
        documentIds,
        recipients: allRecipients,
        expiresAt,
        password: usePassword ? password.trim() : undefined,
        message: message.trim() || undefined,
        allowDownload,
      });
      setCreatedUrl(share.url);
      if (allRecipients.length) {
        toast.success(
          share.emailSent
            ? "Link generated and emailed"
            : "Link generated (email not sent — check SMTP settings)",
        );
      } else {
        toast.success("Share link generated");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Share failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card share-modal"
        role="dialog"
        aria-labelledby="share-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="share-modal-header">
          <h2 id="share-modal-title">Share</h2>
        </header>

        <section className="share-modal-documents">
          <p className="share-modal-documents-subtitle">
            {documents.length === 1
              ? "1 document"
              : `${documents.length} documents`}
          </p>
          <div className="share-modal-documents-panel">
            <div className="share-modal-documents-head">Name</div>
            <ul className="share-modal-documents-rows">
              {documents.map((d) => (
                <li key={d.id}>
                  <div className="share-modal-document-row">
                    <span className="share-modal-document-icon">
                      <FileTypeIcon filename={d.name} />
                    </span>
                    <span className="share-modal-document-name" title={d.name}>
                      {d.name}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {createdUrl ? (
          <div className="share-modal-body">
            <p>Share link created. Copy and send it if needed.</p>
            <code className="share-link-code">{createdUrl}</code>
            <div className="actions">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(createdUrl);
                  toast.success("Link copied");
                }}
              >
                Copy link
              </button>
              <button type="button" className="ghost-btn" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form className="share-modal-body settings-form" onSubmit={(e) => void onSubmit(e)}>
            <div className="share-mode-tabs">
              <button
                type="button"
                className={mode === "internal" ? "active" : undefined}
                onClick={() => setMode("internal")}
              >
                Internal user
              </button>
              <button
                type="button"
                className={mode === "external" ? "active" : undefined}
                onClick={() => setMode("external")}
              >
                External link
              </button>
            </div>

            {mode === "internal" ? (
              <label>
                <span className="settings-label-text">
                  Share with <span className="req">*</span>
                </span>
                <SearchableDropdown
                  multiple
                  values={selectedUsers.map((u) => u.id)}
                  options={[
                    ...selectedUsers.map((u) => ({
                      value: u.id,
                      label: u.name || u.email,
                      sublabel: u.email,
                      data: u,
                    })),
                    ...userOptions.filter(
                      (o) => !selectedUsers.some((u) => u.id === o.value),
                    ),
                  ]}
                  onSearch={loadShareUsers}
                  placeholder="Select users…"
                  searchPlaceholder="Search by name or email"
                  aria-label="Share with users"
                  onChange={(_ids, opts) => {
                    setSelectedUsers(
                      opts.map((o) => {
                        const data = o.data as { id: string; email: string; name: string } | undefined;
                        return data ?? { id: String(o.value), email: o.sublabel || "", name: o.label };
                      }),
                    );
                  }}
                />
              </label>
            ) : (
              <>
                <label>
                  <span className="settings-label-text">Recipients (optional)</span>
                  <div className="share-recipient-input">
                    {recipients.map((email) => (
                      <button
                        key={email}
                        type="button"
                        className="share-recipient-chip"
                        onClick={() =>
                          setRecipients((prev) => prev.filter((r) => r !== email))
                        }
                        title="Remove"
                      >
                        {email} ×
                      </button>
                    ))}
                    <input
                      value={recipientDraft}
                      onChange={(e) => setRecipientDraft(e.target.value)}
                      onKeyDown={onRecipientKeyDown}
                      onBlur={() => {
                        if (recipientDraft.trim()) addRecipient(recipientDraft);
                      }}
                      placeholder={
                        recipients.length ? "Add another email" : "Enter email, press Enter"
                      }
                      autoComplete="off"
                    />
                  </div>
                </label>

                <div className="share-toggle-row">
                  <div className="share-toggle-item">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={allowDownload}
                      className={
                        allowDownload ? "share-toggle share-toggle--on" : "share-toggle"
                      }
                      onClick={() => setAllowDownload((v) => !v)}
                    />
                    <span>Allow download</span>
                  </div>
                  <div className="share-toggle-item">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={usePassword}
                      className={
                        usePassword ? "share-toggle share-toggle--on" : "share-toggle"
                      }
                      onClick={() => setUsePassword((v) => !v)}
                    />
                    <span>Set password</span>
                  </div>
                </div>

                {usePassword && (
                  <label>
                    <span className="settings-label-text">
                      Password <span className="req">*</span>
                    </span>
                    <PasswordInput
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 4 characters"
                      required
                    />
                  </label>
                )}
              </>
            )}

            <label>
              <span className="settings-label-text">
                Expires <span className="req">*</span>
              </span>
              <input
                type="datetime-local"
                value={expiresLocal}
                onChange={(e) => setExpiresLocal(e.target.value)}
                required
              />
            </label>

            <label>
              <span className="settings-label-text">Message (optional)</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="Add a note for the recipient"
              />
            </label>

            <p className="muted share-hint">Recipients can view the document but cannot delete it.</p>

            <div className="actions">
              <button type="submit" disabled={busy}>
                {busy
                  ? mode === "external"
                    ? "Generating…"
                    : "Sharing…"
                  : mode === "external"
                    ? "Generate link"
                    : "Share"}
              </button>
              <button type="button" className="ghost-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
