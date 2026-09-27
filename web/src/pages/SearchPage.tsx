import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { WorkspaceItem } from "../api";
import { errMessage } from "../helpers/errors";

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void api
      .listWorkspaces({ limit: 100 })
      .then((r) => setWorkspaces(r.workspaces))
      .catch((err) => setError(errMessage(err, "Search failed")))
      .finally(() => setLoading(false));
  }, []);

  const matches = useMemo(() => {
    if (!q) return workspaces;
    return workspaces.filter((w) => w.name.toLowerCase().includes(q));
  }, [workspaces, q]);

  return (
    <div>
      <header className="page-header">
        <div>
          <h1>Search</h1>
          <p className="muted">
            {q ? (
              <>
                Results for <strong>{searchParams.get("q")}</strong>
              </>
            ) : (
              "Type a query in the top bar and press Enter."
            )}
          </p>
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Searching…</p>}

      {!loading && (
        <section>
          <h2>Workspaces</h2>
          {matches.length === 0 ? (
            <p className="muted">No matching workspaces.</p>
          ) : (
            <ul className="doc-list">
              {matches.map((ws) => (
                <li key={ws.id}>
                  <Link to={`/workspaces/${ws.id}`}>
                    <strong>{ws.name}</strong>
                  </Link>
                  <span className="muted">{ws.role}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
