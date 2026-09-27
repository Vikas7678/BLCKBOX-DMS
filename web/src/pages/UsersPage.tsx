import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Plus, RefreshCw, Search, X } from "lucide-react";
import { api } from "../api";
import type { ColleagueUser } from "../api";
import { useAuth } from "../AuthContext";
import { canAccessUsers, canManageUsers } from "../permissions";
import { confirmDanger } from "../alertify";
import { PasswordInput } from "../components/PasswordInput";
import { PaginationBar } from "../components/PaginationBar";
import { SearchableDropdown } from "../components/SearchableDropdown";
import {emptyMeta, type PaginationMeta, toPaginationMeta} from "../pagination";
import { toast } from "../toast";
import { errMessage } from "../helpers/errors";
import { formatDate } from "../helpers/date";


function roleLabel(role: ColleagueUser["platformRole"]) {
  if (role === "admin") return "Admin";
  if (role === "owner") return "Owner";
  return "Member";
}

const PLATFORM_ROLE_OPTIONS: {
  value: ColleagueUser["platformRole"];
  label: string;
}[] = [
  { value: "admin", label: "Admin" },
  { value: "owner", label: "Owner" },
  { value: "member", label: "Member" },
];

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  platformRole: "member" as ColleagueUser["platformRole"],
};

