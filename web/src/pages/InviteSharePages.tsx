import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Download, Ellipsis, Link2Off } from "lucide-react";
import { api } from "../api";
import type { OnlyOfficePreviewPayload } from "../api";
import { useAuth } from "../AuthContext";
import { OnlyOfficePreviewer } from "../components/OnlyOfficePreviewer";
import { PreviewErrorBoundary } from "../components/PreviewErrorBoundary";
import { PasswordInput } from "../components/PasswordInput";
import { errMessage } from "../helpers/errors";
import { loginWithNext } from "../helpers/authRedirect";

function formatShareExpiry(expiresAt: string | undefined | null): string {
  if (!expiresAt) return "";
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return expiresAt;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function InvitePage() {
  const { token } = useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{
    email: string;
    role: string;
    workspaceName: string;
    needsAccount: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) return;
    void api
      .getInvite(token)
      .then((r) => setInfo(r.invitation))
      .catch((err) => setError(errMessage(err, "Invalid invite")));
  }, [token]);

  async function accept() {
    if (!token) return;
    setError("");
    try {
      const res = await api.acceptInvite(token);
      setMessage("Joined workspace.");
      navigate(`/workspaces/${res.workspaceId}`);
    } catch (err) {
      setError(errMessage(err, "Could not accept invite"));
    }
  }

  if (loading) return <p className="layout">Loading…</p>;

  return (
    <div className="layout auth-card">
      <h1>Workspace invitation</h1>
      {error && <p className="error">{error}</p>}
      {info && (
        <>
          <p>
            You are invited to <strong>{info.workspaceName}</strong> as <strong>{info.role}</strong>{" "}
            ({info.email}).
          </p>
          {!user && (
            <p>
              {info.needsAccount ? (
                <>
                  An administrator must create an account for <strong>{info.email}</strong> first.
                  Then <Link to={`/login?next=/invite/${token}`}>sign in</Link> to accept.
                </>
              ) : (
                <>
                  <Link to={`/login?next=/invite/${token}`}>Sign in</Link> as {info.email} to
                  accept.
                </>
              )}
            </p>
          )}
          {user && (
            <>
              {user.email.toLowerCase() !== info.email.toLowerCase() ? (
                <p className="error">
                  Signed in as {user.email}, but this invite is for {info.email}.
                </p>
              ) : (
                <button type="button" onClick={() => void accept()}>
                  Accept invitation
                </button>
              )}
            </>
          )}
        </>
      )}
      {message && <p>{message}</p>}
    </div>
  );
}

function ShareBrandToolbar() {
  return (
    <header className="external-share-viewer__toolbar">
      <div className="external-share-viewer__toolbar-brand">
        <span className="external-share-viewer__logo-text">BLCKBOX</span>
      </div>
    </header>
  );
}

function ShareToolbar({
  fileName,
  allowDownload,
  downloadHref,
  shareMessage,
  expiresAt,
  showBack,
  onBack,
}: {
  fileName: string;
  allowDownload: boolean;
  downloadHref?: string;
  shareMessage?: string | null;
  expiresAt?: string;
  showBack?: boolean;
  onBack?: () => void;
}) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="external-share-viewer__toolbar">
      <div className="external-share-viewer__toolbar-brand">
        <span className="external-share-viewer__logo-text">BLCKBOX</span>
      </div>

      <div className="external-share-viewer__toolbar-center">
        {showBack && onBack ? (
          <button type="button" className="external-share-viewer__back-btn" onClick={onBack}>
            ← Back to documents
          </button>
        ) : null}
        {fileName ? (
          <span className="external-share-viewer__filename" title={fileName}>
            {fileName}
          </span>
        ) : null}
      </div>

      <div className="external-share-viewer__toolbar-actions">
        <div className="external-share-viewer__menu" ref={menuRef}>
          <button
            type="button"
            className="external-share-viewer__icon-btn"
            aria-label="More"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Ellipsis size={18} />
          </button>
          {menuOpen ? (
            <div className="external-share-viewer__menu-panel">
              {shareMessage ? (
                <div className="external-share-viewer__menu-item">
                  <span>Message</span>
                  <p>{shareMessage}</p>
                </div>
              ) : null}
              {expiresAt ? (
                <div className="external-share-viewer__menu-item">
                  <span>Expires</span>
                  <p>{formatShareExpiry(expiresAt)}</p>
                </div>
              ) : null}
              <div className="external-share-viewer__menu-item">
                <span>Access</span>
                <p>{allowDownload ? "Download allowed" : "View only"}</p>
              </div>
            </div>
          ) : null}
        </div>

        {allowDownload && downloadHref ? (
          <a
            className="external-share-viewer__pill-btn external-share-viewer__pill-btn--outline"
            href={downloadHref}
          >
            <Download size={14} aria-hidden />
            Download
          </a>
        ) : null}

        <Link
          to={loginWithNext(`${location.pathname}${location.search}`)}
          className="external-share-viewer__pill-btn external-share-viewer__pill-btn--primary"
        >
          Log in
        </Link>
      </div>
    </header>
  );
}

