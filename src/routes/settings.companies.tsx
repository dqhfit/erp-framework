import { type CompanyRole, createCompaniesClient } from "@erp-framework/client";
/* ==========================================================
   settings.companies — Quản lý đa công ty.
   Layout: compact header + 3 tabs (Tổng quan / Thành viên / Link mời).
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, Input, Select } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { cn } from "@/lib/utils";

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
  pending?: boolean;
  approved?: boolean;
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

/* ── Helpers ─────────────────────────────────────────────── */
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function RoleBadge({ role }: { role: string }) {
  const cls =
    role === "admin"
      ? "bg-accent/15 text-accent"
      : role === "editor"
        ? "bg-warning/15 text-warning"
        : "bg-bg-soft text-muted";
  return (
    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0", cls)}>
      {role}
    </span>
  );
}

/* ── Main component ───────────────────────────────────────── */
function CompaniesSettings() {
  const [list, setList] = useState<CompanyItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [myRole, setMyRole] = useState<string>("viewer");
  const [currentName, setCurrentName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [tab, setTab] = useState<"overview" | "members" | "links">("overview");

  // form tạo công ty
  const [newName, setNewName] = useState("");
  // form thêm thành viên
  const [mEmail, setMEmail] = useState("");
  const [mName, setMName] = useState("");
  const [mRole, setMRole] = useState<CompanyRole>("viewer");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  // generic links
  const [genericLinks, setGenericLinks] = useState<GenericLink[]>([]);
  const [genericRole, setGenericRole] = useState<CompanyRole>("viewer");
  const [newGenericLink, setNewGenericLink] = useState("");
  // reset password
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
        setMembers([]);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only
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

  const active = list.find((c) => c.isActive);

  /* ── Render ── */
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Compact header + tabs ── */}
      <div className="border-b border-border shrink-0">
        <div className="px-4 py-2 flex items-center gap-2">
          <span className="text-xs font-semibold">{t("settings.companies.title")}</span>
          {active && (
            <>
              <span className="text-muted/40">·</span>
              <span className="text-xs text-muted truncate">{active.name}</span>
            </>
          )}
          <RoleBadge role={myRole} />
        </div>
        <div className="flex px-2">
          {(
            [
              { key: "overview", label: "Tổng quan" },
              { key: "members", label: `Thành viên (${members.length})` },
              { key: "links", label: "Link mời" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "px-3 py-1.5 text-[11px] border-b-2 -mb-px transition-colors",
                tab === key
                  ? "border-accent text-accent font-medium"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto">
        {/* ════ Tab: Tổng quan ════ */}
        {tab === "overview" && (
          <div className="max-w-lg px-5 py-4 space-y-5">
            {/* Công ty hiện tại */}
            <section>
              <div className="text-[10px] font-semibold text-muted/60 uppercase tracking-wider mb-2">
                Công ty đang làm việc
              </div>
              <div className="flex gap-2">
                <Input
                  value={currentName}
                  disabled={!isAdmin || busy}
                  onChange={(e) => setCurrentName(e.target.value)}
                  className="flex-1 text-sm"
                />
                {isAdmin && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<I.Save size={13} />}
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
            </section>

            {/* Danh sách công ty */}
            <section>
              <div className="text-[10px] font-semibold text-muted/60 uppercase tracking-wider mb-2">
                Công ty của bạn
              </div>
              <div className="rounded-md border border-border divide-y divide-border overflow-hidden">
                {list.map((c) => (
                  <div key={c.id} className="flex items-center gap-2.5 px-3 py-2">
                    <div className="w-6 h-6 rounded bg-accent/10 text-accent flex items-center justify-center text-[10px] font-bold shrink-0">
                      {c.name[0]?.toUpperCase()}
                    </div>
                    <span className="flex-1 text-sm truncate">{c.name}</span>
                    <RoleBadge role={c.role} />
                    {c.isActive ? (
                      <span className="text-[10px] text-success font-medium shrink-0">
                        ● Đang dùng
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void doSwitch(c.id)}
                        className="text-[11px] text-accent hover:underline shrink-0 disabled:opacity-50"
                      >
                        Chuyển
                      </button>
                    )}
                  </div>
                ))}
                {list.length === 0 && (
                  <div className="px-3 py-3 text-xs text-muted/60">
                    {t("settings.companies.no_company")}
                  </div>
                )}
              </div>

              {/* Tạo công ty mới */}
              <div className="mt-2 flex gap-2">
                <Input
                  placeholder={t("settings.companies.new_company_placeholder")}
                  value={newName}
                  disabled={busy}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newName.trim())
                      void run(async () => {
                        await companies.create(newName.trim());
                        setNewName("");
                      }, t("settings.companies.create_ok"));
                  }}
                />
                <Button
                  variant="primary"
                  size="sm"
                  icon={<I.Plus size={13} />}
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
              <p className="text-[11px] text-muted/60 mt-1">{t("settings.companies.admin_hint")}</p>
            </section>
          </div>
        )}

        {/* ════ Tab: Thành viên ════ */}
        {tab === "members" && (
          <div className="flex flex-col">
            {/* Member rows */}
            <div className="divide-y divide-border">
              {members.map((m) => (
                <div
                  key={m.userId}
                  className="group flex items-center gap-3 px-4 py-2 hover:bg-hover/30 transition-colors"
                >
                  {/* Avatar */}
                  <div className="w-7 h-7 rounded-full bg-accent/15 text-accent flex items-center justify-center text-[11px] font-semibold shrink-0">
                    {initials(m.name || m.email)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium truncate">{m.name || m.email}</span>
                      {m.pending && (
                        <span className="text-[10px] px-1 rounded bg-warning/15 text-warning">
                          chờ kích hoạt
                        </span>
                      )}
                      {!m.pending && m.approved === false && (
                        <span className="text-[10px] px-1 rounded bg-danger/15 text-danger">
                          chờ duyệt
                        </span>
                      )}
                      {m.disabled && (
                        <span className="text-[10px] px-1 rounded bg-danger/15 text-danger">
                          đã vô hiệu
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted truncate">{m.email}</div>
                  </div>

                  {/* Role */}
                  <div className="shrink-0">
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
                        className="text-xs py-0.5 h-auto"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <RoleBadge role={m.role} />
                    )}
                  </div>

                  {/* Actions — hover */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {isAdmin && m.pending && (
                      <button
                        type="button"
                        disabled={busy}
                        title="Gửi lại link kích hoạt"
                        onClick={() =>
                          void run(async () => {
                            const r = await companies.resendInvite(m.userId);
                            const full = window.location.origin + r.inviteLink;
                            setInviteLink(full);
                            setInviteEmail(m.email);
                            await navigator.clipboard?.writeText(full).catch(() => {});
                          }, t("settings.companies.resend_ok"))
                        }
                        className="p-1 rounded hover:bg-accent/10 text-muted hover:text-accent transition-colors"
                      >
                        <I.Send size={12} />
                      </button>
                    )}
                    {isAdmin && !m.pending && m.approved === false && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          title={t("settings.companies.approve_btn")}
                          onClick={() =>
                            void run(
                              () => companies.approveMember(m.userId).then(() => {}),
                              t("settings.companies.approve_ok"),
                            )
                          }
                          className="p-1 rounded hover:bg-success/10 text-muted hover:text-success transition-colors"
                        >
                          <I.Check size={12} />
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          title={t("settings.companies.reject_btn")}
                          onClick={() =>
                            void run(
                              () => companies.rejectMember(m.userId).then(() => {}),
                              t("settings.companies.reject_ok"),
                            )
                          }
                          className="p-1 rounded hover:bg-danger/10 text-muted hover:text-danger transition-colors"
                        >
                          <I.X size={12} />
                        </button>
                      </>
                    )}
                    {isAdmin && !m.pending && (
                      <button
                        type="button"
                        disabled={busy}
                        title="Đặt lại mật khẩu"
                        onClick={() => {
                          setResetTarget({ userId: m.userId, email: m.email });
                          setResetPwd("");
                        }}
                        className="p-1 rounded hover:bg-warning/10 text-muted hover:text-warning transition-colors"
                      >
                        <I.Lock size={12} />
                      </button>
                    )}
                    {isAdmin &&
                      !m.pending &&
                      (m.disabled ? (
                        <button
                          type="button"
                          disabled={busy}
                          title={t("settings.companies.enable_btn")}
                          onClick={() =>
                            void run(
                              () => companies.enableMember(m.userId).then(() => {}),
                              t("settings.companies.enable_ok"),
                            )
                          }
                          className="p-1 rounded hover:bg-success/10 text-muted hover:text-success transition-colors"
                        >
                          <I.Check size={12} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          title={t("settings.companies.disable_btn")}
                          onClick={() =>
                            void run(
                              () => companies.disableMember(m.userId).then(() => {}),
                              t("settings.companies.disable_ok"),
                            )
                          }
                          className="p-1 rounded hover:bg-danger/10 text-muted hover:text-danger transition-colors"
                        >
                          <I.Ban size={12} />
                        </button>
                      ))}
                    {isAdmin && (
                      <button
                        type="button"
                        disabled={busy}
                        title={t("settings.companies.remove_title")}
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
                        className="p-1 rounded hover:bg-danger/10 text-muted hover:text-danger transition-colors"
                      >
                        <I.Trash size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {members.length === 0 && (
                <div className="px-4 py-6 text-xs text-muted/60 text-center">
                  {t("settings.companies.no_members")}
                </div>
              )}
            </div>

            {/* Form mời thành viên */}
            {isAdmin && (
              <div className="border-t border-border px-4 py-3 space-y-2 bg-bg-soft/30">
                <div className="text-[10px] font-semibold text-muted/60 uppercase tracking-wider">
                  {t("settings.companies.invite_title")}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder={t("settings.companies.invite_email_ph")}
                    value={mEmail}
                    disabled={busy}
                    onChange={(e) => setMEmail(e.target.value)}
                    className="flex-1 text-xs"
                  />
                  <Input
                    placeholder={t("settings.companies.invite_name_ph")}
                    value={mName}
                    disabled={busy}
                    onChange={(e) => setMName(e.target.value)}
                    className="w-36 text-xs"
                  />
                  <Select
                    value={mRole}
                    disabled={busy}
                    onChange={(e) => setMRole(e.target.value as CompanyRole)}
                    className="w-28 text-xs"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<I.Send size={13} />}
                    disabled={busy || !mEmail.trim()}
                    onClick={() =>
                      void run(async () => {
                        const r = (await companies.addMember({
                          email: mEmail.trim(),
                          name: mName.trim() || undefined,
                          role: mRole,
                        })) as { inviteLink?: string };
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
                </div>
                <p className="text-[11px] text-muted/60">{t("settings.companies.invite_hint")}</p>
              </div>
            )}

            {/* Invite link banner */}
            {inviteLink && (
              <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-md border border-accent/30 bg-accent/5">
                <I.Send size={12} className="text-accent shrink-0" />
                <span className="text-xs text-muted truncate flex-1">
                  {t("settings.companies.link_label")}{" "}
                  <span className="font-mono">{inviteEmail}</span>
                </span>
                <Input
                  value={inviteLink}
                  readOnly
                  className="w-56 font-mono text-[11px]"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  variant="default"
                  size="sm"
                  icon={<I.Copy size={12} />}
                  onClick={() => void navigator.clipboard?.writeText(inviteLink)}
                >
                  Copy
                </Button>
                <button
                  type="button"
                  onClick={() => setInviteLink("")}
                  className="text-muted hover:text-text p-1"
                >
                  <I.X size={12} />
                </button>
              </div>
            )}

            {/* Reset password panel */}
            {resetTarget && (
              <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-md border border-warning/30 bg-warning/5">
                <I.Lock size={12} className="text-warning shrink-0" />
                <span className="text-xs text-muted truncate">
                  {t("settings.companies.reset_panel_title")}{" "}
                  <span className="font-mono">{resetTarget.email}</span>
                </span>
                <Input
                  type="password"
                  placeholder={t("settings.companies.reset_pwd_ph")}
                  value={resetPwd}
                  disabled={busy}
                  onChange={(e) => setResetPwd(e.target.value)}
                  className="w-48 text-xs"
                />
                <Button
                  variant="danger"
                  size="sm"
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
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="text-muted hover:text-text p-1"
                >
                  <I.X size={12} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ════ Tab: Link mời ════ */}
        {tab === "links" && isAdmin && (
          <div className="max-w-lg px-5 py-4 space-y-4">
            <div className="text-[10px] font-semibold text-muted/60 uppercase tracking-wider">
              {t("settings.companies.generic_link_title")}
            </div>
            <p className="text-xs text-muted/80">{t("settings.companies.generic_link_hint")}</p>

            {/* Tạo link mới */}
            <div className="flex items-center gap-2">
              <Select
                value={genericRole}
                disabled={busy}
                onChange={(e) => setGenericRole(e.target.value as CompanyRole)}
                className="w-32 text-xs"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
              <Button
                variant="primary"
                size="sm"
                icon={<I.Plus size={13} />}
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
                  icon={<I.Copy size={12} />}
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
              <div className="rounded-md border border-border divide-y divide-border overflow-hidden">
                {genericLinks.map((lk) => {
                  const used = !!lk.usedAt;
                  const expired = !used && new Date(lk.expiresAt) < new Date();
                  const active = !used && !expired;
                  return (
                    <div key={lk.id} className="flex items-center gap-2 px-3 py-2">
                      <I.Link size={11} className="text-muted shrink-0" />
                      <span className="font-mono text-xs text-muted truncate flex-1">
                        …/join?token={lk.token.slice(0, 8)}…
                      </span>
                      <RoleBadge role={lk.role} />
                      {used && (
                        <Chip variant="success" className="text-[10px]!">
                          {t("settings.companies.link_used")}
                        </Chip>
                      )}
                      {expired && (
                        <Chip variant="warning" className="text-[10px]!">
                          {t("settings.companies.link_expired")}
                        </Chip>
                      )}
                      {active && (
                        <button
                          type="button"
                          onClick={() =>
                            void navigator.clipboard?.writeText(
                              `${window.location.origin}/join?token=${lk.token}`,
                            )
                          }
                          className="p-1 rounded hover:bg-accent/10 text-muted hover:text-accent transition-colors"
                          title="Copy link"
                        >
                          <I.Copy size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => companies.deleteInviteLink(lk.id).then(() => {}),
                            t("settings.companies.generic_link_revoked"),
                          )
                        }
                        className="p-1 rounded hover:bg-danger/10 text-muted hover:text-danger transition-colors"
                        title={t("settings.companies.generic_link_revoke")}
                      >
                        <I.Trash size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {genericLinks.length === 0 && !newGenericLink && (
              <div className="text-xs text-muted/60 text-center py-4">Chưa có link mời nào.</div>
            )}
          </div>
        )}

        {tab === "links" && !isAdmin && (
          <div className="px-5 py-6 text-xs text-muted/60 text-center">
            Chỉ admin mới quản lý link mời.
          </div>
        )}

        {/* Feedback */}
        {(msg || err) && (
          <div className="px-4 py-2 flex gap-2">
            {msg && <Chip variant="success">{msg}</Chip>}
            {err && <Chip variant="danger">{err}</Chip>}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/companies")({
  component: CompaniesSettings,
});
