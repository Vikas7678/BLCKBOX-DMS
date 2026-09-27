import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { api } from "../api";
import type { MemberItem, WorkspaceItem } from "../api";
import { useAuth } from "../AuthContext";
import { AddUsersModal } from "../components/AddUsersModal";
import { confirmDanger } from "../alertify";
import { toast } from "../toast";

type Tab = "edit" | "permissions";

type PendingMember = {
  tempId: string;
  user: { id: string; email: string; name: string };
  role: "owner" | "admin" | "member";
};

export function WorkspaceSettingsPage({ tab }: { tab: Tab }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceItem | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingMember[]>([]);
  const [showAddUsers, setShowAddUsers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canManage = workspace?.role === "owner" || workspace?.role === "admin";
  const isOwner = workspace?.role === "owner";

  const excludeUserIds = useMemo(
    () => [...members.map((m) => m.user.id), ...pending.map((p) => p.user.id)],
    [members, pending],
  );

  const hasUnsaved =
    pending.length > 0 ||
    members.some((m) => (roleDrafts[m.id] ?? m.role) !== m.role);

  async function load() {
    if (!id) return;
    const [w, m] = await Promise.all([api.getWorkspace(id), api.listMembers(id)]);
    setWorkspace(w.workspace);
    setName(w.workspace.name);
    setDescription(w.workspace.description ?? "");
    setMembers(m.members);
    const drafts: Record<string, string> = {};
    for (const member of m.members) drafts[member.id] = member.role;
    setRoleDrafts(drafts);
    setPending([]);
  }

  useEffect(() => {
    void load().catch((err) =>
      toast.error(err instanceof Error ? err.message : "Failed to load"),
    );
  }, [id]);

  async function saveWorkspace(e: FormEvent) {
    e.preventDefault();
    if (!id || !canManage) return;
    setSaving(true);
    try {
      await api.updateWorkspace(id, { name: name.trim(), description: description.trim() });
      toast.success("Changes saved");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function deleteWorkspace() {
    if (!id || !isOwner) return;
    confirmDanger(
      "Delete this workspace? This action is irreversible. Documents will no longer be available to members.",
      () => {
        void (async () => {
          try {
            await api.deleteWorkspace(id);
            toast.success("Workspace deleted");
            navigate("/");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Delete failed");
          }
        })();
      },
    );
  }

  function onUsersPicked(users: { id: string; email: string; name: string }[]) {
    setPending((prev) => {
      const existingIds = new Set([
        ...members.map((m) => m.user.id),
        ...prev.map((p) => p.user.id),
      ]);
      const additions = users
        .filter((u) => !existingIds.has(u.id))
        .map((u) => ({
          tempId: `new:${u.id}`,
          user: u,
          role: "member" as const,
        }));
      return [...prev, ...additions];
    });
    setShowAddUsers(false);
  }

  async function savePermissions() {
    if (!id || !canManage) return;
    if (pending.some((p) => !p.role)) {
      toast.error("Select a role for each new member");
      return;
    }
    setSaving(true);
    try {
      for (const member of members) {
        const next = roleDrafts[member.id];
        if (next && next !== member.role) {
          await api.updateMemberRole(id, member.id, next as "owner" | "admin" | "member");
        }
      }
      if (pending.length) {
        await api.addMembers(
          id,
          pending.map((p) => ({ userId: p.user.id, role: p.role })),
        );
      }
      toast.success("Permissions saved");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save permissions");
    } finally {
      setSaving(false);
    }
  }

  function removePending(tempId: string) {
    setPending((prev) => prev.filter((p) => p.tempId !== tempId));
  }

  function removeMember(member: MemberItem) {
    if (!id || !canManage) return;
    confirmDanger(`Remove ${member.user.name} from this workspace?`, () => {
      void (async () => {
        setBusyId(member.id);
        try {
          await api.removeMember(id, member.id);
          toast.success("Member removed");
          await load();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not remove member");
        } finally {
          setBusyId(null);
        }
      })();
    });
  }

  if (!workspace || !user) {
    return <p className="muted">Loading…</p>;
  }

  return (
    <div className="settings-page">
      <nav className="settings-tabs">
        <NavLink to={`/workspaces/${id}/settings`} end>
          Edit Workspace
        </NavLink>
        <NavLink to={`/workspaces/${id}/settings/permissions`}>
          Manage Permissions: {workspace.name}
        </NavLink>
      </nav>

      {tab === "edit" && (
        <div className="settings-card">
          <form className="settings-form" onSubmit={saveWorkspace}>
            <label>
              <span>
                Workspace Name <span className="req">*</span>
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={!canManage}
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                disabled={!canManage}
              />
            </label>
            <div className="settings-card-actions">
              {isOwner && (
                <button type="button" className="btn-danger" onClick={deleteWorkspace}>
                  Delete Workspace
                </button>
              )}
              {canManage && (
                <button type="submit" className="btn-teal" disabled={saving}>
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {tab === "permissions" && (
        <div className="settings-card">
          <div className="permissions-toolbar">
            {canManage && (
              <button
                type="button"
                className="btn-teal btn-teal-outline"
                disabled={!canManage}
                onClick={() => setShowAddUsers(true)}
              >
                <UserPlus size={16} />
                Add user(s)
              </button>
            )}
            <button
              type="button"
              className="btn-teal"
              disabled={saving || !canManage || !hasUnsaved}
              onClick={() => void savePermissions()}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
          <table className="permissions-table">
            <thead>
              <tr>
                <th>Users</th>
                <th>Type</th>
                <th>Role</th>
                {canManage && <th className="col-perm-actions">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.tempId} className="is-pending-member">
                  <td>
                    <strong>{p.user.name}</strong>
                    <div className="muted">{p.user.email}</div>
                  </td>
                  <td className="muted">User</td>
                  <td>
                    <select
                      value={p.role}
                      onChange={(e) =>
                        setPending((prev) =>
                          prev.map((row) =>
                            row.tempId === p.tempId
                              ? {
                                  ...row,
                                  role: e.target.value as PendingMember["role"],
                                }
                              : row,
                          ),
                        )
                      }
                    >
                      <option value="owner">owner</option>
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                    </select>
                  </td>
                  {canManage && (
                    <td className="col-perm-actions">
                      <button
                        type="button"
                        className="trash-action trash-action-danger"
                        onClick={() => removePending(p.tempId)}
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {members.map((m) => (
                <tr
                  key={m.id}
                  className={
                    (roleDrafts[m.id] ?? m.role) !== m.role ? "is-pending-member" : undefined
                  }
                >
                  <td>
                    <strong>{m.user.name}</strong>
                    <div className="muted">{m.user.email}</div>
                  </td>
                  <td className="muted">User</td>
                  <td>
                    <select
                      value={roleDrafts[m.id] ?? m.role}
                      disabled={!canManage}
                      onChange={(e) =>
                        setRoleDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))
                      }
                    >
                      <option value="owner">owner</option>
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                    </select>
                  </td>
                  {canManage && (
                    <td className="col-perm-actions">
                      {m.user.id === user.id ? (
                        <span className="muted">—</span>
                      ) : (
                        <button
                          type="button"
                          className="trash-action trash-action-danger"
                          disabled={busyId === m.id}
                          onClick={() => removeMember(m)}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Total Count: {members.length + pending.length}</p>
        </div>
      )}

      {showAddUsers && id && (
        <AddUsersModal
          workspaceId={id}
          excludeUserIds={excludeUserIds}
          onClose={() => setShowAddUsers(false)}
          onAdd={onUsersPicked}
        />
      )}
    </div>
  );
}
