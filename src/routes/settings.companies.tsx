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
  const [mPassword, setMPassword] = useState("");
  const [mRole, setMRole] = useState<CompanyRole>("viewer");

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
                      <div className="font-medium">{m.name}</div>
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
              <div className="text-sm font-medium">Thêm thành viên</div>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Email" value={mEmail} disabled={busy}
                  onChange={(e) => setMEmail(e.target.value)} />
                <Input placeholder="Tên (cho tài khoản mới)" value={mName}
                  disabled={busy} onChange={(e) => setMName(e.target.value)} />
                <Input placeholder="Mật khẩu (≥8 ký tự — chỉ khi tạo mới)"
                  type="password" value={mPassword} disabled={busy}
                  onChange={(e) => setMPassword(e.target.value)} />
                <Select value={mRole} disabled={busy}
                  onChange={(e) => setMRole(e.target.value as CompanyRole)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </Select>
              </div>
              <Button
                variant="primary" icon={<I.Plus size={14} />}
                disabled={busy || !mEmail.trim()}
                onClick={() => void run(async () => {
                  await companies.addMember({
                    email: mEmail.trim(),
                    name: mName.trim() || undefined,
                    password: mPassword || undefined,
                    role: mRole,
                  });
                  setMEmail(""); setMName(""); setMPassword("");
                }, "✓ Đã thêm thành viên.")}
              >
                Thêm thành viên
              </Button>
              <div className="text-xs text-muted">
                Email chưa có tài khoản → nhập mật khẩu để tạo tài khoản mới.
                Email đã có → chỉ cần email và vai trò.
              </div>
            </div>
          )}
        </Card>

        {msg && <div className="mt-4"><Chip variant="success">{msg}</Chip></div>}
        {err && <div className="mt-4"><Chip variant="danger">{err}</Chip></div>}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/companies")({
  component: CompaniesSettings,
});