export function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<ColleagueUser[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>(emptyMeta());
  const [page, setPage] = useState(1);
  const [canManage, setCanManage] = useState(false);
  const [filter, setFilter] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const allowed = canAccessUsers(me?.platformRole);

  async function load(opts?: { page?: number; q?: string }) {
    const p = opts?.page ?? page;
    const q = opts?.q ?? appliedQ;
    const r = await api.listUsers({ page: p, q });
    setUsers(r.users);
    setMeta(toPaginationMeta(r));
    setCanManage(r.canManage ?? canManageUsers(me?.platformRole));
  }

  useEffect(() => {
    if (!allowed) return;
    void load().catch((err) =>
      setError(errMessage(err, "Failed to load users")),
    );
  }, [allowed, page, appliedQ]);

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      await load();
    } catch (err) {
      toast.error(errMessage(err, "Refresh failed"));
    } finally {
      setRefreshing(false);
    }
  }

  function openCreate() {
    setForm(emptyForm);
    setCreating(true);
  }

  function closeCreate() {
    setCreating(false);
    setForm(emptyForm);
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { emailSent, emailReason } = await api.createUser({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || undefined,
        email: form.email.trim(),
        password: form.password,
        platformRole: form.platformRole,
      });
      closeCreate();
      setPage(1);
      await load({ page: 1, q: appliedQ });
      if (emailSent) {
        toast.success("User created and welcome email sent");
      } else {
        toast.success(
          emailReason
            ? `User created. Email not sent: ${emailReason}`
            : "User created. Welcome email was not sent.",
        );
      }
    } catch (err) {
      toast.error(errMessage(err, "Could not create user"));
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(u: ColleagueUser, platformRole: ColleagueUser["platformRole"]) {
    if (platformRole === u.platformRole) return;
    setBusyId(u.id);
    try {
      const { user } = await api.setUserPlatformRole(u.id, platformRole);
      setUsers((prev) =>
        prev.map((row) => (row.id === u.id ? { ...row, platformRole: user.platformRole } : row)),
      );
      toast.success("Role updated");
    } catch (err) {
      toast.error(errMessage(err, "Update failed"));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleDisabled(u: ColleagueUser) {
    setBusyId(u.id);
    try {
      if (u.disabledAt) {
        const { user } = await api.enableUser(u.id);
        setUsers((prev) =>
          prev.map((row) =>
            row.id === u.id ? { ...row, disabledAt: user.disabledAt } : row,
          ),
        );
        toast.success("User enabled");
      } else {
        const { user } = await api.disableUser(u.id);
        setUsers((prev) =>
          prev.map((row) =>
            row.id === u.id ? { ...row, disabledAt: user.disabledAt } : row,
          ),
        );
        toast.success("User disabled");
      }
    } catch (err) {
      toast.error(errMessage(err, "Update failed"));
    } finally {
      setBusyId(null);
    }
  }

  function archiveUser(u: ColleagueUser) {
    confirmDanger(
      `Archive ${u.name}? They will be signed out, removed from all workspaces, and cannot be re-enabled.`,
      () => {
        void (async () => {
          setBusyId(u.id);
          try {
            await api.deleteUser(u.id);
            toast.success("User archived");
            await load();
          } catch (err) {
            toast.error(errMessage(err, "Archive failed"));
          } finally {
            setBusyId(null);
          }
        })();
      },
    );
  }

  return (
    <div className="users-page">
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p className="muted">
            {canManage
              ? "Manage platform roles and account access."
              : "People on the platform (view only)."}
          </p>
        </div>
        {canManage && (
          <button type="button" className="workspace-primary-btn" onClick={openCreate}>
            <Plus size={18} />
            Add user
          </button>
        )}
      </header>

      {error && <p className="error">{error}</p>}

      <div className="trash-toolbar">
        <form
          className="trash-search"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setAppliedQ(filter.trim());
          }}
        >
          <Search size={16} aria-hidden />
          <input
            type="search"
            placeholder="Search by name, email, or role"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Search users"
          />
        </form>
        <button
          type="button"
          className="trash-refresh"
          aria-label="Refresh"
          title="Refresh"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw size={20} strokeWidth={2.75} className={refreshing ? "spin" : undefined} />
        </button>
      </div>

      {meta.total === 0 ? (
        <p className="muted">No users found.</p>
      ) : (
        <>
        <table className="file-table users-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              {canManage && <th className="col-trash-actions">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = me?.id === u.id;
              const disabled = !!u.disabledAt;
              return (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                    {isSelf && <span className="users-you muted"> (you)</span>}
                  </td>
                  <td className="muted">{u.email}</td>
                  <td>
                    {canManage && !isSelf ? (
                      <SearchableDropdown
                        className="users-role-select"
                        searchable={false}
                        value={u.platformRole}
                        options={PLATFORM_ROLE_OPTIONS}
                        disabled={busyId === u.id}
                        aria-label={`Role for ${u.name}`}
                        onChange={(role) => {
                          if (!role) return;
                          void changeRole(u, role);
                        }}
                      />
                    ) : (
                      <span className="users-role">{roleLabel(u.platformRole)}</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={
                        disabled ? "users-status users-status--disabled" : "users-status"
                      }
                    >
                      {disabled ? "Disabled" : "Active"}
                    </span>
                  </td>
                  <td className="muted">{formatDate(u.createdAt)}</td>
                  {canManage && (
                    <td className="col-trash-actions">
                      {isSelf ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="trash-action"
                            disabled={busyId === u.id}
                            onClick={() => void toggleDisabled(u)}
                          >
                            {disabled ? "Enable" : "Disable"}
                          </button>
                          <span className="trash-action-sep" aria-hidden>
                            |
                          </span>
                          <button
                            type="button"
                            className="trash-action trash-action-danger"
                            disabled={busyId === u.id}
                            onClick={() => archiveUser(u)}
                          >
                            Archive
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <PaginationBar meta={meta} onPageChange={setPage} />
        </>
      )}

      {creating && (
        <>
          <button
            type="button"
            className="folder-drawer-backdrop"
            aria-label="Close add user"
            onClick={closeCreate}
          />
          <aside className="folder-drawer" aria-label="Add user">
            <header className="folder-drawer-header">
              <h2>Add user</h2>
              <button
                type="button"
                className="folder-drawer-close"
                aria-label="Close"
                onClick={closeCreate}
              >
                <X size={20} />
              </button>
            </header>
            <form className="folder-drawer-body" onSubmit={(e) => void createUser(e)}>
              <label>
                <span>
                  First name <span className="req">*</span>
                </span>
                <input
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  required
                  autoFocus
                />
              </label>
              <label>
                <span>Last name</span>
                <input
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </label>
              <label>
                <span>
                  Email <span className="req">*</span>
                </span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </label>
              <label>
                <span>
                  Password <span className="req">*</span> (min 8)
                </span>
                <PasswordInput
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  minLength={8}
                  required
                />
              </label>
              <label>
                <span>
                  Role <span className="req">*</span>
                </span>
                <SearchableDropdown
                  className="users-role-select users-role-select--full"
                  searchable={false}
                  value={form.platformRole}
                  options={PLATFORM_ROLE_OPTIONS}
                  aria-label="Role"
                  onChange={(role) => {
                    if (!role) return;
                    setForm((f) => ({ ...f, platformRole: role }));
                  }}
                />
              </label>
              <div className="folder-drawer-footer">
                <button type="button" className="folder-drawer-cancel" onClick={closeCreate}>
                  Cancel
                </button>
                <button type="submit" className="folder-drawer-create" disabled={saving}>
                  {saving ? "Creating…" : "Create user"}
                </button>
              </div>
            </form>
          </aside>
        </>
      )}
    </div>
  );
}
