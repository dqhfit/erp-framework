import { type CompanyRole, createCompaniesClient } from "@erp-framework/client";
/* ==========================================================
   settings.companies — Quản lý đa công ty:
   - Công ty đang làm việc + đổi tên (admin)
   - Danh sách công ty của bạn + chuyển công ty + tạo mới
   - Thành viên công ty: thêm / đổi vai trò / gỡ (admin)
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, Input, Select } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";

const companies = createCompaniesClient("");

interface CompanyItem {
  id: string;
  name: string;
  slug: string;
  role: string;
  isActive: boolean;
}
interface Member {
  userId: string;
  email: string;
  name: string;
  role: string;
  joinedAt: string | Date;
  /** true = user được tạo nhưng chưa accept invite (password trống). */
  pending?: boolean;
  /** false = đăng ký qua invite link, chờ admin phê duyệt. */
  approved?: boolean;
  /** true = admin đã vô hiệu hoá tài khoản này. */
  disabled?: boolean;
}
interface GenericLink {
  id: string;
  role: string;
  token: string;
  expiresAt: string | Date;
  usedAt?: string | Date | null;
  createdAt: string | Date;
}

const ROLES: CompanyRole[] = ["admin", "editor", "viewer"];

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
  /** Generic invite links */
  const [genericLinks, setGenericLinks] = useState<GenericLink[]>([]);
  const [genericRole, setGenericRole] = useState<CompanyRole>("viewer");
  const [newGenericLink, setNewGenericLink] = useState<string>("");
  /** Reset password: user đang được đặt lại mật khẩu. */
  const [resetTarget, setResetTarget] = useState<{ userId: string; email: string } | null>(null);
  const [resetPwd, setResetPwd] = useState("");

  const t = useT();

  const ROLE_LABEL: Record<string, string> = {
    admin: t("settings.companies.role_admin"),
    editor: t("settings.companies.role_editor"),
    viewer: t("settings.companies.role_viewer"),
  };

  const isAdmin = myRole === "admin";

  const reload = async () => {
    setErr("");
    try {
      const [cur, rows] = await Promise.all([companies.current(), companies.list()]);
      setList(rows as CompanyItem[]);
      setMyRole(cur?.role ?? "viewer");
      setCurrentName(cur?.name ?? "");
      try {
        setMembers((await companies.members()) as Member[]);
      } catch {
        setMembers([]); // viewer có thể không xem được — bỏ qua
      }
      try {
        setGenericLinks((await companies.listInviteLinks()) as GenericLink[]);
      } catch {
        setGenericLinks([]);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: closure ổn định mount-only
  useEffect(() => {
    void reload();
  }, []);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setErr("");
    setMsg("");
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
        <h1 className="text-xl font-semibold mb-1">{t("settings.companies.title")}</h1>
        <div className="text-sm text-muted mb-6">{t("settings.companies.subtitle")}</div>

        {/* === Công ty hiện tại === */}
        <Card className="mb-4 space-y-3">
          <div className="font-semibold">{t("settings.companies.current_company")}</div>
          <div className="flex items-center gap-2">
            <Input
              value={currentName}
              disabled={!isAdmin || busy}
              onChange={(e) => setCurrentName(e.target.value)}
              className="flex-1"
            />
            {isAdmin && (
              <Button
                variant="primary"
                icon={<I.Save size={14} />}
                disabled={busy || !currentName.trim()}
                onClick={() =>
                  void run(
                    () => companies.rename(currentName.trim()).then(() => {}),
                    t("settings.companies.renamed_ok"),
                  )
                }
              >
                {t("settings.companies.rename_btn")}
              </Button>
            )}
          </div>
          <div className="text-xs text-muted">
            {t("settings.companies.your_role")} <Chip>{ROLE_LABEL[myRole] ?? myRole}</Chip>
          </div>
        </Card>

        {/* === Danh sách công ty === */}
        <Card className="mb-4 space-y-3">
          <div className="font-semibold">{t("settings.companies.my_companies")}</div>
          <div className="space-y-1.5">
            {list.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 p-2 rounded-md border border-border"
              >
                <I.Briefcase size={15} className="text-muted shrink-0" />
                <span className="flex-1 truncate">{c.name}</span>
                <Chip>{ROLE_LABEL[c.role] ?? c.role}</Chip>
                {c.isActive ? (
                  <Chip variant="success">{t("settings.companies.active_chip")}</Chip>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => void doSwitch(c.id)}>
                    {t("settings.companies.switch_btn")}
                  </Button>
                )}
              </div>
            ))}
            {list.length === 0 && (
              <div className="text-sm text-muted">{t("settings.companies.no_company")}</div>
            )}
          </div>
          <div className="border-t border-border pt-3 flex items-center gap-2">
            <Input
              placeholder={t("settings.companies.new_company_placeholder")}
              value={newName}
              disabled={busy}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1"
            />
            <Button
              variant="primary"
              icon={<I.Plus size={14} />}
              disabled={busy || !newName.trim()}
              onClick={() =>
                void run(async () => {
                  await companies.create(newName.trim());
                  setNewName("");
                }, t("settings.companies.create_ok"))
              }
            >
              {t("settings.companies.create_btn")}
            </Button>
          </div>
          <div className="text-xs text-muted">{t("settings.companies.admin_hint")}</div>
        </Card>

        {/* === Thành viên === */}
        <Card className="space-y-3">
          <div className="font-semibold">{t("settings.companies.members_title")}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-muted text-xs uppercase tracking-wide">
                  <th className="text-left py-2 pr-3 font-semibold">
                    {t("settings.companies.col_user")}
                  </th>
                  <th className="text-left py-2 px-2 font-semibold">
                    {t("settings.companies.col_role")}
                  </th>
                  <th className="py-2 pl-2 font-semibold text-right">
                    {t("settings.companies.col_actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId} className="border-t border-border">
                    <td className="py-2 pr-3">
                      <div className="font-medium flex items-center gap-1.5">
                        {m.name}
                        {m.pending && (
                          <Chip variant="warning" className="h-[16px]! text-[10px]!">
                            {t("settings.companies.pending_chip")}
                          </Chip>
                        )}
                        {!m.pending && m.approved === false && (
                          <Chip variant="danger" className="h-[16px]! text-[10px]!">
                            {t("settings.companies.pending_approval_chip")}
                          </Chip>
                        )}
                        {m.disabled && (
                          <Chip variant="danger" className="h-[16px]! text-[10px]!">
                            {t("settings.companies.disabled_chip")}
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
                          onChange={(e) =>
                            void run(
                              () =>
                                companies
                                  .setMemberRole(m.userId, e.target.value as CompanyRole)
                                  .then(() => {}),
                              t("settings.companies.role_changed_ok"),
                            )
                          }
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Chip>{ROLE_LABEL[m.role] ?? m.role}</Chip>
                      )}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isAdmin && m.pending && (
                          <Button
                            variant="default"
                            size="sm"
                            icon={<I.Send size={13} />}
                            disabled={busy}
                            title="Sinh lại link đăng ký + copy"
                            onClick={() =>
                              void run(async () => {
                                const r = await companies.resendInvite(m.userId);
                                const full = window.location.origin + r.inviteLink;
                                setInviteLink(full);
                                setInviteEmail(m.email);
                                await navigator.clipboard?.writeText(full).catch(() => {});
                              }, t("settings.companies.resend_ok"))
                            }
                          >
                            {t("settings.companies.resend_btn")}
                          </Button>
                        )}
                        {isAdmin && !m.pending && m.approved === false && (
                          <>
                            <Button
                              variant="primary"
                              size="sm"
                              icon={<I.Check size={13} />}
                              disabled={busy}
                              title={t("settings.companies.approve_btn")}
                              onClick={() =>
                                void run(
                                  () => companies.approveMember(m.userId).then(() => {}),
                                  t("settings.companies.approve_ok"),
                                )
                              }
                            >
                              {t("settings.companies.approve_btn")}
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              icon={<I.X size={13} />}
                              disabled={busy}
                              title={t("settings.companies.reject_btn")}
                              onClick={() =>
                                void run(
                                  () => companies.rejectMember(m.userId).then(() => {}),
                                  t("settings.companies.reject_ok"),
                                )
                              }
                            />
                          </>
                        )}
                        {isAdmin && !m.pending && (
                          <Button
                            variant="default"
                            size="sm"
                            icon={<I.Lock size={13} />}
                            disabled={busy}
                            title="Đặt lại mật khẩu cho user này"
                            onClick={() => {
                              setResetTarget({ userId: m.userId, email: m.email });
                              setResetPwd("");
                            }}
                          >
                            {t("settings.companies.reset_pass_btn")}
                          </Button>
                        )}
                        {isAdmin &&
                          !m.pending &&
                          (m.disabled ? (
                            <Button
                              variant="default"
                              size="sm"
                              icon={<I.Check size={13} />}
                              disabled={busy}
                              title={t("settings.companies.enable_btn")}
                              onClick={() =>
                                void run(
                                  () => companies.enableMember(m.userId).then(() => {}),
                                  t("settings.companies.enable_ok"),
                                )
                              }
                            >
                              {t("settings.companies.enable_btn")}
                            </Button>
                          ) : (
                            <Button
                              variant="danger"
                              size="sm"
                              icon={<I.Ban size={13} />}
                              disabled={busy}
                              title={t("settings.companies.disable_btn")}
                              onClick={() =>
                                void run(
                                  () => companies.disableMember(m.userId).then(() => {}),
                                  t("settings.companies.disable_ok"),
                                )
                              }
                            >
                              {t("settings.companies.disable_btn")}
                            </Button>
                          ))}
                        {isAdmin && (
                          <Button
                            variant="danger"
                            size="sm"
                            icon={<I.Trash size={13} />}
                            disabled={busy}
                            onClick={async () => {
                              const ok = await dialog.confirm(
                                t("settings.companies.remove_confirm", { email: m.email }),
                                {
                                  title: t("settings.companies.remove_title"),
                                  confirmText: t("settings.companies.remove_confirm_btn"),
                                },
                              );
                              if (ok)
                                void run(
                                  () => companies.removeMember(m.userId).then(() => {}),
                                  t("settings.companies.removed_ok"),
                                );
                            }}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-3 text-muted text-sm">
                      {t("settings.companies.no_members")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {isAdmin && (
            <div className="border-t border-border pt-3 space-y-2">
              <div className="text-sm font-medium">{t("settings.companies.invite_title")}</div>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  placeholder={t("settings.companies.invite_email_ph")}
                  value={mEmail}
                  disabled={busy}
                  onChange={(e) => setMEmail(e.target.value)}
                />
                <Input
                  placeholder={t("settings.companies.invite_name_ph")}
                  value={mName}
                  disabled={busy}
                  onChange={(e) => setMName(e.target.value)}
                />
                <Select
                  value={mRole}
                  disabled={busy}
                  onChange={(e) => setMRole(e.target.value as CompanyRole)}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                variant="primary"
                icon={<I.Send size={14} />}
                disabled={busy || !mEmail.trim()}
                onClick={() =>
                  void run(async () => {
                    const r = (await companies.addMember({
                      email: mEmail.trim(),
                      name: mName.trim() || undefined,
                      role: mRole,
                    })) as { inviteLink?: string; pending?: boolean };
                    if (r.inviteLink) {
                      const full = window.location.origin + r.inviteLink;
                      setInviteLink(full);
                      setInviteEmail(mEmail.trim());
                      await navigator.clipboard?.writeText(full).catch(() => {});
                    }
                    setMEmail("");
                    setMName("");
                  }, t("settings.companies.invite_ok"))
                }
              >
                {t("settings.companies.invite_btn")}
              </Button>
              <div className="text-xs text-muted">{t("settings.companies.invite_hint")}</div>
            </div>
          )}
        </Card>

        {/* === Link mời chung (không cần biết email trước) === */}
        {isAdmin && (
          <Card className="mt-4 space-y-3">
            <div className="font-semibold flex items-center gap-2">
              <I.Link size={15} className="text-accent" />
              {t("settings.companies.generic_link_title")}
            </div>
            <div className="text-xs text-muted">{t("settings.companies.generic_link_hint")}</div>

            {/* Tạo link mới */}
            <div className="flex items-center gap-2">
              <Select
                value={genericRole}
                disabled={busy}
                onChange={(e) => setGenericRole(e.target.value as CompanyRole)}
                className="w-36"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
              <Button
                variant="primary"
                icon={<I.Plus size={14} />}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = (await companies.createInviteLink(genericRole)) as {
                      inviteLink?: string;
                    };
                    if (r.inviteLink) {
                      const full = window.location.origin + r.inviteLink;
                      setNewGenericLink(full);
                      await navigator.clipboard?.writeText(full).catch(() => {});
                    }
                  }, t("settings.companies.generic_link_created"))
                }
              >
                {t("settings.companies.generic_link_create_btn")}
              </Button>
            </div>

            {/* Link mới vừa tạo — banner copy */}
            {newGenericLink && (
              <div className="flex gap-2 p-2 rounded-md border border-accent/30 bg-accent/5">
                <Input
                  value={newGenericLink}
                  readOnly
                  className="flex-1 font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  variant="default"
                  size="sm"
                  icon={<I.Copy size={13} />}
                  onClick={() => void navigator.clipboard?.writeText(newGenericLink)}
                >
                  Copy
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<I.X size={12} />}
                  onClick={() => setNewGenericLink("")}
                />
              </div>
            )}

            {/* Danh sách links */}
            {genericLinks.length > 0 && (
              <div className="space-y-1 border-t border-border pt-2">
                {genericLinks.map((lk) => {
                  const used = !!lk.usedAt;
                  const expired = !used && new Date(lk.expiresAt) < new Date();
                  const active = !used && !expired;
                  return (
                    <div
                      key={lk.id}
                      className="flex items-center gap-2 text-sm py-1.5 border-b border-border/40 last:border-0"
                    >
                      <span className="font-mono text-xs text-muted truncate flex-1">
                        {window.location.origin}/join?token={lk.token.slice(0, 8)}…
                      </span>
                      <Chip>{ROLE_LABEL[lk.role] ?? lk.role}</Chip>
                      {used && <Chip variant="success">{t("settings.companies.link_used")}</Chip>}
                      {expired && (
                        <Chip variant="warning">{t("settings.companies.link_expired")}</Chip>
                      )}
                      {active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<I.Copy size={12} />}
                          title="Copy link"
                          onClick={() =>
                            void navigator.clipboard?.writeText(
                              `${window.location.origin}/join?token=${lk.token}`,
                            )
                          }
                        />
                      )}
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<I.Trash size={12} />}
                        title={t("settings.companies.generic_link_revoke")}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => companies.deleteInviteLink(lk.id).then(() => {}),
                            t("settings.companies.generic_link_revoked"),
                          )
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {/* === Modal hiển thị invite link vừa sinh === */}
        {inviteLink && (
          <Card className="mt-4 border-accent/40 bg-accent/5 space-y-2">
            <div className="flex items-center gap-2">
              <I.Send size={14} className="text-accent" />
              <div className="font-medium text-sm">
                {t("settings.companies.link_label")}{" "}
                <span className="font-mono">{inviteEmail}</span>
              </div>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                icon={<I.X size={12} />}
                onClick={() => setInviteLink("")}
                title="Đóng"
              />
            </div>
            <div className="flex gap-2">
              <Input
                value={inviteLink}
                readOnly
                className="flex-1 font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                variant="default"
                size="sm"
                icon={<I.Copy size={13} />}
                onClick={() => void navigator.clipboard?.writeText(inviteLink)}
              >
                Copy
              </Button>
            </div>
            <div className="text-xs text-muted">{t("settings.companies.link_expires")}</div>
          </Card>
        )}

        {/* === Panel đặt lại mật khẩu === */}
        {resetTarget && (
          <Card className="mt-4 border-warning/40 bg-warning/5 space-y-3">
            <div className="flex items-center gap-2">
              <I.Lock size={14} className="text-warning" />
              <div className="font-medium text-sm">
                {t("settings.companies.reset_panel_title")}{" "}
                <span className="font-mono">{resetTarget.email}</span>
              </div>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                icon={<I.X size={12} />}
                onClick={() => setResetTarget(null)}
                title="Đóng"
              />
            </div>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={t("settings.companies.reset_pwd_ph")}
                value={resetPwd}
                disabled={busy}
                onChange={(e) => setResetPwd(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="danger"
                disabled={busy || resetPwd.length < 8}
                onClick={() =>
                  void run(
                    async () => {
                      await companies.resetMemberPassword(resetTarget.userId, resetPwd);
                      setResetTarget(null);
                      setResetPwd("");
                    },
                    t("settings.companies.reset_ok", { email: resetTarget.email }),
                  )
                }
              >
                {t("settings.companies.reset_confirm_btn")}
              </Button>
            </div>
            <div className="text-xs text-muted">{t("settings.companies.reset_hint")}</div>
          </Card>
        )}

        {msg && (
          <div className="mt-4">
            <Chip variant="success">{msg}</Chip>
          </div>
        )}
        {err && (
          <div className="mt-4">
            <Chip variant="danger">{err}</Chip>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/companies")({
  component: CompaniesSettings,
});