type ShareDoc = {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  name?: string;
};

export function SharePage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [documents, setDocuments] = useState<ShareDoc[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [meta, setMeta] = useState<{
    message: string | null;
    expiresAt: string;
    allowDownload: boolean;
    sharedByName: string;
  } | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [payload, setPayload] = useState<OnlyOfficePreviewPayload | null>(null);
  const [previewError, setPreviewError] = useState("");

  const selectedDoc =
    documents.find((d) => d.id === selectedDocId) ||
    (documents.length === 1 ? documents[0] : null);
  const isListView = documents.length > 1 && !selectedDocId;

  async function loadPreview(shareToken: string, documentId: string) {
    try {
      const preview = await api.getSharePreview(shareToken, documentId);
      setPayload(preview);
      setPreviewError("");
    } catch (err) {
      setPayload(null);
      setPreviewError(errMessage(err, "Preview unavailable"));
    }
  }

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError("");
    void api
      .getShare(token)
      .then((r) => {
        setNeedsPassword(r.share.needsPassword);
        const docs = r.share.documents?.length
          ? r.share.documents
          : r.share.document
            ? [r.share.document]
            : [];
        setDocuments(docs);
        setMeta({
          message: r.share.message,
          expiresAt: r.share.expiresAt,
          allowDownload: r.share.allowDownload,
          sharedByName: r.share.sharedByName,
        });
        if (!r.share.needsPassword && docs.length === 1) {
          setSelectedDocId(docs[0].id);
          void loadPreview(token, docs[0].id);
        }
      })
      .catch((err) => setError(errMessage(err, "This link is invalid or has expired")))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    document.documentElement.classList.add("public-share-page-active");
    document.body.classList.add("public-share-page-active");
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.classList.remove("public-share-page-active");
      document.body.classList.remove("public-share-page-active");
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    if (!token || unlocking || !password.trim()) return;
    setPasswordError("");
    setUnlocking(true);
    try {
      const res = await api.unlockShare(token, password);
      setNeedsPassword(false);
      const docs = res.documents?.length ? res.documents : res.document ? [res.document] : [];
      setDocuments(docs);
      if (docs.length === 1) {
        setSelectedDocId(docs[0].id);
        void loadPreview(token, docs[0].id);
      }
    } catch (err) {
      setPasswordError(errMessage(err, "Invalid password"));
    } finally {
      setUnlocking(false);
    }
  }

  function selectDocument(id: string) {
    if (!token) return;
    setSelectedDocId(id);
    setPayload(null);
    setPreviewError("");
    void loadPreview(token, id);
  }

  const documentType =
    payload?.mode === "onlyoffice"
      ? (payload.config.documentType as string | undefined)
      : undefined;
  const fileName = selectedDoc
    ? selectedDoc.name || selectedDoc.title || selectedDoc.filename
    : "";

  if (loading) {
    return (
      <div className="external-share-viewer external-share-viewer--state">
        <ShareBrandToolbar />
        <div className="external-share-viewer__state">
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (error && !needsPassword && !documents.length) {
    return (
      <div className="external-share-viewer external-share-viewer--state">
        <ShareBrandToolbar />
        <div className="external-share-viewer__state external-share-viewer__state--error">
          <Link2Off size={28} aria-hidden />
          <h1>Invalid link</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (needsPassword) {
    return (
      <div className="external-share-viewer external-share-viewer--state">
        <ShareBrandToolbar />
        <div className="external-share-viewer__password-gate">
          <div className="external-share-viewer__password-card">
            <h1>Password required</h1>
            <p>Enter the password to view this shared document.</p>
            {meta?.expiresAt ? (
              <p className="external-share-viewer__password-meta">
                Expires: {formatShareExpiry(meta.expiresAt)}
              </p>
            ) : null}
            <form onSubmit={(e) => void unlock(e)}>
              <label htmlFor="external-share-password">Password</label>
              <PasswordInput
                id="external-share-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError("");
                }}
                autoComplete="current-password"
                autoFocus
                disabled={unlocking}
                aria-invalid={Boolean(passwordError)}
                aria-describedby={passwordError ? "external-share-password-error" : undefined}
              />
              {passwordError ? (
                <p
                  id="external-share-password-error"
                  className="external-share-viewer__password-error"
                  role="alert"
                >
                  {passwordError}
                </p>
              ) : null}
              <button
                type="submit"
                className="external-share-viewer__submit-btn"
                disabled={unlocking || !password.trim()}
              >
                {unlocking ? "Unlocking…" : "Continue"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="external-share-viewer">
      <ShareToolbar
        fileName={isListView ? "" : fileName}
        allowDownload={Boolean(meta?.allowDownload)}
        downloadHref={
          meta?.allowDownload && token && selectedDoc
            ? api.shareDownloadUrl(token, selectedDoc.id)
            : undefined
        }
        shareMessage={meta?.message}
        expiresAt={meta?.expiresAt}
        showBack={documents.length > 1 && Boolean(selectedDocId)}
        onBack={() => {
          setSelectedDocId("");
          setPayload(null);
          setPreviewError("");
        }}
      />

      <main
        className={`external-share-viewer__stage${
          isListView ? " external-share-viewer__stage--list" : ""
        }`}
      >
        {isListView ? (
          <div className="external-share-viewer__document-list">
            <div className="external-share-viewer__document-list-intro">
              <h2 className="external-share-viewer__document-list-title">Shared documents</h2>
              <p className="external-share-viewer__document-list-subtitle">
                {documents.length} documents in this share
              </p>
            </div>
            <div className="external-share-viewer__document-list-panel">
              <div className="external-share-viewer__document-list-head">Name</div>
              <ul className="external-share-viewer__document-list-rows">
                {documents.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className="external-share-viewer__document-list-row"
                      onClick={() => selectDocument(d.id)}
                    >
                      <span className="external-share-viewer__document-list-name">
                        {d.name || d.title || d.filename}
                      </span>
                      <span aria-hidden>›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <>
            {previewError ? (
              <div className="external-share-viewer__state">
                <p>{previewError}</p>
              </div>
            ) : null}
            {payload?.mode === "image" && (
              <div className="external-share-viewer__image-stage">
                <img
                  src={payload.url}
                  alt={payload.title}
                  className="external-share-viewer__image"
                />
              </div>
            )}
            {payload?.mode === "onlyoffice" && selectedDoc && (
              <div className="external-share-viewer__onlyoffice">
                <PreviewErrorBoundary resetKey={selectedDoc.id}>
                  <OnlyOfficePreviewer
                    documentId={selectedDoc.id}
                    documentServerUrl={payload.documentServerUrl}
                    config={payload.config}
                    documentType={documentType}
                  />
                </PreviewErrorBoundary>
              </div>
            )}
            {!previewError && !payload ? (
              <div className="external-share-viewer__state" aria-busy="true">
                <p>Loading…</p>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
