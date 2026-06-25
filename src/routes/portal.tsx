import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "@/components/AgentPanel";
import { DialogHost } from "@/components/DialogHost";
import { I } from "@/components/Icons";
import { labelOf, MenuBrowser } from "@/components/MenuBrowser";
import type { NavNode } from "@/components/MenuTree";
import { PortalDashboard } from "@/components/PortalDashboard";
import { ConsumerPage } from "@/components/renderer/ConsumerPage";
import { useFavs } from "@/components/Sidebar";
import { Button } from "@/components/ui";
import { ToastHost } from "@/components/ui/ToastHost";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useNavTree } from "@/hooks/useNavTree";
import { useT } from "@/hooks/useT";
import { idbDeletePrefix } from "@/lib/page-state-idb";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useLocale } from "@/stores/locale";
import { usePreferences } from "@/stores/preferences";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

function stripAccents(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function PortalRoute() {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const agentOpen = useUI((s) => s.agentOpen);
  const setAgentOpen = useUI((s) => s.setAgentOpen);
  const pages = useUserObjects((s) => s.pages);
  const hydrate = useUserObjects((s) => s.hydrate);
  const myGroupIds = useUserObjects((s) => s.myGroupIds);
  const myPageIds = useUserObjects((s) => s.myPageIds);
  const favs = useFavs();
  const canEdit = user?.role === "admin" || user?.role === "editor";
  const lang = useLocale((s) => s.lang);
  const setLang = useLocale((s) => s.setLang);
  const nextLang = useCallback(() => {
    const LANGS = ["vi", "en"] as const;
    const idx = LANGS.indexOf(lang as (typeof LANGS)[number]);
    setLang(LANGS[(idx + 1) % LANGS.length] ?? "vi");
  }, [lang, setLang]);

  const publishedPages = useMemo(
    () =>
      pages.filter(
        (p) =>
          p.isPublished &&
          // Admin/editor thấy tất cả trang published bất kể viewerGroupIds —
          // portal vừa là cổng viewer vừa là xem trước cho người dựng trang.
          (canEdit ||
            // Quyền cá nhân ưu tiên nhóm: user được cấp trực tiếp luôn thấy.
            myPageIds.includes(p.id) ||
            !p.viewerGroupIds?.length ||
            p.viewerGroupIds.some((gid) => myGroupIds.includes(gid))),
      ),
    [pages, myGroupIds, myPageIds, canEdit],
  );

  const { data: navNodes = [] } = useNavTree();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [focusCategory, setFocusCategory] = useState<string | null>(null);
  const [drawerQ, setDrawerQ] = useState("");
  const drawerSearchRef = useRef<HTMLInputElement>(null);
  const filteredNavNodes = useMemo(() => {
    if (!drawerQ) return navNodes;
    const q = stripAccents(drawerQ);
    return navNodes.filter((n) => n.name && stripAccents(n.name).includes(q));
  }, [navNodes, drawerQ]);
  const { prefs, loaded: prefsLoaded, save: savePrefs, load: loadPrefs } = usePreferences();

  const [activeId, setActiveIdRaw] = useState<string | null>(null);
  const [mountedIds, setMountedIds] = useState<Set<string>>(new Set());
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Tự động mở sidebar khi về dashboard (không có activeId)
  useEffect(() => {
    if (!activeId) setSidebarCollapsed(false);
  }, [activeId]);

  const isMobile = useIsMobile();

  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  const { page: urlPage } = Route.useSearch();

  const initDone = useRef(false);
  useEffect(() => {
    if (!prefsLoaded || initDone.current) return;
    initDone.current = true;
    const initial = urlPage && publishedPages.some((p) => p.id === urlPage) ? urlPage : null;
    if (initial) {
      // Đồng bộ URL về đúng trang được chọn (dù đến từ ?page=, lastPageId,
      // hay trang đầu). Nhờ đây reload luôn khôi phục đúng trang cuối xem.
      if (typeof window !== "undefined") {
        const u = new URL(window.location.href);
        u.searchParams.set("page", initial);
        window.history.replaceState(null, "", u.pathname + u.search);
      }
      setActiveIdRaw(initial);
      setMountedIds(new Set([initial]));
    }
  }, [prefsLoaded, publishedPages, urlPage]);

  const setActiveId = useCallback(
    (id: string) => {
      setActiveIdRaw(id);
      setMountedIds((prev) => new Set([...prev, id]));
      const recent = prefs.portal?.recentPages ?? [];
      const nextRecent = [id, ...recent.filter((r) => r !== id)].slice(0, 12);
      savePrefs({ portal: { ...prefs.portal, lastPageId: id, recentPages: nextRecent } });
      // Cập nhật ?page= trong URL → reload luôn trả về trang đang xem.
      if (typeof window !== "undefined") {
        const u = new URL(window.location.href);
        u.searchParams.set("page", id);
        window.history.replaceState(null, "", u.pathname + u.search);
      }
    },
    [savePrefs, prefs],
  );

  const goToDashboard = useCallback(() => {
    setActiveIdRaw(null);
    void navigate({ to: "/portal", search: { page: undefined }, replace: true });
  }, [navigate]);

  // Sync URL → activeId (browser back/forward)
  // Dùng setActiveIdRaw + setMountedIds thay setActiveId để tránh
  // vòng lặp (setActiveId gọi savePrefs → prefs thay đổi → callback mới → effect chạy lại)
  // biome-ignore lint/correctness/useExhaustiveDependencies: cố ý KHÔNG đưa prefs/savePrefs vào deps — savePrefs đổi prefs sẽ gây vòng lặp; chỉ chạy theo urlPage/publishedPages.
  useEffect(() => {
    if (!initDone.current) return;
    if (urlPage && publishedPages.some((p) => p.id === urlPage)) {
      setActiveIdRaw(urlPage);
      setMountedIds((prev) => new Set([...prev, urlPage]));
      // Back/forward cũng cập nhật "truy cập gần đây" (setActiveId không chạy ở đây).
      const recent = prefs.portal?.recentPages ?? [];
      const nextRecent = [urlPage, ...recent.filter((r) => r !== urlPage)].slice(0, 12);
      savePrefs({ portal: { ...prefs.portal, lastPageId: urlPage, recentPages: nextRecent } });
    } else {
      setActiveIdRaw(null);
    }
  }, [urlPage, publishedPages]);

  const onSelectPage = useCallback(
    (id: string) => {
      if (id.startsWith("/")) {
        void navigate({ to: id });
        return;
      }
      setActiveId(id);
      void navigate({ to: "/portal", search: { page: id }, replace: true });
    },
    [setActiveId, navigate],
  );

  const handleRefresh = useCallback(async () => {
    if (!activeId) return;
    setRefreshing(true);
    await hydrate();
    await idbDeletePrefix(`${activeId}:`);
    await idbDeletePrefix(`pageState:${activeId}`);
    setRefreshKeys((prev) => ({ ...prev, [activeId]: (prev[activeId] ?? 0) + 1 }));
    setRefreshing(false);
  }, [hydrate, activeId]);

  const pageBreadcrumb = useMemo(() => {
    const byCode = new Map(navNodes.map((n) => [n.code, n]));
    const labelOf = (n: NavNode) => {
      const nm = n.name ?? "";
      const suffix = ` - ${n.code}`;
      return nm.endsWith(suffix) ? nm.slice(0, -suffix.length) : nm;
    };
    const m = new Map<string, { code: string; label: string }[]>();
    for (const n of navNodes) {
      if (!n.pageId) continue;
      const parts: { code: string; label: string }[] = [];
      let cur: NavNode | undefined = n;
      let guard = 0;
      while (cur && guard++ < 20) {
        parts.unshift({ code: cur.code, label: labelOf(cur) });
        cur = cur.parentCode ? byCode.get(cur.parentCode) : undefined;
      }
      m.set(n.pageId, parts);
    }
    return m;
  }, [navNodes]);

  const navChildrenOf = useMemo(() => {
    const m = new Map<string, NavNode[]>();
    for (const n of navNodes) {
      const k = n.parentCode ?? "__root";
      const arr = m.get(k) ?? [];
      arr.push(n);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort - b.sort);
    return m;
  }, [navNodes]);
  const navRoots = useMemo(() => {
    const codes = new Set(navNodes.map((n) => n.code));
    return navNodes
      .filter((n) => !n.parentCode || !codes.has(n.parentCode))
      .sort((a, b) => a.sort - b.sort);
  }, [navNodes]);

  const activeBreadcrumb = useMemo(
    () => (activeId ? (pageBreadcrumb.get(activeId) ?? null) : null),
    [activeId, pageBreadcrumb],
  );

  const breadcrumbRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to end on path change
  useEffect(() => {
    const el = breadcrumbRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
    return () => cancelAnimationFrame(id);
  }, [activeBreadcrumb]);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!userMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [userMenuOpen]);

  const pageListForDashboard = useMemo(
    () =>
      publishedPages.map((p) => ({ id: p.id, name: p.name, icon: p.icon, techName: p.techName })),
    [publishedPages],
  );

  return (
    <div className="h-screen flex flex-col bg-bg text-text">
      {/* ─── Header ─── */}
      <header className="h-12 shrink-0 flex items-center px-3 sm:px-4 gap-1 sm:gap-2 border-b border-border bg-panel z-30 relative">
        <button
          type="button"
          onClick={() => setSidebarCollapsed((s) => !s)}
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center transition-colors text-muted hover:text-text hover:bg-hover/80 shrink-0",
            !sidebarCollapsed && "bg-hover/80 text-text",
          )}
          title={sidebarCollapsed ? "Mở rộng menu" : "Thu gọn menu"}
        >
          <I.Menu size={16} />
        </button>

        <div
          ref={breadcrumbRef}
          className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto whitespace-nowrap text-sm"
        >
          <button
            type="button"
            onClick={goToDashboard}
            className={cn(
              "shrink-0 transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-hover/40",
              activeId ? "text-muted hover:text-text" : "font-semibold text-accent bg-accent/10",
            )}
          >
            <I.Home size={14} className="shrink-0" />
            <span>Trang chủ</span>
          </button>
          {activeBreadcrumb && activeBreadcrumb.length > 0 && (
            <>
              <I.ChevronRight size={11} className="shrink-0 text-muted/40" />
              {activeBreadcrumb.map((item, i) => {
                const isLast = i === activeBreadcrumb.length - 1;
                return (
                  <span key={item.code} className="flex items-center gap-1 shrink-0">
                    {i > 0 && <I.ChevronRight size={11} className="shrink-0 text-muted/40" />}
                    {isLast ? (
                      <span className="font-semibold text-text whitespace-nowrap">
                        {item.label}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          goToDashboard();
                          setFocusCategory(item.code);
                        }}
                        className="text-muted hover:text-text transition-colors whitespace-nowrap"
                      >
                        {item.label}
                      </button>
                    )}
                  </span>
                );
              })}
            </>
          )}
        </div>

        <div id="portal-page-actions" className="flex items-center gap-1.5 shrink-0" />

        {activeId && (
          <Button
            variant="ghost"
            size="sm"
            icon={
              <I.Star
                size={13}
                className={favs.isFav(activeId) ? "fill-warning text-warning" : ""}
              />
            }
            onClick={() =>
              favs.toggle({
                id: activeId,
                to: `/pages/${activeId}`,
                label: publishedPages.find((p) => p.id === activeId)?.name ?? activeId,
                iconName: "Layout",
              })
            }
            title={favs.isFav(activeId) ? "Bỏ yêu thích" : "Thêm vào yêu thích"}
          />
        )}

        {canEdit && activeId && (
          <Button
            variant="ghost"
            size="sm"
            icon={<I.Edit size={13} />}
            onClick={() =>
              activeId && void navigate({ to: "/pages/$id", params: { id: activeId } })
            }
            title="Sửa trang này trong Trình dựng"
          >
            <span className="hidden sm:inline">Sửa</span>
          </Button>
        )}

        <Button
          variant={agentOpen ? "primary" : "ghost"}
          size="sm"
          icon={<I.Sparkles size={14} />}
          onClick={() => setAgentOpen(!agentOpen)}
          title="Hỏi AI"
        />

        <div ref={userMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setUserMenuOpen((s) => !s)}
            className="w-8 h-8 rounded-full bg-accent/15 text-accent flex items-center justify-center text-sm font-medium hover:bg-accent/25 transition-colors"
            title={user?.name ?? user?.email ?? ""}
          >
            {(user?.name ?? user?.email ?? "?").charAt(0).toUpperCase()}
          </button>
          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-panel border border-border rounded-lg shadow-xl z-50 py-1 text-sm">
              <div className="px-3 py-2 border-b border-border">
                <div className="font-medium text-text truncate">{user?.name ?? ""}</div>
                <div className="text-xs text-muted truncate">{user?.email ?? ""}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTheme(theme === "dark" ? "light" : "dark");
                  setUserMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-text hover:bg-hover/60 transition-colors"
              >
                {theme === "dark" ? <I.Sun size={13} /> : <I.Moon size={13} />}
                {theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
              </button>
              <button
                type="button"
                onClick={() => {
                  nextLang();
                  setUserMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-text hover:bg-hover/60 transition-colors"
              >
                <I.Globe size={13} />
                {lang.toUpperCase()}
              </button>
              <hr className="border-border my-1" />
              <button
                type="button"
                onClick={() => {
                  void navigate({ to: "/ban-ve" });
                  setUserMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-text hover:bg-hover/60 transition-colors"
              >
                <I.FileText size={13} />
                Bản vẽ
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigate({ to: "/sanluong" });
                  setUserMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-text hover:bg-hover/60 transition-colors"
              >
                <I.Box size={13} />
                Sản lượng
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleRefresh();
                  setUserMenuOpen(false);
                }}
                disabled={refreshing}
                className="w-full flex items-center gap-2 px-3 py-2 text-text hover:bg-hover/60 transition-colors disabled:opacity-40"
              >
                <I.RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
                Làm mới
              </button>
              <hr className="border-border my-1" />
              <button
                type="button"
                onClick={() => {
                  logout();
                  setUserMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-danger hover:bg-danger/10 transition-colors"
              >
                <I.LogOut size={13} />
                Đăng xuất
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ─── Body ─── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ─── Persistent sidebar ─── */}
        <aside
          className="shrink-0 border-r border-border bg-panel flex flex-col overflow-hidden"
          style={{ width: sidebarCollapsed ? 0 : 420, transition: "width 180ms ease" }}
        >
          <div className="shrink-0 flex items-center gap-1 px-2 h-9 border-b border-border">
            <I.Search size={12} className="shrink-0 text-muted/50" />
            <input
              ref={drawerSearchRef}
              type="text"
              value={drawerQ}
              onChange={(e) => setDrawerQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDrawerQ("");
                  drawerSearchRef.current?.blur();
                }
              }}
              placeholder="Tìm kiếm..."
              className="flex-1 bg-transparent outline-none text-xs text-text placeholder:text-muted/40"
            />
            {drawerQ && (
              <button
                type="button"
                onClick={() => {
                  setDrawerQ("");
                  drawerSearchRef.current?.focus();
                }}
                className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-muted/50 hover:text-text hover:bg-hover/60"
              >
                <I.X size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-muted/40 hover:text-text hover:bg-hover/60"
              title="Thu gọn menu"
            >
              <I.PanelLeft size={12} />
            </button>
          </div>
          <div
            className={cn(
              "flex-1 min-h-0 flex flex-col",
              drawerQ ? "overflow-y-auto" : "overflow-hidden",
            )}
          >
            {drawerQ ? (
              <div className="p-2 space-y-1">
                {filteredNavNodes
                  .filter((n) => n.pageId)
                  .map((node) => {
                    const faved = favs.isFav(node.pageId as string);
                    return (
                      <div
                        key={node.code}
                        className="group flex items-center text-sm hover:bg-hover/40 rounded transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectPage(node.pageId as string)}
                          className="flex-1 flex items-center gap-2 px-3 py-2 text-left min-w-0"
                        >
                          <I.Layout size={13} className="shrink-0 text-muted" />
                          <span className="truncate text-text font-medium">{labelOf(node)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            favs.toggle({
                              id: node.pageId as string,
                              to: `/pages/${node.pageId}`,
                              label: node.name ?? "",
                              iconName: "Layout",
                            });
                          }}
                          className={cn(
                            "px-3 py-2 shrink-0 transition-colors opacity-0 group-hover:opacity-100",
                            faved ? "opacity-100 text-warning" : "text-muted/40 hover:text-warning",
                          )}
                          title={faved ? "Bỏ yêu thích" : "Thêm vào yêu thích"}
                        >
                          <I.Star size={13} className={faved ? "fill-current" : ""} />
                        </button>
                      </div>
                    );
                  })}
                {filteredNavNodes.filter((n) => n.pageId).length === 0 && (
                  <div className="text-xs text-muted text-center py-4">
                    Không tìm thấy trang nào
                  </div>
                )}
              </div>
            ) : (
              <MenuBrowser
                roots={navRoots}
                childrenOf={navChildrenOf}
                activePageId={activeId}
                onSelectPage={onSelectPage}
                focusCategory={focusCategory}
                onFocusCategoryUsed={() => setFocusCategory(null)}
                isFav={(id) => favs.isFav(id)}
                onToggleFav={(item) => favs.toggle(item)}
              />
            )}
          </div>
        </aside>

        <main
          className="flex-1 overflow-hidden relative"
          style={{
            marginRight: !isMobile && agentOpen ? 400 : 0,
            transition: "margin 200ms ease",
          }}
        >
          {publishedPages.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-muted text-sm">
              {t("portal.empty_hint")}
            </div>
          ) : (
            <>
              {/* Dashboard luôn mount để giữ state MenuBrowser (selectedRoot/drillPath)
                  khi user navigate đi rồi quay lại — chỉ ẩn khi đang xem trang. */}
              <div
                className={cn("absolute inset-0 overflow-hidden", activeId ? "hidden" : "block")}
              >
                <PortalDashboard
                  userName={user?.name ?? user?.email ?? ""}
                  pages={pageListForDashboard}
                  favs={{ ids: new Set(favs.favs.map((f) => f.id)), isFav: favs.isFav }}
                  onSelectPage={onSelectPage}
                />
              </div>
              {publishedPages.map((p) =>
                mountedIds.has(p.id) ? (
                  <div
                    key={p.id}
                    className={cn(
                      "absolute inset-0 overflow-hidden",
                      p.id === activeId ? "block" : "hidden",
                    )}
                  >
                    <ConsumerPage
                      key={`${p.id}-${refreshKeys[p.id] ?? 0}`}
                      pageId={p.id}
                      chromeless
                      active={p.id === activeId}
                    />
                  </div>
                ) : null,
              )}
            </>
          )}
        </main>
      </div>

      <AgentPanel />
      <DialogHost />
      <ToastHost />
    </div>
  );
}

export const Route = createFileRoute("/portal")({
  validateSearch: (search: Record<string, unknown>) => ({
    page: typeof search.page === "string" ? search.page : undefined,
  }),
  component: PortalRoute,
});
