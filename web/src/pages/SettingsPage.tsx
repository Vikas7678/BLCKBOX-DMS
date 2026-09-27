import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Navigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { canAccessSettings } from "../permissions";
import { PasswordInput } from "../components/PasswordInput";
import { toast } from "../toast";
import { errMessage } from "../helpers/errors";

function EmailSettings() {
  const [form, setForm] = useState({
    fromEmail: "",
    fromName: "",
    host: "",
    port: "587",
    username: "",
    password: "",
    useSecureConnection: false,
  });
  const [passwordSet, setPasswordSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void api
      .getSmtpSettings()
      .then(({ smtp }) => {
        setForm({
          fromEmail: smtp.fromEmail,
          fromName: smtp.fromName,
          host: smtp.host,
          port: String(smtp.port || 587),
          username: smtp.username,
          password: "",
          useSecureConnection: smtp.useSecureConnection,
        });
        setPasswordSet(smtp.passwordSet);
      })
      .catch((err) => toast.error(errMessage(err, "Failed to load SMTP")))
      .finally(() => setLoading(false));
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { smtp } = await api.updateSmtpSettings({
        fromEmail: form.fromEmail,
        fromName: form.fromName,
        host: form.host,
        port: Number(form.port) || 587,
        username: form.username,
        password: form.password || undefined,
        useSecureConnection: form.useSecureConnection,
      });
      setPasswordSet(smtp.passwordSet);
      setForm((f) => ({ ...f, password: "" }));
      toast.success("SMTP settings saved");
    } catch (err) {
      toast.error(errMessage(err, "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    try {
      await api.testSmtpSettings();
      toast.success("Test email sent");
    } catch (err) {
      toast.error(errMessage(err, "Test failed"));
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <p className="muted">Loading settings…</p>;

  return (
    <section className="settings-card">
      <h2>Email Configuration</h2>
      <form className="settings-form" onSubmit={(e) => void onSave(e)}>
        <label>
          <span className="settings-label-text">
            Default From Email <span className="req">*</span>
          </span>
          <input
            type="email"
            value={form.fromEmail}
            onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
            placeholder="noreply@example.com"
            required
          />
        </label>
        <label>
          <span className="settings-label-text">
            Default From Name <span className="req">*</span>
          </span>
          <input
            value={form.fromName}
            onChange={(e) => setForm({ ...form, fromName: e.target.value })}
            placeholder="BLCKBOX"
            required
          />
        </label>
        <label>
          <span className="settings-label-text">
            SMTP Host <span className="req">*</span>
          </span>
          <input
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
            placeholder="smtp.example.com"
            required
          />
        </label>
        <label>
          <span className="settings-label-text">
            SMTP Port <span className="req">*</span>
          </span>
          <input
            type="number"
            value={form.port}
            onChange={(e) => setForm({ ...form, port: e.target.value })}
            placeholder="587"
            required
          />
        </label>
        <label>
          <span className="settings-label-text">SMTP Username</span>
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            autoComplete="off"
          />
        </label>
        <label>
          <span className="settings-label-text">SMTP Password</span>
          <PasswordInput
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={passwordSet ? "Leave blank to keep current password" : ""}
            autoComplete="new-password"
          />
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={form.useSecureConnection}
            onChange={(e) => setForm({ ...form, useSecureConnection: e.target.checked })}
          />
          Use Secure Connection (TLS/SSL)
        </label>
        <div className="actions">
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" disabled={testing} onClick={() => void onTest()}>
            {testing ? "Sending…" : "Test Email Configuration"}
          </button>
        </div>
      </form>
    </section>
  );
}

function StorageSettings() {
  const [form, setForm] = useState({
    provider: "local" as "local" | "s3",
    localPath: "",
    s3Bucket: "",
    s3Region: "",
    s3AccessKeyId: "",
    s3SecretAccessKey: "",
    s3Endpoint: "",
    s3ForcePathStyle: false,
  });
  const [secretSet, setSecretSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void api
      .getStorageSettings()
      .then(({ storage }) => {
        setForm({
          provider: storage.provider,
          localPath: storage.localPath,
          s3Bucket: storage.s3Bucket,
          s3Region: storage.s3Region,
          s3AccessKeyId: storage.s3AccessKeyId,
          s3SecretAccessKey: "",
          s3Endpoint: storage.s3Endpoint,
          s3ForcePathStyle: storage.s3ForcePathStyle,
        });
        setSecretSet(storage.s3SecretSet);
      })
      .catch((err) => toast.error(errMessage(err, "Failed to load storage")))
      .finally(() => setLoading(false));
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { storage } = await api.updateStorageSettings({
        provider: form.provider,
        localPath: form.localPath,
        s3Bucket: form.s3Bucket,
        s3Region: form.s3Region,
        s3AccessKeyId: form.s3AccessKeyId,
        s3SecretAccessKey: form.s3SecretAccessKey || undefined,
        s3Endpoint: form.s3Endpoint,
        s3ForcePathStyle: form.s3ForcePathStyle,
      });
      setSecretSet(storage.s3SecretSet);
      setForm((f) => ({ ...f, s3SecretAccessKey: "" }));
      toast.success("Storage settings saved");
    } catch (err) {
      toast.error(errMessage(err, "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    try {
      await api.testStorageSettings();
      toast.success("Storage connection OK");
    } catch (err) {
      toast.error(errMessage(err, "Test failed"));
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <p className="muted">Loading settings…</p>;

  return (
    <section className="settings-card">
      <h2>Storage Configuration</h2>
      <p className="muted">
        Choose where uploaded files are stored. Switching provider does not move existing files.
      </p>
      <form className="settings-form" onSubmit={(e) => void onSave(e)}>
        <fieldset className="settings-provider">
          <legend>Storage provider</legend>
          <label className="settings-check">
            <input
              type="radio"
              name="provider"
              checked={form.provider === "local"}
              onChange={() => setForm({ ...form, provider: "local" })}
            />
            Local filesystem
          </label>
          <label className="settings-check">
            <input
              type="radio"
              name="provider"
              checked={form.provider === "s3"}
              onChange={() => setForm({ ...form, provider: "s3" })}
            />
            Amazon S3 (or S3-compatible)
          </label>
        </fieldset>

        {form.provider === "local" && (
          <label>
            <span className="settings-label-text">
              Local storage path <span className="req">*</span>
            </span>
            <input
              value={form.localPath}
              onChange={(e) => setForm({ ...form, localPath: e.target.value })}
              placeholder="./data/uploads"
              required
            />
          </label>
        )}

        {form.provider === "s3" && (
          <>
            <label>
              <span className="settings-label-text">
                Bucket <span className="req">*</span>
              </span>
              <input
                value={form.s3Bucket}
                onChange={(e) => setForm({ ...form, s3Bucket: e.target.value })}
                required
              />
            </label>
            <label>
              <span className="settings-label-text">
                Region <span className="req">*</span>
              </span>
              <input
                value={form.s3Region}
                onChange={(e) => setForm({ ...form, s3Region: e.target.value })}
                placeholder="us-east-1"
                required
              />
            </label>
            <label>
              <span className="settings-label-text">
                Access Key ID <span className="req">*</span>
              </span>
              <input
                value={form.s3AccessKeyId}
                onChange={(e) => setForm({ ...form, s3AccessKeyId: e.target.value })}
                autoComplete="off"
                required
              />
            </label>
            <label>
              <span className="settings-label-text">
                Secret Access Key {!secretSet && <span className="req">*</span>}
              </span>
              <PasswordInput
                value={form.s3SecretAccessKey}
                onChange={(e) => setForm({ ...form, s3SecretAccessKey: e.target.value })}
                placeholder={secretSet ? "Leave blank to keep current secret" : ""}
                autoComplete="new-password"
                required={!secretSet}
              />
            </label>
            <label>
              <span className="settings-label-text">Endpoint</span>
              <input
                value={form.s3Endpoint}
                onChange={(e) => setForm({ ...form, s3Endpoint: e.target.value })}
                placeholder="https://s3.amazonaws.com or MinIO URL"
              />
            </label>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={form.s3ForcePathStyle}
                onChange={(e) => setForm({ ...form, s3ForcePathStyle: e.target.checked })}
              />
              Force path-style URLs (MinIO / some S3-compatible stores)
            </label>
          </>
        )}

        <div className="actions">
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" disabled={testing} onClick={() => void onTest()}>
            {testing ? "Testing…" : "Test Storage Connection"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function SettingsPage({ tab = "email" }: { tab?: "email" | "storage" }) {
  const { user } = useAuth();
  if (!canAccessSettings(user?.platformRole)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="settings-page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">System configuration for email and file storage.</p>
        </div>
      </header>

      <nav className="settings-tabs">
        <NavLink to="/settings" end className={({ isActive }) => (isActive ? "active" : undefined)}>
          Email Configuration
        </NavLink>
        <NavLink
          to="/settings/storage"
          className={({ isActive }) => (isActive ? "active" : undefined)}
        >
          Storage Configuration
        </NavLink>
      </nav>

      {tab === "email" ? <EmailSettings /> : <StorageSettings />}
    </div>
  );
}
