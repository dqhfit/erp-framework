import { I } from "@/components/Icons";
import { Button, Card, Chip, Modal, Select, Switch } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { useAuth } from "@/stores/auth";
import { createCompaniesClient, createObjectsClient } from "@erp-framework/client";
import type { AgentMemberRole, AgentMemberRow } from "@erp-framework/client";
/* ==========================================================
   AgentMembersPane — Tab "Thành viên" trong /agents/$id.
   ────────────────────────────────────────────────────────────
   Hiển thị danh sách user × agent (role owner/operator/observer)
   + toggle isPrivate (chỉ owner mới bật/tắt). Khi isPrivate=true,
   user ngoài agent_members sẽ bị 403; khi isPrivate=false (default),
   ai có quyền company-edit:agent đều edit được — agent_members chỉ
   là tag "my agents" cho Sidebar.
   ========================================================== */
import { useEffect, useMemo, useState } from "react";

interface Props {
  agentId: string;
  /** Owner đọc được cờ và set; non-owner chỉ thấy state hiện tại read-only. */
  isPrivate: boolean;
  /** Callback khi owner toggle private — parent cập nhật state + save. */
  onSetPrivate: (next: boolean) => void;
}

const ROLE_LABEL: Record<AgentMemberRole, string> = {
  owner: "Owner",
  operator: "Operator",
  observer: "Observer",
};
const ROLE_HINT: Record<AgentMemberRole, string> = {
  owner: "Toàn quyền + quản lý thành viên + xoá agent",
  operator: "View + Chat + Edit cấu hình",
  observer: "View + Chat (chỉ đọc)",
};

