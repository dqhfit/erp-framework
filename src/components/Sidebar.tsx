import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { I } from "@/components/Icons";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import type { IconName } from "@/lib/object-types";
import { type ObjectType, roleCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useRbac } from "@/stores/rbac";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

interface SidebarItemProps {
  to: string;
  active: boolean;
  icon: ReactNode;
  collapsed: boolean;
  label: string;
  badge?: string;
  title?: string;
  /** Show hover actions cho user-created object */
  onDelete?: () => void;
  onRename?: () => void;
}
function SidebarItem({
  to,
  active,
  icon,
  collapsed,
  label,
  badge,
  title,
  onDelete,
  onRename,
}: SidebarItemProps) {
  const t = useT();
  const hasActions = !collapsed && (onDelete || onRename);
  return (
    <div className="relative group">
      <Link
        to={to}
        className={cn("sidebar-item", active && "active", hasActions && "pr-12")}
        title={title ?? (collapsed ? label : "")}
      >
        <span className="icon text-muted shrink-0">{icon}</span>
        {!collapsed && (
          <>
            <span className="truncate flex-1">{label}</span>
            {badge && (
              <span className="chip" style={{ height: 16, fontSize: 10, padding: "0 5px" }}>
                {badge}
              </span>
            )}
          </>
        )}
      </Link>
      {hasActions && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onRename && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRename();
              }}
              className="w-5 h-5 rounded-sm hover:bg-hover/80 flex items-center justify-center text-muted hover:text-text"
              title={t("common.rename")}
            >
              <I.Edit size={11} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
              className="w-5 h-5 rounded-sm hover:bg-danger/20 flex items-center justify-center text-muted hover:text-danger"
              title={t("common.delete")}
            >
              <I.Trash size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface SectionItem {
  id: string;
  name: string;
  iconName: IconName;
  to: string;
  badge?: string;
  /** True nếu là user-created → cho phép xóa/rename */
  userOwned?: boolean;
}
interface SectionProps {
  title: string;
  collapsed: boolean;
  items: SectionItem[];
  pathname: string;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  onAiAdd?: () => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string, currentName: string) => void;
}
function SidebarSection({
  title,
  collapsed,
  items,
  pathname,
  open,
  onToggle,
  onAdd,
  onAiAdd,
  onDelete,
  onRename,
}: SectionProps) {
  const t = useT();
  return (
    <div className={cn("mb-1.5", !collapsed && !open && "mb-0")}>
      {!collapsed && !open && (
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center gap-1 px-3 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase text-muted/40 hover:text-muted transition-colors"
        >
          <I.ChevronRight size={10} className="shrink-0" />
          <span className="truncate">{title}</span>
        </button>
      )}
      {!collapsed && open && (
        <div className="flex items-center justify-between px-3 mt-3 mb-1">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.08em] uppercase text-muted hover:text-text min-w-0"
          >
            <I.ChevronRight size={10} className="transition-transform shrink-0 rotate-90" />
            <span className="truncate">{title}</span>
          </button>
          <div className="flex items-center gap-0.5 shrink-0">
            {onAiAdd && (
              <button
                type="button"
                onClick={onAiAdd}
                className="w-5 h-5 rounded-sm hover:bg-accent/20 flex items-center justify-center text-accent hover:text-accent"
                title={t("sidebar.add_ai", { kind: title.toLowerCase() })}
              >
                <I.Sparkles size={11} />
              </button>
            )}
            <button
              type="button"
              onClick={onAdd}
              disabled={!onAdd}
              className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("sidebar.add_blank", { kind: title.toLowerCase() })}
            >
              <I.Plus size={12} />
            </button>
          </div>
        </div>
      )}
      {(collapsed || open) &&
        items.map((item) => {
          const IconC = I[item.iconName] || I.Folder;
          return (
            <SidebarItem
              key={item.id}
              to={item.to}
              active={pathname === item.to}
              icon={<IconC size={14} />}
              collapsed={collapsed}
              label={item.name}
              badge={item.badge}
              onDelete={item.userOwned && onDelete ? () => onDelete(item.id) : undefined}
              onRename={item.userOwned && onRename ? () => onRename(item.id, item.name) : undefined}
            />
          );
        })}
    </div>
  );
}

