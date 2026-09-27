import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { PasswordInput } from "../components/PasswordInput";
import { errMessage } from "../helpers/errors";

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { user } = await api.login({ email, password });
      setUser(user);
      const next = search.get("next") || "/";
      navigate(next);
    } catch (err) {
      setError(errMessage(err, "Login failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Sign in</h1>
      <p className="muted">BLCKBOX file storage</p>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            disabled={busy}
          />
        </label>
        <label>
          Password
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={busy}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

/** Public bootstrap register removed — accounts come from seed + admin Users page. */
export function RegisterPage() {
  return <Navigate to="/login" replace />;
}