export function AgentMembersPane({ agentId, isPrivate, onSetPrivate }: Props) {
  const api = useMemo(() => createObjectsClient(""), []);
  const companies = useMemo(() => createCompaniesClient(""), []);
  const myAgentRoles = useAuth((s) => s.myAgentRoles);
  const refreshMyAgents = useAuth((s) => s.refreshMyAgents);
  const myRole = myAgentRoles[agentId] ?? null;
  const amOwner = myRole === "owner";

  const [members, setMembers] = useState<AgentMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const rows = await api.agents.listMembers(agentId);
      setMembers(rows as AgentMemberRow[]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(); /* eslint-disable-next-line */
  }, [agentId]);

  const changeRole = async (userId: string, role: AgentMemberRole) => {
    try {
      await api.agents.addMember({ agentId, userId, role });
      await load();
      void refreshMyAgents();
    } catch (e) {
      await dialog.alert((e as Error).message, { title: "Lỗi đổi role" });
    }
  };
  const remove = async (userId: string, userName: string | null) => {
    const ok = await dialog.confirm(`Gỡ ${userName ?? userId} khỏi agent này?`, {
      title: "Gỡ thành viên",
      confirmText: "Gỡ",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.agents.removeMember({ agentId, userId });
      await load();
      void refreshMyAgents();
    } catch (e) {
      await dialog.alert((e as Error).message, { title: "Lỗi" });
    }
  };

  return (
    <div className="space-y-4">
      {/* Privacy toggle (chỉ owner thấy nút; non-owner thấy trạng thái) */}
      <Card>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-sm font-medium flex items-center gap-2">
              {isPrivate ? (
                <I.Lock size={13} className="text-accent" />
              ) : (
                <I.Unlock size={13} className="text-muted" />
              )}
              {isPrivate ? "Agent riêng tư" : "Agent mở (open mode)"}
            </div>
            <div className="text-xs text-muted mt-0.5">
              {isPrivate
                ? "Chỉ thành viên trong danh sách dưới mới truy cập được. User khác trong công ty bị từ chối."
                : "Mọi editor của công ty đều dùng/sửa được. Danh sách thành viên chỉ dùng làm tag ★ trên Sidebar."}
            </div>
          </div>
          {amOwner ? (
            <Switch checked={isPrivate} onChange={(c) => onSetPrivate(c)} label="Riêng tư" />
          ) : (
            <Chip variant={isPrivate ? "accent" : "default"} className="!text-[10px]">
              {isPrivate ? "Riêng tư" : "Open"}
            </Chip>
          )}
        </div>
      </Card>

      {/* Danh sách thành viên */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">
            Thành viên ({members.length})
          </div>
          {amOwner && (
            <Button
              size="sm"
              variant="primary"
              icon={<I.Plus size={12} />}
              onClick={() => setAddOpen(true)}
            >
              Thêm thành viên
            </Button>
          )}
        </div>
        {err && <div className="text-xs text-danger mb-2">{err}</div>}
        {loading && <div className="text-xs text-muted">Đang tải…</div>}
        {!loading && members.length === 0 && (
          <div className="text-sm text-muted py-4 text-center">
            Chưa có thành viên nào. Agent đang ở mode "open" — ai có quyền edit:agent trong công ty
            đều thao tác được.
          </div>
        )}
        <div className="space-y-1">
          {members.map((m) => (
            <div
              key={m.userId}
              className="flex items-center gap-2 px-2 py-1.5 rounded border border-border"
            >
              <span className="w-7 h-7 rounded-full flex items-center justify-center bg-bg-soft text-accent shrink-0">
                <I.User size={12} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {m.userName ?? m.userEmail ?? m.userId}
                </div>
                <div className="text-xs text-muted truncate">{m.userEmail ?? ""}</div>
              </div>
              {amOwner ? (
                <Select
                  className="!h-7 !text-xs w-[120px]"
                  value={m.role}
                  onChange={(e) => changeRole(m.userId, e.target.value as AgentMemberRole)}
                  title={ROLE_HINT[m.role]}
                >
                  {(["owner", "operator", "observer"] as AgentMemberRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              ) : (
                <Chip className="!text-[10px]" title={ROLE_HINT[m.role]}>
                  {ROLE_LABEL[m.role]}
                </Chip>
              )}
              {amOwner && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<I.Trash size={12} />}
                  onClick={() => remove(m.userId, m.userName)}
                  title="Gỡ thành viên"
                />
              )}
            </div>
          ))}
        </div>
        {!amOwner && (
          <div className="text-[11px] text-muted mt-2 pt-2 border-t border-border">
            Chỉ <strong>owner</strong> mới sửa được danh sách thành viên. Vai trò của bạn:{" "}
            <Chip className="!text-[10px]">{myRole ?? "không phải member"}</Chip>
          </div>
        )}
      </Card>

      <AddMemberModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        existingMemberIds={new Set(members.map((m) => m.userId))}
        onAdd={async (userId, role) => {
          try {
            await api.agents.addMember({ agentId, userId, role });
            await load();
            void refreshMyAgents();
            setAddOpen(false);
          } catch (e) {
            await dialog.alert((e as Error).message, { title: "Lỗi thêm thành viên" });
          }
        }}
        loadUsers={() => companies.members()}
      />
    </div>
  );
}

/* ── Modal thêm thành viên: chọn user trong company + role ── */
interface AddProps {
  open: boolean;
  onClose: () => void;
  existingMemberIds: Set<string>;
  onAdd: (userId: string, role: AgentMemberRole) => Promise<void>;
  loadUsers: () => Promise<
    Array<{
      userId: string;
      email: string;
      name: string;
      role: string;
    }>
  >;
}
function AddMemberModal({ open, onClose, existingMemberIds, onAdd, loadUsers }: AddProps) {
  const [users, setUsers] = useState<Array<{ userId: string; email: string; name: string }>>([]);
  const [picked, setPicked] = useState<string>("");
  const [role, setRole] = useState<AgentMemberRole>("operator");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    loadUsers()
      .then((rows) => {
        const available = rows.filter((u) => !existingMemberIds.has(u.userId));
        setUsers(available);
        setPicked(available[0]?.userId ?? "");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Thêm thành viên cho agent" width={460}>
      {loading ? (
        <div className="text-sm text-muted">Đang tải danh sách user…</div>
      ) : users.length === 0 ? (
        <div className="text-sm text-muted">Mọi user trong công ty đều đã là thành viên.</div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-xs text-muted mb-1">User</div>
            <Select value={picked} onChange={(e) => setPicked(e.target.value)}>
              {users.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.name} ({u.email})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <div className="text-xs text-muted mb-1">Vai trò</div>
            <Select value={role} onChange={(e) => setRole(e.target.value as AgentMemberRole)}>
              <option value="observer">Observer — view + chat read-only</option>
              <option value="operator">Operator — view + chat + edit cấu hình</option>
              <option value="owner">Owner — toàn quyền + quản lý thành viên</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="default" size="sm" onClick={onClose}>
              Huỷ
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!picked}
              onClick={() => onAdd(picked, role)}
            >
              Thêm
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
