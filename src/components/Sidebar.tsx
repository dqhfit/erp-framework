import { createLegacyMenuClient } from "@erp-framework/client";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AssignPageToMenuModal } from "@/components/AssignPageToMenuModal";
import { ChangeMenuNodePageModal } from "@/components/ChangeMenuNodePageModal";
import { I } from "@/components/Icons";
import type { NavNode } from "@/components/MenuTree";
import { NewPageModal } from "@/components/NewPageModal";
import { FavoritesSection } from "@/components/sidebar/FavoritesSection";
import { useFavs } from "@/components/sidebar/favs";
import { NavGroup } from "@/components/sidebar/NavGroup";
import { type PageListItem, PagesListSection } from "@/components/sidebar/PagesListSection";
import { PagesTreeSection } from "@/components/sidebar/PagesTreeSection";
import { SidebarItem } from "@/components/sidebar/SidebarItem";
import { type SectionItem, SidebarSection } from "@/components/sidebar/SidebarSection";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useInvalidateNavTree, useNavTree } from "@/hooks/useNavTree";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { type ObjectType, roleCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useRbac } from "@/stores/rbac";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

// useFavs tách sang ./sidebar/favs — re-export để index.tsx/portal.tsx giữ nguyên import.
export { useFavs };

export function Sidebar() {
  const t = useT();
  const isMobile = useIsMobile();
  const storeCollapsed = useUI((s) => s.sidebarCollapsed);
  // Mobile = off-canvas drawer luôn hiển thị bản đầy đủ (không icon-only).
  const collapsed = isMobile ? false : storeCollapsed;
  const mobileNavOpen = useUI((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUI((s) => s.setMobileNavOpen);
  const setAiCreateTarget = useUI((s) => s.setAiCreateTarget);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const favs = useFavs();
  // Trạng thái mở/đóng các section — NHỚ qua reload (localStorage). Merge với
  // defaults để key mới (thêm section sau này) vẫn có giá trị mặc định.
  const [sectionsOpen, setSectionsOpen] = useState(() => {
    const defaults = {
      entities: true,
      pages: true,
      pagesList: true,
      workflows: true,
      agents: true,
      datasources: true,
      ops: true,
      settings: false,
    };
    try {
      const r = localStorage.getItem("sidebar-sections-open");
      return r ? { ...defaults, ...(JSON.parse(r) as Partial<typeof defaults>) } : defaults;
    } catch {
      return defaults;
    }
  });
  const allOpen = Object.values(sectionsOpen).some(Boolean);
  const toggleAll = () => {
    const next = !allOpen;
    setSectionsOpen({
      entities: next,
      pages: next,
      pagesList: next,
      workflows: next,
      agents: next,
      datasources: next,
      ops: next,
      settings: next,
    });
  };
  const toggle = (key: keyof typeof sectionsOpen) => () =>
    setSectionsOpen((s) => ({ ...s, [key]: !s[key] }));

  /** Accordion cho Vận hành ↔ Cấu hình: mở nhóm này thì thu gọn nhóm kia. */
  const toggleExclusive = (key: "ops" | "settings") => () =>
    setSectionsOpen((s) => {
      const opening = !s[key];
      return { ...s, ops: opening && key === "ops", settings: opening && key === "settings" };
    });

  // Lưu trạng thái mở/đóng section mỗi khi đổi → reload khôi phục đúng như trước.
  useEffect(() => {
    try {
      localStorage.setItem("sidebar-sections-open", JSON.stringify(sectionsOpen));
    } catch {}
  }, [sectionsOpen]);

  // Cho phép ẩn cây menu legacy để sidebar gọn hơn, giữ lựa chọn qua reload.
  const [showMenuTree, setShowMenuTree] = useState(() => {
    try {
      return localStorage.getItem("sidebar-show-menu-tree") !== "false";
    } catch {
      return true;
    }
  });
  const toggleMenuTree = useCallback(() => {
    setShowMenuTree((current) => {
      const next = !current;
      try {
        localStorage.setItem("sidebar-show-menu-tree", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearch("");
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ phản ứng khi collapsed đổi; closeSearch là helper local ổn định, thêm vào deps sẽ chạy effect thừa
  useEffect(() => {
    if (collapsed) closeSearch();
  }, [collapsed]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  // Mobile off-canvas: Esc đóng drawer.
  useEffect(() => {
    if (!isMobile || !mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, mobileNavOpen, setMobileNavOpen]);

  // Đổi route → tự đóng drawer mobile (mọi Link/navigate trong sidebar).
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ phản ứng khi pathname đổi; setMobileNavOpen ổn định
  useEffect(() => {
    if (isMobile) setMobileNavOpen(false);
  }, [pathname]);

  // Khớp cả nhãn hiển thị (name) lẫn tên kỹ thuật (techName — vd tr_sanpham):
  // sau re-migrate, entity mang tên bảng nguồn nên tìm theo tên kỹ thuật là
  // thao tác thường xuyên khi đối chiếu với DQHF/SQL.
  const filterBySearch = <T extends { name: string; techName?: string }>(arr: T[]): T[] => {
    const q = search.trim().toLowerCase();
    if (!q) return arr;
    return arr.filter(
      (i) => i.name.toLowerCase().includes(q) || (i.techName ?? "").toLowerCase().includes(q),
    );
  };
  const effectiveSectionsOpen = search.trim()
    ? {
        ...sectionsOpen,
        entities: true,
        pages: true,
        pagesList: true,
        workflows: true,
        agents: true,
        datasources: true,
      }
    : sectionsOpen;

  // RBAC — chặn nút theo role. Lấy role+enforce để component re-render khi đổi.
  const role = useRbac((s) => s.role);
  const enforce = useRbac((s) => s.enforce);
  const isViewer = role === "viewer";
  const myGroupIds = useUserObjects((s) => s.myGroupIds);
  const can = (action: "create" | "edit" | "delete", obj: ObjectType) =>
    !enforce || roleCan(role, action, obj);

  // Đối tượng low-code — nguồn dữ liệu là backend (qua useUserObjects).
  const userEntities = useUserObjects((s) => s.entities);
  const userPages = useUserObjects((s) => s.pages);

  // Cây điều hướng TRANG theo MENU DQHF (legacy_menu_map.navTree). Admin/editor
  // thấy cả trang draft; rỗng (chưa link menu) → fallback danh sách phẳng.
  const { data: navNodesData, isLoading: navLoading } = useNavTree();
  const navNodes = navNodesData ?? [];
  const invalidateNavTree = useInvalidateNavTree();
  // Trang đang gán vào menu (mở modal).
  const [assignMenuPage, setAssignMenuPage] = useState<{ id: string; name: string } | null>(null);
  // Mục menu đang đổi trang liên kết (mở ChangeMenuNodePageModal).
  const [changeNodePage, setChangeNodePage] = useState<{
    code: string;
    name: string;
    pageId: string | null;
  } | null>(null);
  const [newPageOpen, setNewPageOpen] = useState(false);
  /** Gỡ 1 trang khỏi mục menu (đặt pageId của node = null) rồi refetch cây. */
  const handleUnassignFromMenu = async (node: NavNode) => {
    if (!node.pageId || !node.code) return;
    const ok = await dialog.confirm(`Gỡ “${node.name ?? "trang"}” khỏi menu?`, {
      title: "Gỡ khỏi menu",
      danger: true,
    });
    if (!ok) return;
    try {
      await createLegacyMenuClient("").setNodePage(node.code, null);
      invalidateNavTree();
    } catch (e) {
      await dialog.alert(`Lỗi gỡ khỏi menu: ${(e as Error)?.message ?? e}`);
    }
  };
  const userWorkflows = useUserObjects((s) => s.workflows);
  const userAgents = useUserObjects((s) => s.agents);
  const userDataSources = useUserObjects((s) => s.dataSources);
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
    deletePage,
    renamePage,
    addWorkflow,
    deleteWorkflow,
    renameWorkflow,
    addAgent,
    deleteAgent,
    renameAgent,
    addDataSource,
    deleteDataSource,
    renameDataSource,
  } = useUserObjects.getState();

  /** Thu gọn 2 nhóm Vận hành + Cấu hình khi user điều hướng vào object/page/... */
  const collapseOpsSettings = () => setSectionsOpen((s) => ({ ...s, ops: false, settings: false }));

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
  const handleDeleteEntity = onDeleteFn("entity", deleteEntity, "/entities");
  const handleRenameEntity = (id: string, newName: string) => renameEntity(id, newName);
  const handleDeletePage = onDeleteFn("page", deletePage, "/pages");
  const handleRenamePage = (id: string, newName: string) => renamePage(id, newName);
  const handleDeleteWorkflow = onDeleteFn("workflow", deleteWorkflow, "/workflows");
  const handleRenameWorkflow = (id: string, newName: string) => renameWorkflow(id, newName);
  const handleDeleteAgent = onDeleteFn("agent", deleteAgent, "/agents");
  const handleRenameAgent = (id: string, newName: string) => renameAgent(id, newName);
  const handleDeleteDataSource = onDeleteFn("datasource", deleteDataSource, "/datasources");
  const handleRenameDataSource = (id: string, newName: string) => renameDataSource(id, newName);

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
  // Tạo trang mới → mở popup (tên + gán vào menu/tạo mục menu mới). NewPageModal
  // tự tạo trang + gán + điều hướng sang Trình dựng.
  const handleAddPage = () => setNewPageOpen(true);
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
  const handleAddDataSource = async () => {
    const r = await promptName("datasource");
    if (!r) return;
    addDataSource({ id: r.id, name: r.name, icon: "Database" });
    navigate({ to: "/datasources/$id", params: { id: r.id } });
  };

  return (
    <>
      {/* Backdrop off-canvas trên mobile — click ngoài đóng drawer */}
      {isMobile && mobileNavOpen && (
        <button
          type="button"
          aria-label={t("topbar.toggle_sidebar")}
          className="fixed inset-0 z-[690] bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        className={cn(
          "border-r border-border bg-panel flex flex-col overflow-hidden",
          isMobile
            ? cn(
                "fixed inset-y-0 left-0 z-[695] w-[280px] max-w-[85vw] shadow-2xl transition-transform duration-200",
                mobileNavOpen ? "translate-x-0" : "-translate-x-full",
              )
            : "shrink-0",
        )}
        style={
          isMobile ? undefined : { width: collapsed ? 56 : 240, transition: "width 180ms ease" }
        }
      >
        {/* Home — shrink-0 nên luôn hiển thị, NavGroups dù cao đến đâu cũng không che được */}
        <div className="shrink-0 pt-1">
          <div className="relative group">
            {/* Search mode: thay thế link Home bằng ô nhập tìm kiếm inline */}
            {!collapsed && searchOpen ? (
              <div className={cn("sidebar-item cursor-default pr-[52px]")}>
                <span className="icon text-muted shrink-0">
                  <I.Search size={14} />
                </span>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") closeSearch();
                  }}
                  placeholder={t("sidebar.search")}
                  className="flex-1 bg-transparent outline-none text-[12px] text-text placeholder:text-muted/50 min-w-0"
                />
              </div>
            ) : (
              <Link
                to="/"
                className={cn(
                  "sidebar-item",
                  pathname === "/" && "active",
                  !collapsed && "pr-[52px]",
                )}
                title={t("sidebar.workspace")}
                onClick={() => setSectionsOpen((s) => ({ ...s, ops: false, settings: false }))}
              >
                <span className="icon text-muted shrink-0">
                  <I.Home size={14} />
                </span>
                {!collapsed && <span className="truncate flex-1">{t("sidebar.workspace")}</span>}
              </Link>
            )}

            {!collapsed && (
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                {searchOpen ? (
                  <button
                    type="button"
                    onClick={closeSearch}
                    className="w-6 h-6 rounded-sm flex items-center justify-center text-muted hover:text-text hover:bg-hover/60 transition-colors"
                    title="Đóng tìm kiếm"
                  >
                    <I.X size={11} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    title={t("sidebar.search")}
                    className="w-6 h-6 rounded-sm flex items-center justify-center text-muted/40 hover:text-text hover:bg-hover/60 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <I.Search size={11} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleAll}
                  title={allOpen ? t("sidebar.collapse_all") : t("sidebar.expand_all")}
                  className="w-6 h-6 rounded-sm flex items-center justify-center text-muted/50 hover:text-text hover:bg-hover/60 transition-colors"
                >
                  <I.ChevronsUpDown size={11} />
                </button>
              </div>
            )}
          </div>
          <FavoritesSection
            favs={favs.favs}
            onRemove={favs.remove}
            pathname={pathname}
            collapsed={collapsed}
          />
        </div>

        <div className="flex-1 overflow-y-auto pb-1">
          {!isViewer && (!search.trim() || filterBySearch(userEntities).length > 0) && (
            <SidebarSection
              title={t("sidebar.entities")}
              collapsed={collapsed}
              pathname={pathname}
              open={effectiveSectionsOpen.entities}
              onToggle={toggle("entities")}
              onAdd={can("create", "entity") ? handleAddEntity : undefined}
              onAiAdd={can("create", "entity") ? () => setAiCreateTarget("entity") : undefined}
              onDelete={can("delete", "entity") ? handleDeleteEntity : undefined}
              onRename={can("edit", "entity") ? handleRenameEntity : undefined}
              sectionKey="entities"
              onNavigate={collapseOpsSettings}
              extraButtons={
                <button
                  type="button"
                  onClick={() => navigate({ to: "/entities/erd" })}
                  className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text"
                  title="ERD Diagram"
                >
                  <I.Layers size={11} />
                </button>
              }
              items={filterBySearch(userEntities).map((e) => ({
                id: e.id,
                name: e.name,
                iconName: e.icon,
                to: `/entities/${e.id}`,
                userOwned: true,
                isFav: favs.isFav(e.id),
                onFavorite: () =>
                  favs.toggle({
                    id: e.id,
                    to: `/entities/${e.id}`,
                    label: e.name,
                    iconName: e.icon,
                  }),
              }))}
            />
          )}
          {!isViewer && (!search.trim() || filterBySearch(userDataSources).length > 0) && (
            <SidebarSection
              title="Nguồn dữ liệu"
              collapsed={collapsed}
              pathname={pathname}
              open={effectiveSectionsOpen.datasources}
              onToggle={toggle("datasources")}
              onAdd={can("create", "datasource") ? handleAddDataSource : undefined}
              onDelete={can("delete", "datasource") ? handleDeleteDataSource : undefined}
              onRename={can("edit", "datasource") ? handleRenameDataSource : undefined}
              sectionKey="datasources"
              onNavigate={collapseOpsSettings}
              extraButtons={
                <button
                  type="button"
                  onClick={() => navigate({ to: "/datasources/$id", params: { id: "__sql__" } })}
                  className="w-5 h-5 rounded-sm hover:bg-accent/20 flex items-center justify-center text-muted hover:text-accent"
                  title="Mở màn hình SQL (soạn → lưu thành / áp dụng vào nguồn dữ liệu)"
                >
                  <I.Terminal size={11} />
                </button>
              }
              items={filterBySearch(userDataSources).map((d) => ({
                id: d.id,
                name: d.name,
                iconName: d.icon,
                to: `/datasources/${d.id}`,
                userOwned: true,
                isFav: favs.isFav(d.id),
                onFavorite: () =>
                  favs.toggle({
                    id: d.id,
                    to: `/datasources/${d.id}`,
                    label: d.name,
                    iconName: d.icon,
                  }),
              }))}
            />
          )}
          {(() => {
            const pagesBase = (
              isViewer
                ? userPages.filter(
                    (p) =>
                      p.isPublished &&
                      (!p.viewerGroupIds?.length ||
                        p.viewerGroupIds.some((gid) => myGroupIds.includes(gid))),
                  )
                : [...userPages]
            ).sort((a, b) => a.name.localeCompare(b.name, "vi"));
            // Trang tĩnh: route hardcode không nằm trong userPages (vd MES Mục
            // tiêu sản xuất). Không userOwned → không xóa/rename/kéo-thả.
            const staticPages: SectionItem[] = [
              {
                id: "/mes/muctieu-sanxuat",
                name: "Mục tiêu sản xuất",
                iconName: "Calculator",
                to: "/mes/muctieu-sanxuat",
                isFav: favs.isFav("/mes/muctieu-sanxuat"),
                onFavorite: () =>
                  favs.toggle({
                    id: "/mes/muctieu-sanxuat",
                    to: "/mes/muctieu-sanxuat",
                    label: "Mục tiêu sản xuất",
                    iconName: "Calculator",
                  }),
              },
            ];
            const pageItems: SectionItem[] = [
              ...filterBySearch(staticPages),
              ...filterBySearch(pagesBase).map((p) => ({
                id: p.id,
                name: p.name,
                iconName: p.icon,
                to: `/pages/${p.id}`,
                userOwned: true,
                isFav: favs.isFav(p.id),
                onFavorite: () =>
                  favs.toggle({ id: p.id, to: `/pages/${p.id}`, label: p.name, iconName: p.icon }),
              })),
            ];
            if (search.trim() && pageItems.length === 0) return null;
            // CÂY MENU DQHF: khi có node link trang + không thu nhỏ + không tìm
            // kiếm → 2 nhóm: "Menu" (cây điều hướng) + "Trang" (mọi trang, badge
            // "có menu"). Ngược lại: danh sách phẳng (fallback hoặc search/thu nhỏ).
            const useTree =
              (navLoading || navNodes.some((n) => n.pageId)) && !collapsed && !search.trim();
            if (useTree) {
              // Toàn bộ trang (đã/chưa gắn menu) cho nhóm "Trang".
              const allPages: PageListItem[] = [
                ...staticPages.map((s) => ({
                  id: s.id,
                  name: s.name,
                  icon: s.iconName,
                  to: s.to,
                  status: null,
                })),
                ...pagesBase.map((p) => ({
                  id: p.id,
                  name: p.name,
                  icon: p.icon,
                  to: `/pages/${p.id}`,
                  status: p.status ?? null,
                })),
              ];
              return (
                // Menu + Trang CÙNG MỘT NHÓM (viền dưới chung).
                <div className="border-b border-border/40">
                  <PagesTreeSection
                    collapsed={collapsed}
                    pathname={pathname}
                    open={effectiveSectionsOpen.pages}
                    onToggle={toggle("pages")}
                    showMenuTree={showMenuTree}
                    onToggleMenuTree={toggleMenuTree}
                    onAdd={can("create", "page") ? handleAddPage : undefined}
                    onAiAdd={can("create", "page") ? () => setAiCreateTarget("page") : undefined}
                    onNavigate={collapseOpsSettings}
                    navNodes={navNodes}
                    allPages={allPages}
                    onOpen={(to) => navigate({ to })}
                    loading={navLoading}
                    onUnassignPage={can("edit", "settings") ? handleUnassignFromMenu : undefined}
                    onChangeNodePage={
                      can("edit", "settings")
                        ? (node) =>
                            setChangeNodePage({
                              code: node.code,
                              name: node.name ?? "",
                              pageId: node.pageId,
                            })
                        : undefined
                    }
                    onManageMenu={
                      can("edit", "settings")
                        ? () => navigate({ to: "/settings/menu-pages" })
                        : undefined
                    }
                  />
                  {/* "Trang" cùng nhóm với "Menu" — mọi trang + badge có-menu. */}
                  <PagesListSection
                    collapsed={collapsed}
                    pathname={pathname}
                    allPages={allPages}
                    navNodes={navNodes}
                    onOpen={(to) => navigate({ to })}
                    onNavigate={collapseOpsSettings}
                    onDeletePage={can("delete", "page") ? handleDeletePage : undefined}
                    onAssignPage={can("edit", "settings") ? setAssignMenuPage : undefined}
                    canSetStatus={can("edit", "page")}
                    open={effectiveSectionsOpen.pagesList}
                    onToggle={toggle("pagesList")}
                  />
                </div>
              );
            }
            return (
              <SidebarSection
                title={t("sidebar.pages")}
                collapsed={collapsed}
                pathname={pathname}
                open={effectiveSectionsOpen.pages}
                onToggle={toggle("pages")}
                onAdd={can("create", "page") ? handleAddPage : undefined}
                onAiAdd={can("create", "page") ? () => setAiCreateTarget("page") : undefined}
                onDelete={can("delete", "page") ? handleDeletePage : undefined}
                onRename={can("edit", "page") ? handleRenamePage : undefined}
                sectionKey="pages"
                onNavigate={collapseOpsSettings}
                items={pageItems}
              />
            );
          })()}
          {!isViewer && (!search.trim() || filterBySearch(userWorkflows).length > 0) && (
            <SidebarSection
              title={t("sidebar.workflows")}
              collapsed={collapsed}
              pathname={pathname}
              open={effectiveSectionsOpen.workflows}
              onToggle={toggle("workflows")}
              onAdd={can("create", "workflow") ? handleAddWorkflow : undefined}
              onAiAdd={can("create", "workflow") ? () => setAiCreateTarget("workflow") : undefined}
              onDelete={can("delete", "workflow") ? handleDeleteWorkflow : undefined}
              onRename={can("edit", "workflow") ? handleRenameWorkflow : undefined}
              onNavigate={collapseOpsSettings}
              extraButtons={
                can("create", "workflow") && !collapsed ? (
                  <button
                    type="button"
                    title="Thư viện workflow mẫu"
                    onClick={() => navigate({ to: "/workflows/gallery" })}
                    className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-hover transition-colors"
                  >
                    <I.Library size={13} />
                  </button>
                ) : undefined
              }
              items={filterBySearch(userWorkflows).map((w) => ({
                id: w.id,
                name: w.name,
                iconName: w.icon,
                to: `/workflows/${w.id}`,
                badge: w.status === "paused" ? "⏸" : undefined,
                userOwned: true,
                isFav: favs.isFav(w.id),
                onFavorite: () =>
                  favs.toggle({
                    id: w.id,
                    to: `/workflows/${w.id}`,
                    label: w.name,
                    iconName: w.icon,
                  }),
              }))}
            />
          )}
          {!isViewer && (!search.trim() || filterBySearch(sortedAgents).length > 0) && (
            <SidebarSection
              title={t("sidebar.agents")}
              collapsed={collapsed}
              pathname={pathname}
              open={effectiveSectionsOpen.agents}
              onToggle={toggle("agents")}
              onAdd={can("create", "agent") ? handleAddAgent : undefined}
              onAiAdd={can("create", "agent") ? () => setAiCreateTarget("agent") : undefined}
              onDelete={can("delete", "agent") ? handleDeleteAgent : undefined}
              onRename={can("edit", "agent") ? handleRenameAgent : undefined}
              onNavigate={collapseOpsSettings}
              extraButtons={
                can("create", "agent") && !collapsed ? (
                  <button
                    type="button"
                    title={t("sidebar.agent_library")}
                    onClick={() => navigate({ to: "/agents/library" })}
                    className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-hover transition-colors"
                  >
                    <I.Library size={13} />
                  </button>
                ) : undefined
              }
              items={filterBySearch(sortedAgents).map((a) => ({
                id: a.id,
                name: a.name,
                iconName: "Bot" as const,
                to: `/agents/${a.id}`,
                badge: a.id === primaryAgentId ? "★★" : myAgentRoles[a.id] ? "★" : undefined,
                userOwned: true,
                isFav: favs.isFav(a.id),
                onFavorite: () =>
                  favs.toggle({ id: a.id, to: `/agents/${a.id}`, label: a.name, iconName: "Bot" }),
              }))}
            />
          )}
        </div>

        <div className="border-t border-border py-1 overflow-y-auto shrink min-h-0">
          <NavGroup
            title={t("sidebar.group_ops")}
            collapsed={collapsed}
            open={sectionsOpen.ops}
            onToggle={toggleExclusive("ops")}
            scrollCap
          >
            {/* /server-data ẩn khỏi Sidebar — truy cập trực tiếp qua URL khi cần */}
            <SidebarItem
              to="/activity"
              active={pathname === "/activity"}
              icon={<I.Activity size={14} />}
              collapsed={collapsed}
              label={t("sidebar.activity")}
              isFavorited={favs.isFav("/activity")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/activity",
                  to: "/activity",
                  label: t("sidebar.activity"),
                  iconName: "Activity",
                })
              }
            />
            <SidebarItem
              to="/approvals"
              active={pathname === "/approvals"}
              icon={<I.CheckSq size={14} />}
              collapsed={collapsed}
              label={t("sidebar.approvals")}
              isFavorited={favs.isFav("/approvals")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/approvals",
                  to: "/approvals",
                  label: t("sidebar.approvals"),
                  iconName: "CheckSq",
                })
              }
            />
            <SidebarItem
              to="/org-chart"
              active={pathname === "/org-chart"}
              icon={<I.GitBranch size={14} />}
              collapsed={collapsed}
              label={t("sidebar.org_chart")}
              isFavorited={favs.isFav("/org-chart")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/org-chart",
                  to: "/org-chart",
                  label: t("sidebar.org_chart"),
                  iconName: "GitBranch",
                })
              }
            />
            <SidebarItem
              to="/knowledge"
              active={pathname === "/knowledge"}
              icon={<I.File size={14} />}
              collapsed={collapsed}
              label={t("sidebar.knowledge")}
              isFavorited={favs.isFav("/knowledge")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/knowledge",
                  to: "/knowledge",
                  label: t("sidebar.knowledge"),
                  iconName: "File",
                })
              }
            />
            <SidebarItem
              to="/documents"
              active={pathname === "/documents"}
              icon={<I.FileText size={14} />}
              collapsed={collapsed}
              label={t("sidebar.documents")}
              isFavorited={favs.isFav("/documents")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/documents",
                  to: "/documents",
                  label: t("sidebar.documents"),
                  iconName: "FileText",
                })
              }
            />
            {/* MES / Sản xuất — port DQHF */}
            <SidebarItem
              to="/ban-ve"
              active={pathname === "/ban-ve"}
              icon={<I.FileText size={14} />}
              collapsed={collapsed}
              label="Xem bản vẽ"
              isFavorited={favs.isFav("/ban-ve")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/ban-ve",
                  to: "/ban-ve",
                  label: "Xem bản vẽ",
                  iconName: "FileText",
                })
              }
            />
            {!isViewer && (
              <SidebarItem
                to="/sanluong"
                active={pathname === "/sanluong"}
                icon={<I.Box size={14} />}
                collapsed={collapsed}
                label="Nhập sản lượng"
                isFavorited={favs.isFav("/sanluong")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/sanluong",
                    to: "/sanluong",
                    label: "Nhập sản lượng",
                    iconName: "Box",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/ketoan/cong-no"
                active={pathname === "/ketoan/cong-no"}
                icon={<I.Receipt size={14} />}
                collapsed={collapsed}
                label="Công nợ NCC"
                isFavorited={favs.isFav("/ketoan/cong-no")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/ketoan/cong-no",
                    to: "/ketoan/cong-no",
                    label: "Công nợ NCC",
                    iconName: "Receipt",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/ketoan/chi-phi"
                active={pathname === "/ketoan/chi-phi"}
                icon={<I.DollarSign size={14} />}
                collapsed={collapsed}
                label="Chi phí kinh doanh"
                isFavorited={favs.isFav("/ketoan/chi-phi")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/ketoan/chi-phi",
                    to: "/ketoan/chi-phi",
                    label: "Chi phí kinh doanh",
                    iconName: "DollarSign",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/ketoan/ket-qua"
                active={pathname === "/ketoan/ket-qua"}
                icon={<I.BarChart size={14} />}
                collapsed={collapsed}
                label="Kết quả kinh doanh"
                isFavorited={favs.isFav("/ketoan/ket-qua")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/ketoan/ket-qua",
                    to: "/ketoan/ket-qua",
                    label: "Kết quả kinh doanh",
                    iconName: "BarChart",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/ketoan/de-nghi-thanh-toan"
                active={pathname === "/ketoan/de-nghi-thanh-toan"}
                icon={<I.FileCheck size={14} />}
                collapsed={collapsed}
                label="Đề nghị thanh toán"
                isFavorited={favs.isFav("/ketoan/de-nghi-thanh-toan")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/ketoan/de-nghi-thanh-toan",
                    to: "/ketoan/de-nghi-thanh-toan",
                    label: "Đề nghị thanh toán",
                    iconName: "FileCheck",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/iot"
                active={pathname.startsWith("/iot")}
                icon={<I.Server size={14} />}
                collapsed={collapsed}
                label={t("sidebar.iot")}
                isFavorited={favs.isFav("/iot")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/iot",
                    to: "/iot",
                    label: t("sidebar.iot"),
                    iconName: "Server",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/procedures"
                active={pathname.startsWith("/procedures")}
                icon={<I.Terminal size={14} />}
                collapsed={collapsed}
                label={t("sidebar.procedures")}
                isFavorited={favs.isFav("/procedures")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/procedures",
                    to: "/procedures",
                    label: t("sidebar.procedures"),
                    iconName: "Terminal",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/enums"
                active={pathname.startsWith("/enums")}
                icon={<I.Tag size={14} />}
                collapsed={collapsed}
                label={t("sidebar.enums")}
                isFavorited={favs.isFav("/enums")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/enums",
                    to: "/enums",
                    label: t("sidebar.enums"),
                    iconName: "Tag",
                  })
                }
              />
            )}
            {!isViewer && (
              <SidebarItem
                to="/tools"
                active={pathname.startsWith("/tools")}
                icon={<I.Wand size={14} />}
                collapsed={collapsed}
                label={t("sidebar.tools")}
                isFavorited={favs.isFav("/tools")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/tools",
                    to: "/tools",
                    label: t("sidebar.tools"),
                    iconName: "Wand",
                  })
                }
              />
            )}
            <SidebarItem
              to="/feedback"
              active={pathname.startsWith("/feedback")}
              icon={<I.HelpCircle size={14} />}
              collapsed={collapsed}
              label={t("sidebar.feedback")}
              isFavorited={favs.isFav("/feedback")}
              onToggleFavorite={() =>
                favs.toggle({
                  id: "/feedback",
                  to: "/feedback",
                  label: t("sidebar.feedback"),
                  iconName: "HelpCircle",
                })
              }
            />
          </NavGroup>
          {!isViewer && (
            <NavGroup
              title={t("sidebar.group_settings")}
              collapsed={collapsed}
              open={sectionsOpen.settings}
              onToggle={toggleExclusive("settings")}
              scrollCap
            >
              <SidebarItem
                to="/settings/agents"
                active={pathname === "/settings/agents"}
                icon={<I.Bot size={14} />}
                collapsed={collapsed}
                label={t("sidebar.my_agents")}
                isFavorited={favs.isFav("/settings/agents")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/agents",
                    to: "/settings/agents",
                    label: t("sidebar.my_agents"),
                    iconName: "Bot",
                  })
                }
              />
              <SidebarItem
                to="/settings/rbac"
                active={pathname === "/settings/rbac"}
                icon={<I.Users size={14} />}
                collapsed={collapsed}
                label={t("sidebar.rbac")}
                isFavorited={favs.isFav("/settings/rbac")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/rbac",
                    to: "/settings/rbac",
                    label: t("sidebar.rbac"),
                    iconName: "Users",
                  })
                }
              />
              <SidebarItem
                to="/settings/companies"
                active={pathname === "/settings/companies"}
                icon={<I.Briefcase size={14} />}
                collapsed={collapsed}
                label={t("sidebar.companies")}
                isFavorited={favs.isFav("/settings/companies")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/companies",
                    to: "/settings/companies",
                    label: t("sidebar.companies"),
                    iconName: "Briefcase",
                  })
                }
              />
              <SidebarItem
                to="/settings/shortcuts"
                active={pathname === "/settings/shortcuts"}
                icon={<I.Command size={14} />}
                collapsed={collapsed}
                label="Phím tắt"
                isFavorited={favs.isFav("/settings/shortcuts")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/shortcuts",
                    to: "/settings/shortcuts",
                    label: "Phím tắt",
                    iconName: "Command",
                  })
                }
              />
              {role === "admin" && (
                <SidebarItem
                  to="/settings/errors"
                  active={pathname === "/settings/errors"}
                  icon={<I.AlertOctagon size={14} />}
                  collapsed={collapsed}
                  label="Giám sát lỗi"
                  isFavorited={favs.isFav("/settings/errors")}
                  onToggleFavorite={() =>
                    favs.toggle({
                      id: "/settings/errors",
                      to: "/settings/errors",
                      label: "Giám sát lỗi",
                      iconName: "AlertOctagon",
                    })
                  }
                />
              )}
              <SidebarItem
                to="/settings/llm"
                active={pathname === "/settings/llm"}
                icon={<I.Sparkles size={14} />}
                collapsed={collapsed}
                label={t("sidebar.llm_profiles")}
                isFavorited={favs.isFav("/settings/llm")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/llm",
                    to: "/settings/llm",
                    label: t("sidebar.llm_profiles"),
                    iconName: "Sparkles",
                  })
                }
              />
              <SidebarItem
                to="/settings/embedding"
                active={pathname === "/settings/embedding"}
                icon={<I.Hash size={14} />}
                collapsed={collapsed}
                label={t("sidebar.embedding")}
                isFavorited={favs.isFav("/settings/embedding")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/embedding",
                    to: "/settings/embedding",
                    label: t("sidebar.embedding"),
                    iconName: "Hash",
                  })
                }
              />
              <SidebarItem
                to="/settings/mcp"
                active={pathname === "/settings/mcp"}
                icon={<I.Server size={14} />}
                collapsed={collapsed}
                label={t("sidebar.mcp_server")}
                isFavorited={favs.isFav("/settings/mcp")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/mcp",
                    to: "/settings/mcp",
                    label: t("sidebar.mcp_server"),
                    iconName: "Server",
                  })
                }
              />
              <SidebarItem
                to="/settings/transfer"
                active={pathname === "/settings/transfer"}
                icon={<I.Save size={14} />}
                collapsed={collapsed}
                label={t("sidebar.transfer")}
                isFavorited={favs.isFav("/settings/transfer")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/transfer",
                    to: "/settings/transfer",
                    label: t("sidebar.transfer"),
                    iconName: "Save",
                  })
                }
              />
              <SidebarItem
                to="/settings/backup"
                active={pathname === "/settings/backup"}
                icon={<I.Save size={14} />}
                collapsed={collapsed}
                label={t("sidebar.backup")}
                isFavorited={favs.isFav("/settings/backup")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/backup",
                    to: "/settings/backup",
                    label: t("sidebar.backup"),
                    iconName: "Save",
                  })
                }
              />
              <SidebarItem
                to="/settings/web-search"
                active={pathname === "/settings/web-search"}
                icon={<I.Search size={14} />}
                collapsed={collapsed}
                label="Tìm kiếm web"
                isFavorited={favs.isFav("/settings/web-search")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/web-search",
                    to: "/settings/web-search",
                    label: "Tìm kiếm web",
                    iconName: "Search",
                  })
                }
              />
              <SidebarItem
                to="/settings/migration"
                active={pathname === "/settings/migration" || pathname === "/settings/cockpit"}
                icon={<I.Database size={14} />}
                collapsed={collapsed}
                label="Migrate DQHF"
                isFavorited={favs.isFav("/settings/migration")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/migration",
                    to: "/settings/migration",
                    label: "Migrate DQHF",
                    iconName: "Database",
                  })
                }
              />
              <SidebarItem
                to="/settings/menu-pages"
                active={pathname === "/settings/menu-pages"}
                icon={<I.GitBranch size={14} />}
                collapsed={collapsed}
                label="Quản lý menu"
                isFavorited={favs.isFav("/settings/menu-pages")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/menu-pages",
                    to: "/settings/menu-pages",
                    label: "Quản lý menu",
                    iconName: "GitBranch",
                  })
                }
              />
              <SidebarItem
                to="/settings/pages-trash"
                active={pathname === "/settings/pages-trash"}
                icon={<I.Trash size={14} />}
                collapsed={collapsed}
                label="Thùng rác trang"
                isFavorited={favs.isFav("/settings/pages-trash")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/pages-trash",
                    to: "/settings/pages-trash",
                    label: "Thùng rác trang",
                    iconName: "Trash",
                  })
                }
              />
              <SidebarItem
                to="/settings/plugins"
                active={pathname === "/settings/plugins"}
                icon={<I.Package size={14} />}
                collapsed={collapsed}
                label={t("sidebar.plugins")}
                isFavorited={favs.isFav("/settings/plugins")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/plugins",
                    to: "/settings/plugins",
                    label: t("sidebar.plugins"),
                    iconName: "Package",
                  })
                }
              />
              <SidebarItem
                to="/settings/tools"
                active={pathname === "/settings/tools"}
                icon={<I.Wand size={14} />}
                collapsed={collapsed}
                label={t("sidebar.tools_mgmt")}
                isFavorited={favs.isFav("/settings/tools")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/tools",
                    to: "/settings/tools",
                    label: t("sidebar.tools_mgmt"),
                    iconName: "Wand",
                  })
                }
              />
              <SidebarItem
                to="/settings/embed"
                active={pathname === "/settings/embed"}
                icon={<I.Link size={14} />}
                collapsed={collapsed}
                label={t("sidebar.embed")}
                isFavorited={favs.isFav("/settings/embed")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/embed",
                    to: "/settings/embed",
                    label: t("sidebar.embed"),
                    iconName: "Link",
                  })
                }
              />
              <SidebarItem
                to="/settings/api-keys"
                active={pathname === "/settings/api-keys"}
                icon={<I.Key size={14} />}
                collapsed={collapsed}
                label={t("sidebar.api_keys")}
                isFavorited={favs.isFav("/settings/api-keys")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/api-keys",
                    to: "/settings/api-keys",
                    label: t("sidebar.api_keys"),
                    iconName: "Key",
                  })
                }
              />
              <SidebarItem
                to="/settings/viewer-groups"
                active={pathname === "/settings/viewer-groups"}
                icon={<I.Users size={14} />}
                collapsed={collapsed}
                label={t("sidebar.viewer_groups")}
                isFavorited={favs.isFav("/settings/viewer-groups")}
                onToggleFavorite={() =>
                  favs.toggle({
                    id: "/settings/viewer-groups",
                    to: "/settings/viewer-groups",
                    label: t("sidebar.viewer_groups"),
                    iconName: "Users",
                  })
                }
              />
            </NavGroup>
          )}
        </div>

        {/* === User info + Đăng xuất === */}
        <div className="shrink-0 border-t border-border px-2 py-2 space-y-1.5">
          {/* Xem Portal (admin) — mở trang chủ người dùng cuối ở TAB MỚI.
             Dùng <a target="_blank"> để mở cửa sổ/tab mới, không rời SPA hiện tại. */}
          {role === "admin" && (
            <a
              href="/portal"
              target="_blank"
              rel="noopener noreferrer"
              title="Xem Portal (mở tab mới)"
              className={cn(
                "flex items-center rounded-md text-muted hover:bg-hover/60 hover:text-text transition-colors",
                collapsed ? "w-full h-9 justify-center" : "gap-2 px-2 py-1.5 text-[13px]",
              )}
            >
              <I.ExternalLink size={collapsed ? 15 : 14} className="shrink-0" />
              {!collapsed && <span className="truncate flex-1">Xem Portal</span>}
            </a>
          )}
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
      <AssignPageToMenuModal
        page={assignMenuPage}
        onClose={() => setAssignMenuPage(null)}
        onDone={() => void invalidateNavTree()}
      />
      <ChangeMenuNodePageModal
        node={changeNodePage}
        onClose={() => setChangeNodePage(null)}
        onDone={() => void invalidateNavTree()}
      />
      <NewPageModal
        open={newPageOpen}
        onClose={() => {
          setNewPageOpen(false);
          void invalidateNavTree(); // trang gán menu mới → refresh cây nav
        }}
        canAssignMenu={can("edit", "settings")}
      />
    </>
  );
}
