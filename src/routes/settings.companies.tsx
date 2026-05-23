/* ==========================================================
   settings.companies — Quản lý đa công ty:
   - Công ty đang làm việc + đổi tên (admin)
   - Danh sách công ty của bạn + chuyển công ty + tạo mới
   - Thành viên công ty: thêm / đổi vai trò / gỡ (admin)
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Card, Chip, Input, Select } from "@/components/ui";
import { I } from "@/components/Icons";
import { createCompaniesClient, type CompanyRole } from "@erp-framework/client";
import { dialog } from "@/lib/dialog";

const companies = createCompaniesClient("");

interface CompanyItem {
  id: string; name: string; slug: string; role: string; isActive: boolean;
}
interface Member {
  userId: string; email: string; name: string; role: string;
  joinedAt: string | Date;
  /** true = user được tạo nhưng chưa accept invite (password trống). */
  pending?: boolean;
}

const ROLES: CompanyRole[] = ["admin", "editor", "viewer"];
const ROLE_LABEL: Record<string, string> = {
  admin: "Quản trị", editor: "Biên tập", viewer: "Xem",
};

function CompaniesSettings() {
  const [list, setList] = useState<CompanyItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [myRole, setMyRole] = useState<string>("viewer");
  const [currentName, setCurrentName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // form tạo công ty
  const [newName, setNewName] = useState("");
  // form thêm thành viên
  const [mEmail, setMEmail] = useState("");
  const [mName, setMName] = useState("");
  const [mRole, setMRole] = useState<CompanyRole>("viewer");
  /** Link invite vừa sinh — hiện modal "Copy link" sau khi addMember. */
  const [inviteLink, setInviteLink] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState<string>("");

  const isAdmin = myRole === "admin";

  const reload = async () => {
    setErr("");
    try {
      const [cur, rows] = await Promise.all([
        companies.current(),
        companies.list(),
      ]);
      setList(rows as CompanyItem[]);
      setMyRole(cur?.role ?? "viewer");
      setCurrentName(cur?.name ?? "");
      try {
        setMembers((await companies.members()) as Member[]);
      } catch {
        setMembers([]);  // viewer có thể không xem được — bỏ qua
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => { void reload(); }, []);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setErr(""); setMsg("");
    try {
      await fn();
      setMsg(ok);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doSwitch = async (id: string) => {
    setBusy(true);
    try {
      await companies.switch(id);
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[820px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Quản lý công ty</h1>
        <div className="text-sm text-muted mb-6">
          Mỗi công ty có dữ liệu riêng (entity, trang, workflow, agent, nhật ký…).
          Người dùng có thể thuộc nhiều công ty và chuyển qua lại.
        </div>

        {/* === Công ty hiện tại === */}
        <Card className="mb-4 space-y-3">
          <div className="font-semibold">Công ty đang làm việc</div>
          <div className="flex items-center gap-2">
            <Input
              value={currentName}
              disabled={!isAdmin || busy}
              onChange={(e) => setCurrentName(e.target.value)}
              className="flex-1"
            />
            {isAdmin && (
              <Button
                variant="primary" icon={<I.Save size={14} />}
                disabled={busy || !currentName.trim()}
                onClick={() => void run(
                  () => companies.rename(currentName.trim()).then(() => {}),
                  "✓ Đã đổi tên công ty.",
                )}
              >
                Đổi tên
              </Button>
            )}
          </div>
          <div className="text-xs text-muted">
            Vai trò của bạn ở công ty này: <Chip>{ROLE_LABEL[myRole] ?? myRole}</Chip>
          </div>
        </Card>

        {/* === Danh sách công ty === */}
        <Card className="mb-4 space-y-3">
          <div className="font-semibold">Công ty của bạn</div>
          <div className="space-y-1.5">
            {list.map((c) => (
              <div key={c.id}
                className="flex items-center gap-2 p-2 rounded-md border border-border">
                <I.Briefcase size={15} className="text-muted shrink-0" />
                <span className="flex-1 truncate">{c.name}</span>
                <Chip>{ROLE_LABEL[c.role] ?? c.role}</Chip>
                {c.isActive ? (
                  <Chip variant="success">Đang dùng</Chip>
                ) : (
                  <Button size="sm" disabled={busy}
                    onClick={() => void doSwitch(c.id)}>
                    Chuyển đến
                  </Button>
                )}
              </div>
            ))}
            {list.length === 0 && (
              <div className="text-sm text-muted">Chưa thuộc công ty nào.</div>
            )}
          </div>
          <div className="border-t border-border pt-3 flex items-center gap-2">
            <Input
              placeholder="Tên công ty mới…"
              value={newName}
              disabled={busy}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1"
            />
            <Button
              variant="primary" icon={<I.Plus size={14} />}
              disabled={busy || !newName.trim()}
              onClick={() => void run(async () => {
                await companies.create(newName.trim());
                setNewName("");
              }, "✓ Đã tạo công ty mới.")}
            >
              Tạo công ty
            </Button>
          </div>
          <div className="text-xs text-muted">
            Bạn sẽ là quản trị viên của công ty vừa tạo.
          </div>
        </Card>

        {/* === Thành viên === */}
        <Card className="space-y-3">
          <div className="font-semibold">Thành viên công ty</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-muted text-xs uppercase tracking-wide">
                  <th className="text-left py-2 pr-3 font-semibold">Người dùng</th>
                  <th className="text-left py-2 px-2 font-semibold">Vai trò</th>
                  <th className="py-2 pl-2 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId} className="border-t border-border">
                    <td className="py-2 pr-3">
                      <div className="font-medium flex items-center gap-1.5">
                        {m.name}
                        {m.pending && (
                          <Chip variant="warning" className="!h-[16px] !text-[10px]">
                            chờ accept
                          </Chip>
                        )}
                      </div>
                      <div className="text-xs text-muted">{m.email}</div>
                    </td>
                    <td className="py-2 px-2">
                      {isAdmin ? (
                        <Select
                          value={m.role}
                          disabled={busy}
                          onChange={(e) => void run(
                            () => companies.setMemberRole(
                              m.userId, e.target.value as CompanyRole).then(() => {}),
                            "✓ Đã đổi vai trò.",
                          )}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </Select>
                      ) : (
                        <Chip>{ROLE_LABEL[m.role] ?? m.role}</Chip>
                      )}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      {isAdmin && m.pending && (
                        <Button
                          variant="default" size="sm" icon={<I.Send size={13} />}
                          disabled={busy}
                          title="Sinh lại link đăng ký + copy"
                          onClick={() => void run(async () => {
                            const r = await companies.resendInvite(m.userId);
                            const full = window.location.origin + r.inviteLink;
                            setInviteLink(full);
                            setInviteEmail(m.email);
                            await navigator.clipboard?.writeText(full).catch(() => {});
                          }, "✓ Đã sinh link mới — đã copy vào clipboard.")}
                        >
                          Gửi lại
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          variant="danger" size="sm" icon={<I.Trash size={13} />}
                          disabled={busy}
                          onClick={async () => {
                            const ok = await dialog.confirm(
                              `Gỡ ${m.email} khỏi công ty?`,
                              { title: "Gỡ thành viên", confirmText: "Gỡ" },
                            );
                            if (ok) void run(
                              () => companies.removeMember(m.userId).then(() => {}),
                              "✓ Đã gỡ thành viên.",
                            );
                          }}
                        />
                      )}
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr><td colSpan={3} className="py-3 text-muted text-sm">
                    Chưa có thành viên nào hiển thị.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {isAdmin && (
            <div className="border-t border-border pt-3 space-y-2">
              <div className="text-sm font-medium">Mời thành viên qua link đăng ký</div>
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="Email" value={mEmail} disabled={busy}
                  onChange={(e) => setMEmail(e.target.value)} />
                <Input placeholder="Tên hiển thị (tuỳ chọn)" value={mName}
                  disabled={busy} onChange={(e) => setMName(e.target.value)} />
                <Select value={mRole} disabled={busy}
                  onChange={(e) => setMRole(e.target.value as CompanyRole)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </Select>
              </div>
              <Button
                variant="primary" icon={<I.Send size={14} />}
                disabled={busy || !mEmail.trim()}
                onClick={() => void run(async () => {
                  const r = await companies.addMember({
                    email: mEmail.trim(),
                    name: mName.trim() || undefined,
                    role: mRole,
                  }) as { inviteLink?: string; pending?: boolean };
                  if (r.inviteLink) {
                    const full = window.location.origin + r.inviteLink;
                    setInviteLink(full);
                    setInviteEmail(mEmail.trim());
                    await navigator.clipboard?.writeText(full).catch(() => {});
                  }
                  setMEmail(""); setMName("");
                }, "✓ Đã tạo tài khoản. Link đăng ký đã copy vào clipboard.")}
              >
                Tạo tài khoản + sinh link đăng ký
              </Button>
              <div className="text-xs text-muted">
                Server tạo tài khoản với mật khẩu trống, sinh link đăng ký 1 lần
                có hiệu lực <strong>7 ngày</strong>. Bạn copy link gửi cho user — họ tự đặt
                mật khẩu khi vào link. Email đã có user → chỉ gán quyền, không sinh link.
              </div>
            </div>
          )}
        </Card>

        {/* === Modal hiển thị invite link vừa sinh === */}
        {inviteLink && (
          <Card className="mt-4 border-accent/40 bg-accent/5 space-y-2">
            <div className="flex items-center gap-2">
              <I.Send size={14} className="text-accent" />
              <div className="font-medium text-sm">
                Link đăng ký cho <span className="font-mono">{inviteEmail}</span>
              </div>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" icon={<I.X size={12} />}
                onClick={() => setInviteLink("")} title="Đóng" />
            </div>
            <div className="flex gap-2">
              <Input value={inviteLink} readOnly className="flex-1 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()} />
              <Button variant="default" size="sm" icon={<I.Copy size={13} />}
                onClick={() => void navigator.clipboard?.writeText(inviteLink)}>
                Copy
              </Button>
            </div>
            <div className="text-xs text-muted">
              Hết hạn sau 7 ngày. User mở link → đặt mật khẩu → vào app. Có thể
              sinh lại link bằng nút "Gửi lại" cạnh chip "chờ accept".
            </div>
          </Card>
        )}

        {msg && <div className="mt-4"><Chip variant="success">{msg}</Chip></div>}
        {err && <div className="mt-4"><Chip variant="danger">{err}</Chip></div>}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/companies")({
  component: CompaniesSettings,
});