/* Nhóm điều hướng GỌN LẠI — tiêu đề bấm để mở/đóng. Khi sidebar
   ở chế độ thu nhỏ (icon-only) thì bỏ tiêu đề, hiện thẳng item. */
function NavGroup({
  title,
  collapsed,
  open,
  onToggle,
  children,
}: {
  title: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  if (collapsed) return <>{children}</>;
  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1 px-3 mt-2.5 mb-1 text-[10px] font-semibold tracking-[0.08em] uppercase text-muted hover:text-text"
      >
        <I.ChevronRight
          size={10}
          className={cn("transition-transform shrink-0", open && "rotate-90")}
        />
        <span className="truncate">{title}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

export function Sidebar() {
  const t = useT();
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const setAiCreateTarget = useUI((s) => s.setAiCreateTarget);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  const [sectionsOpen, setSectionsOpen] = useState({
    entities: true,
    pages: true,
    workflows: true,
    agents: true,
    ops: true,
    settings: false,
  });
  const allOpen = Object.values(sectionsOpen).some(Boolean);
  const toggleAll = () => {
    const next = !allOpen;
    setSectionsOpen({
      entities: next,
      pages: next,
      workflows: next,
      agents: next,
      ops: next,
      settings: next,
    });
  };
  const toggle = (key: keyof typeof sectionsOpen) => () =>
    setSectionsOpen((s) => ({ ...s, [key]: !s[key] }));

  // RBAC — chặn nút theo role. Lấy role+enforce để component re-render khi đổi.
  const role = useRbac((s) => s.role);
  const enforce = useRbac((s) => s.enforce);
  const can = (action: "create" | "edit" | "delete", obj: ObjectType) =>
    !enforce || roleCan(role, action, obj);

  // Đối tượng low-code — nguồn dữ liệu là backend (qua useUserObjects).
  const userEntities = useUserObjects((s) => s.entities);
  const userPages = useUserObjects((s) => s.pages);
  const userWorkflows = useUserObjects((s) => s.workflows);
  const userAgents = useUserObjects((s) => s.agents);
  // Membership: primary agent + my agents — dùng để pin ★/★★ và sort lên đầu.
  const primaryAgentId = useAuth((s) => s.primaryAgentId);
  const myAgentRoles = useAuth((s) => s.myAgentRoles);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  /** Trọng số sort: primary=0, my-agent=1, khác=2; cùng nhóm thì giữ thứ tự cũ. */
  const agentWeight = (id: string): number => {
    if (id === primaryAgentId) return 0;
    if (myAgentRoles[id]) return 1;
    return 2;
  };
  const sortedAgents = [...userAgents].sort((a, b) => agentWeight(a.id) - agentWeight(b.id));
  const {
    addEntity,
    deleteEntity,
    renameEntity,
    addPage,
    deletePage,
    renamePage,
    addWorkflow,
    deleteWorkflow,
    renameWorkflow,
    addAgent,
    deleteAgent,
    renameAgent,
  } = useUserObjects.getState();

  /** Generic delete + navigate home nếu đang ở route đó */
  const onDeleteFn =
    (kind: string, fn: (id: string) => void, basePath: string) => async (id: string) => {
      const ok = await dialog.confirm(t("sidebar.confirm_delete", { kind, id }), {
        title: t("sidebar.confirm_delete_title", { kind }),
        confirmText: t("common.delete"),
        danger: true,
      });
      if (!ok) return;
      fn(id);
      if (pathname === `${basePath}/${id}`) navigate({ to: "/" });
    };
  /** Generic rename via dialog.prompt */
  const onRenameFn =
    (kind: string, fn: (id: string, name: string) => void) =>
    async (id: string, currentName: string) => {
      const next = (
        await dialog.prompt(t("sidebar.rename_prompt", { kind }), currentName, {
          title: t("sidebar.rename_title", { kind }),
        })
      )?.trim();
      if (!next || next === currentName) return;
      fn(id, next);
    };

  const handleDeleteEntity = onDeleteFn("entity", deleteEntity, "/entities");
  const handleRenameEntity = onRenameFn("entity", renameEntity);
  const handleDeletePage = onDeleteFn("page", deletePage, "/pages");
  const handleRenamePage = onRenameFn("page", renamePage);
  const handleDeleteWorkflow = onDeleteFn("workflow", deleteWorkflow, "/workflows");
  const handleRenameWorkflow = onRenameFn("workflow", renameWorkflow);
  const handleDeleteAgent = onDeleteFn("agent", deleteAgent, "/agents");
  const handleRenameAgent = onRenameFn("agent", renameAgent);

  /** Prompt name + tạo + navigate. id là uuid client cấp (khớp backend). */
  const promptName = async (label: string): Promise<{ id: string; name: string } | null> => {
    const name = (
      await dialog.prompt(t("sidebar.new_prompt", { kind: label }), "", {
        title: t("sidebar.new_title", { kind: label }),
      })
    )?.trim();
    if (!name) return null;
    return { id: crypto.randomUUID(), name };
  };

  const handleAddEntity = async () => {
    const r = await promptName("entity");
    if (!r) return;
    addEntity({ id: r.id, name: r.name, icon: "Database", mcp: "", fields: [] });
    navigate({ to: "/entities/$id", params: { id: r.id } });
  };
  const handleAddPage = async () => {
    const r = await promptName("page");
    if (!r) return;
    addPage({ id: r.id, name: r.name, icon: "Layout", updated: "vừa xong", author: "bạn" });
    navigate({ to: "/pages/$id", params: { id: r.id } });
  };
  const handleAddWorkflow = async () => {
    const r = await promptName("workflow");
    if (!r) return;
    addWorkflow({ id: r.id, name: r.name, icon: "Workflow", status: "active", runs: 0 });
    navigate({ to: "/workflows/$id", params: { id: r.id } });
  };
  const handleAddAgent = async () => {
    const r = await promptName("agent");
    if (!r) return;
    addAgent({ id: r.id, name: r.name, model: "claude-sonnet-4-6", tools: 0 });
    navigate({ to: "/agents/$id", params: { id: r.id } });
  };

  return (
    <aside
      className="shrink-0 border-r border-border bg-panel flex flex-col overflow-hidden"
      style={{ width: collapsed ? 56 : 240, transition: "width 180ms ease" }}
    >
      <div className="flex-1 overflow-y-auto py-1">
        <SidebarItem
          to="/"
          active={pathname === "/"}
          icon={<I.Home size={14} />}
          collapsed={collapsed}
          label={t("sidebar.workspace")}
        />
        {!collapsed && (
          <div className="flex justify-end px-2 pt-1 pb-0">
            <button
              type="button"
              onClick={toggleAll}
              title={allOpen ? t("sidebar.collapse_all") : t("sidebar.expand_all")}
              className="flex items-center gap-1 text-[10px] text-muted hover:text-text px-1.5 py-0.5 rounded hover:bg-hover/60 transition-colors"
            >
              <I.ChevronsUpDown size={10} />
              {allOpen ? t("sidebar.collapse_all") : t("sidebar.expand_all")}
            </button>
          </div>
        )}

        <SidebarSection
          title={t("sidebar.entities")}
          collapsed={collapsed}
          pathname={pathname}
          open={sectionsOpen.entities}
          onToggle={toggle("entities")}
          onAdd={can("create", "entity") ? handleAddEntity : undefined}
          onAiAdd={can("create", "entity") ? () => setAiCreateTarget("entity") : undefined}
          onDelete={can("delete", "entity") ? handleDeleteEntity : undefined}
          onRename={can("edit", "entity") ? handleRenameEntity : undefined}
          items={userEntities.map((e) => ({
            id: e.id,
            name: e.name,
            iconName: e.icon,
            to: `/entities/${e.id}`,
            userOwned: true,
          }))}
        />
        <SidebarSection
          title={t("sidebar.pages")}
          collapsed={collapsed}
          pathname={pathname}
          open={sectionsOpen.pages}
          onToggle={toggle("pages")}
          onAdd={can("create", "page") ? handleAddPage : undefined}
          onAiAdd={can("create", "page") ? () => setAiCreateTarget("page") : undefined}
          onDelete={can("delete", "page") ? handleDeletePage : undefined}
          onRename={can("edit", "page") ? handleRenamePage : undefined}
          items={userPages.map((p) => ({
            id: p.id,
            name: p.name,
            iconName: p.icon,
            to: `/pages/${p.id}`,
            userOwned: true,
          }))}
        />
        <SidebarSection
          title={t("sidebar.workflows")}
          collapsed={collapsed}
          pathname={pathname}
          open={sectionsOpen.workflows}
          onToggle={toggle("workflows")}
          onAdd={can("create", "workflow") ? handleAddWorkflow : undefined}
          onAiAdd={can("create", "workflow") ? () => setAiCreateTarget("workflow") : undefined}
          onDelete={can("delete", "workflow") ? handleDeleteWorkflow : undefined}
          onRename={can("edit", "workflow") ? handleRenameWorkflow : undefined}
          items={userWorkflows.map((w) => ({
            id: w.id,
            name: w.name,
            iconName: w.icon,
            to: `/workflows/${w.id}`,
            badge: w.status === "paused" ? "⏸" : undefined,
            userOwned: true,
          }))}
        />
        <SidebarSection
          title={t("sidebar.agents")}
          collapsed={collapsed}
          pathname={pathname}
          open={sectionsOpen.agents}
          onToggle={toggle("agents")}
          onAdd={can("create", "agent") ? handleAddAgent : undefined}
          onAiAdd={can("create", "agent") ? () => setAiCreateTarget("agent") : undefined}
          onDelete={can("delete", "agent") ? handleDeleteAgent : undefined}
          onRename={can("edit", "agent") ? handleRenameAgent : undefined}
          items={sortedAgents.map((a) => ({
            id: a.id,
            name: a.name,
            iconName: "Bot" as const,
            to: `/agents/${a.id}`,
            // 2★ primary, ★ my-agent, không-marker = thường.
            badge: a.id === primaryAgentId ? "★★" : myAgentRoles[a.id] ? "★" : undefined,
            userOwned: true,
          }))}
        />
      </div>

      <div className="border-t border-border py-1 overflow-y-auto shrink min-h-0">
        <NavGroup
          title={t("sidebar.group_ops")}
          collapsed={collapsed}
          open={sectionsOpen.ops}
          onToggle={toggle("ops")}
        >
          {/* /server-data ẩn khỏi Sidebar — Sidebar đã auto-hydrate từ
              __root.tsx; trang chỉ dành cho admin debug raw record/MCP,
              truy cập trực tiếp qua URL khi cần. */}
          <SidebarItem
            to="/activity"
            active={pathname === "/activity"}
            icon={<I.Activity size={14} />}
            collapsed={collapsed}
            label={t("sidebar.activity")}
          />
          <SidebarItem
            to="/approvals"
            active={pathname === "/approvals"}
            icon={<I.CheckSq size={14} />}
            collapsed={collapsed}
            label={t("sidebar.approvals")}
          />
          <SidebarItem
            to="/org-chart"
            active={pathname === "/org-chart"}
            icon={<I.GitBranch size={14} />}
            collapsed={collapsed}
            label={t("sidebar.org_chart")}
          />
          <SidebarItem
            to="/knowledge"
            active={pathname === "/knowledge"}
            icon={<I.File size={14} />}
            collapsed={collapsed}
            label={t("sidebar.knowledge")}
          />
          <SidebarItem
            to="/iot"
            active={pathname.startsWith("/iot")}
            icon={<I.Server size={14} />}
            collapsed={collapsed}
            label={t("sidebar.iot")}
          />
          <SidebarItem
            to="/procedures"
            active={pathname.startsWith("/procedures")}
            icon={<I.Terminal size={14} />}
            collapsed={collapsed}
            label={t("sidebar.procedures")}
          />
          <SidebarItem
            to="/enums"
            active={pathname.startsWith("/enums")}
            icon={<I.Tag size={14} />}
            collapsed={collapsed}
            label={t("sidebar.enums")}
          />
          <SidebarItem
            to="/tools"
            active={pathname.startsWith("/tools")}
            icon={<I.Wand size={14} />}
            collapsed={collapsed}
            label={t("sidebar.tools")}
          />
          <SidebarItem
            to="/feedback"
            active={pathname.startsWith("/feedback")}
            icon={<I.HelpCircle size={14} />}
            collapsed={collapsed}
            label={t("sidebar.feedback")}
          />
        </NavGroup>
        <NavGroup
          title={t("sidebar.group_settings")}
          collapsed={collapsed}
          open={sectionsOpen.settings}
          onToggle={toggle("settings")}
        >
          <SidebarItem
            to="/settings/agents"
            active={pathname === "/settings/agents"}
            icon={<I.Bot size={14} />}
            collapsed={collapsed}
            label={t("sidebar.my_agents")}
          />
          <SidebarItem
            to="/settings/rbac"
            active={pathname === "/settings/rbac"}
            icon={<I.Users size={14} />}
            collapsed={collapsed}
            label={t("sidebar.rbac")}
          />
          <SidebarItem
            to="/settings/companies"
            active={pathname === "/settings/companies"}
            icon={<I.Briefcase size={14} />}
            collapsed={collapsed}
            label={t("sidebar.companies")}
          />
          <SidebarItem
            to="/settings/llm"
            active={pathname === "/settings/llm"}
            icon={<I.Sparkles size={14} />}
            collapsed={collapsed}
            label={t("sidebar.llm_profiles")}
          />
          <SidebarItem
            to="/settings/embedding"
            active={pathname === "/settings/embedding"}
            icon={<I.Hash size={14} />}
            collapsed={collapsed}
            label={t("sidebar.embedding")}
          />
          <SidebarItem
            to="/settings/mcp"
            active={pathname === "/settings/mcp"}
            icon={<I.Server size={14} />}
            collapsed={collapsed}
            label={t("sidebar.mcp_server")}
          />
          <SidebarItem
            to="/settings/transfer"
            active={pathname === "/settings/transfer"}
            icon={<I.Save size={14} />}
            collapsed={collapsed}
            label={t("sidebar.transfer")}
          />
          <SidebarItem
            to="/settings/backup"
            active={pathname === "/settings/backup"}
            icon={<I.Save size={14} />}
            collapsed={collapsed}
            label={t("sidebar.backup")}
          />
          <SidebarItem
            to="/settings/plugins"
            active={pathname === "/settings/plugins"}
            icon={<I.Package size={14} />}
            collapsed={collapsed}
            label={t("sidebar.plugins")}
          />
          <SidebarItem
            to="/settings/tools"
            active={pathname === "/settings/tools"}
            icon={<I.Wand size={14} />}
            collapsed={collapsed}
            label={t("sidebar.tools_mgmt")}
          />
          <SidebarItem
            to="/settings/embed"
            active={pathname === "/settings/embed"}
            icon={<I.Link size={14} />}
            collapsed={collapsed}
            label={t("sidebar.embed")}
          />
          <SidebarItem
            to="/settings/api-keys"
            active={pathname === "/settings/api-keys"}
            icon={<I.Key size={14} />}
            collapsed={collapsed}
            label={t("sidebar.api_keys")}
          />
        </NavGroup>
      </div>

      {/* === User info + Đăng xuất === */}
      <div className="shrink-0 border-t border-border px-2 py-2">
        {collapsed ? (
          <button
            type="button"
            title={t("sidebar.logout")}
            onClick={() => void logout()}
            className="w-full h-9 flex items-center justify-center rounded-md hover:bg-danger/10 text-muted hover:text-danger transition-colors"
          >
            <I.LogOut size={15} />
          </button>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-semibold shrink-0 select-none">
              {user?.name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{user?.name ?? ""}</div>
              <div className="text-[10px] text-muted truncate">{user?.email ?? ""}</div>
            </div>
            <button
              type="button"
              title={t("sidebar.logout")}
              onClick={() => void logout()}
              className="w-7 h-7 rounded-md hover:bg-danger/10 text-muted hover:text-danger flex items-center justify-center transition-colors shrink-0"
            >
              <I.LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
