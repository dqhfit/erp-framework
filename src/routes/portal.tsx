/* ==========================================================
   portal.tsx — Giao diện dành cho người dùng không code (Viewer).
   - Hiển thị danh sách trang đã xuất bản (nav trái).
   - Mỗi trang mount 1 lần rồi ẩn bằng CSS (giống WinForms tab) —
     React state bên trong không bị reset khi chuyển tab.
   - Trạng thái sort/filter DataGrid lưu vào IndexedDB →
     tồn tại qua reload.
   - Trang cuối cùng đang xem lưu lên DB qua preferences store →
     khôi phục khi mở lại hệ thống.
   Auto-redirect từ AppShell khi role === "viewer".
   ========================================================== */

import { createLegacyMenuClient } from "@erp-framework/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentPanel } from "@/components/AgentPanel";
import { DialogHost } from "@/components/DialogHost";
import { I } from "@/components/Icons";
import { LanguagePicker } from "@/components/LanguagePicker";
import { MenuTree, type MenuTreeHandle, type NavNode } from "@/components/MenuTree";
import { NotificationBell } from "@/components/NotificationBell";
import { ConsumerPage } from "@/components/renderer/ConsumerPage";
import { useFavs } from "@/components/Sidebar";
import { Button } from "@/components/ui";
import { ToastHost } from "@/components/ui/ToastHost";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useT } from "@/hooks/useT";
import { idbDeletePrefix } from "@/lib/page-state-idb";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { usePreferences } from "@/stores/preferences";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

function PortalRoute() {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  // Theme (sáng/tối) + panel Hỏi AI — dùng chung store UI với app chính.
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const agentOpen = useUI((s) => s.agentOpen);
  const setAgentOpen = useUI((s) => s.setAgentOpen);
  const pages = useUserObjects((s) => s.pages);
  const hydrate = useUserObjects((s) => s.hydrate);
  const myGroupIds = useUserObjects((s) => s.myGroupIds);
  // Yêu thích (dùng chung sidebar, sync localStorage + server qua preferences).
  const favs = useFavs();

  const publishedPages = useMemo(
    () =>
      pages.filter(
        (p) =>
          p.isPublished &&
          (!p.viewerGroupIds?.length || p.viewerGroupIds.some((gid) => myGroupIds.includes(gid))),
      ),
    [pages, myGroupIds],
  );

  // Cây điều hướng theo MENU DQHF (legacy_menu_map) — node + pageId trang
  // published. Rỗng (chưa link/publish) → fallback danh sách phẳng.
  const [navNodes, setNavNodes] = useState<NavNode[]>([]);
  useEffect(() => {
    let alive = true;
    createLegacyMenuClient("")
      .navTree()
      .then((rows) => {
        if (alive) setNavNodes(rows);
      })
      .catch(() => undefined); // fail-safe: thiếu menu → dùng danh sách phẳng
    return () => {
      alive = false;
    };
  }, []);

  const { prefs, loaded: prefsLoaded, save: savePrefs, load: loadPrefs } = usePreferences();

  // activeId = tab đang chọn; null khi chưa init
  const [activeId, setActiveIdRaw] = useState<string | null>(null);
  // mountedIds = tập page đã từng được kích hoạt (lazy mount)
  const [mountedIds, setMountedIds] = useState<Set<string>>(new Set());
  // refreshKeys[pageId] — tăng lên để remount ConsumerPage khi refresh
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Tìm kiếm trang trong nav "Trang" — toggle icon → input inline.
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Ref điều khiển mở rộng / thu gọn TẤT CẢ nhánh cây menu (portal).
  const menuTreeRef = useRef<MenuTreeHandle>(null);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  const closeSearch = () => {
    setSearchOpen(false);
    setSearch("");
  };

  // Mobile: nav trái thành drawer off-canvas (mở bằng nút ☰ ở header).
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    if (!isMobile || !navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMobile, navOpen]);

  // Load preferences 1 lần khi component mount
  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  // Init activeId từ preferences (hoặc trang đầu tiên) — chạy 1 lần sau khi prefs loaded
  const initDone = useRef(false);
  useEffect(() => {
    if (!prefsLoaded || initDone.current) return;
    initDone.current = true;
    const lastId = prefs.portal?.lastPageId;
    const initial =
      publishedPages.find((p) => p.id === lastId)?.id ?? publishedPages[0]?.id ?? null;
    if (initial) {
      setActiveIdRaw(initial);
      setMountedIds(new Set([initial]));
    }
  }, [prefsLoaded, prefs, publishedPages]);

  const setActiveId = useCallback(
    (id: string) => {
      setActiveIdRaw(id);
      setMountedIds((prev) => new Set([...prev, id]));
      savePrefs({ portal: { ...prefs.portal, lastPageId: id } });
    },
    [savePrefs, prefs],
  );

  // Chọn trang: đổi tab + đóng drawer trên mobile.
  const onSelectPage = useCallback(
    (id: string) => {
      setActiveId(id);
      if (isMobile) setNavOpen(false);
    },
    [setActiveId, isMobile],
  );

  const handleRefresh = useCallback(async () => {
    if (!activeId) return;
    setRefreshing(true);
    await hydrate();
    await idbDeletePrefix(`${activeId}:`);
    setRefreshKeys((prev) => ({ ...prev, [activeId]: (prev[activeId] ?? 0) + 1 }));
    setRefreshing(false);
  }, [hydrate, activeId]);

  // Có query → lọc danh sách trang theo tên (hiện phẳng thay cây menu).
  const q = search.trim().toLowerCase();
  const searchResults = q ? publishedPages.filter((p) => p.name.toLowerCase().includes(q)) : [];
  // Đang hiển thị cây menu (không tìm kiếm + có node link trang) → hiện nút mở/thu gọn tất cả.
  const treeMode = !q && navNodes.some((n) => n.pageId);

  // Map pageId → "đường dẫn" menu (nhãn các cấp cha › lá) — tooltip cho kết quả
  // tìm kiếm + danh sách phẳng (giống tooltip trong cây menu).
  const pagePathMap = useMemo(() => {
    const byCode = new Map(navNodes.map((n) => [n.code, n]));
    const labelOf = (n: NavNode) => {
      const nm = n.name ?? "";
      const suffix = ` - ${n.code}`;
      return nm.endsWith(suffix) ? nm.slice(0, -suffix.length) : nm;
    };
    const m = new Map<string, string>();
    for (const n of navNodes) {
      if (!n.pageId) continue;
      const parts: string[] = [];
      let cur: NavNode | undefined = n;
      let guard = 0;
      while (cur && guard++ < 20) {
        parts.unshift(labelOf(cur));
        cur = cur.parentCode ? byCode.get(cur.parentCode) : undefined;
      }
      m.set(n.pageId, parts.join(" › "));
    }
    return m;
  }, [navNodes]);

  return (
    <div className="h-screen flex flex-col bg-bg text-text">
      {/* Header */}
      <header className="h-11 shrink-0 flex items-center px-3 sm:px-4 gap-2 sm:gap-3 border-b border-border bg-panel">
        {isMobile && (
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label={t("portal.pages_heading")}
            className="-ml-1 w-8 h-8 rounded flex items-center justify-center text-muted hover:text-text hover:bg-hover/60 shrink-0"
          >
            <I.Menu size={18} />
          </button>
        )}
        <span className="w-6 h-6 rounded bg-accent/20 text-accent flex items-center justify-center shrink-0">
          <I.Layout size={13} />
        </span>
        {/* Breadcrumb — đường dẫn trang đang xem (fallback: tên portal khi chưa chọn). */}
        <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto whitespace-nowrap text-sm">
          {(() => {
            const path = activeId
              ? (pagePathMap.get(activeId) ?? publishedPages.find((p) => p.id === activeId)?.name)
              : undefined;
            if (!path) return <span className="font-semibold truncate">{t("portal.title")}</span>;
            const parts = path.split(" › ");
            return parts.map((part, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumb tĩnh, không reorder
              <span key={i} className="flex items-center gap-1 shrink-0">
                {i > 0 && <I.ChevronRight size={11} className="shrink-0 text-muted/40" />}
                <span className={i === parts.length - 1 ? "font-semibold text-text" : "text-muted"}>
                  {part}
                </span>
              </span>
            ));
          })()}
        </div>
        {/* Trang xưởng — lối vào cho công nhân (viewer) xem bản vẽ + nhập sản lượng. */}
        <Button
          variant="ghost"
          size="sm"
          icon={<I.FileText size={13} />}
          onClick={() => void navigate({ to: "/banve" })}
          title="Xem bản vẽ"
        >
          <span className="hidden sm:inline">Bản vẽ</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<I.Box size={13} />}
          onClick={() => void navigate({ to: "/sanluong" })}
          title="Nhập sản lượng"
        >
          <span className="hidden sm:inline">Sản lượng</span>
        </Button>

        {/* Hỏi AI — mở panel trợ lý (AgentPanel mount cuối trang). */}
        <Button
          variant={agentOpen ? "primary" : "ghost"}
          size="sm"
          icon={<I.Sparkles size={13} />}
          onClick={() => setAgentOpen(!agentOpen)}
          title="Hỏi AI"
        >
          <span className="hidden sm:inline">Hỏi AI</span>
        </Button>
        {/* Thông báo in-app */}
        <NotificationBell />
        {/* Chuyển sáng/tối */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          icon={theme === "dark" ? <I.Sun size={13} /> : <I.Moon size={13} />}
          title={t("topbar.toggle_theme")}
        />
        {/* Ngôn ngữ */}
        <LanguagePicker />

        <span className="text-sm text-muted truncate hidden md:block">
          {user?.name ?? user?.email}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={<I.RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />}
          disabled={refreshing}
          onClick={() => void handleRefresh()}
        >
          <span className="hidden sm:inline">{t("portal.refresh")}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<I.LogOut size={13} />}
          onClick={() => void logout()}
        >
          <span className="hidden sm:inline">{t("portal.logout")}</span>
        </Button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Backdrop drawer trên mobile — chạm ngoài để đóng */}
        {isMobile && navOpen && (
          <button
            type="button"
            aria-label={t("common.close")}
            className="fixed inset-0 z-[690] bg-black/40"
            onClick={() => setNavOpen(false)}
          />
        )}
        {/* Nav trái — danh sách trang (mobile: drawer off-canvas) */}
        <nav
          className={cn(
            "border-r border-border bg-panel flex flex-col overflow-y-auto",
            isMobile
              ? cn(
                  "fixed inset-y-0 left-0 z-[695] w-[260px] max-w-[85vw] shadow-2xl transition-transform duration-200",
                  navOpen ? "translate-x-0" : "-translate-x-full",
                )
              : "w-52 shrink-0",
          )}
        >
          <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
            {searchOpen ? (
              <>
                <I.Search size={13} className="shrink-0 text-muted" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") closeSearch();
                  }}
                  placeholder={t("sidebar.search")}
                  className="flex-1 bg-transparent outline-none text-xs text-text placeholder:text-muted/50 min-w-0"
                />
                <button
                  type="button"
                  onClick={closeSearch}
                  title={t("common.close")}
                  className="shrink-0 w-5 h-5 rounded-sm flex items-center justify-center text-muted hover:text-text hover:bg-hover/60 transition-colors"
                >
                  <I.X size={12} />
                </button>
              </>
            ) : (
              <>
                <div className="flex-1 text-[10px] uppercase tracking-wider text-muted font-semibold">
                  {t("portal.pages_heading")}
                </div>
                {treeMode && (
                  <>
                    <button
                      type="button"
                      onClick={() => menuTreeRef.current?.expandAll()}
                      title="Mở rộng tất cả"
                      className="shrink-0 w-5 h-5 rounded-sm flex items-center justify-center text-muted/60 hover:text-text hover:bg-hover/60 transition-colors"
                    >
                      <I.ChevronDown size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => menuTreeRef.current?.collapseAll()}
                      title="Thu gọn tất cả"
                      className="shrink-0 w-5 h-5 rounded-sm flex items-center justify-center text-muted/60 hover:text-text hover:bg-hover/60 transition-colors"
                    >
                      <I.ChevronUp size={13} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  title={t("sidebar.search")}
                  className="shrink-0 w-5 h-5 rounded-sm flex items-center justify-center text-muted/60 hover:text-text hover:bg-hover/60 transition-colors"
                >
                  <I.Search size={13} />
                </button>
              </>
            )}
          </div>

          {/* Yêu thích — trang đã đánh dấu sao (chỉ trang published, ẩn khi tìm kiếm). */}
          {!q &&
            (() => {
              const favPages = favs.favs.filter((f) => publishedPages.some((p) => p.id === f.id));
              if (favPages.length === 0) return null;
              return (
                <div className="border-b border-border">
                  <div className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-muted/60 font-semibold flex items-center gap-1">
                    <I.Star size={10} className="text-warning" /> Yêu thích
                  </div>
                  <ul className="pb-1">
                    {favPages.map((f) => {
                      const active = f.id === activeId;
                      return (
                        <li key={f.id} className="group/fav relative">
                          <button
                            type="button"
                            onClick={() => onSelectPage(f.id)}
                            className={cn(
                              "w-full text-left pl-3 pr-8 py-1.5 text-sm flex items-center gap-2 transition-colors",
                              active
                                ? "bg-accent/10 text-accent font-medium"
                                : "text-text hover:bg-hover/40",
                            )}
                          >
                            <I.Star size={12} className="shrink-0 text-warning" />
                            <span className="truncate">{f.label}</span>
                          </button>
                          <button
                            type="button"
                            title="Bỏ yêu thích"
                            onClick={(e) => {
                              e.stopPropagation();
                              favs.remove(f.id);
                            }}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center text-muted opacity-0 group-hover/fav:opacity-100 hover:bg-hover/60"
                          >
                            <I.X size={11} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}

          {publishedPages.length === 0 ? (
            <div className="p-4 text-xs text-muted text-center leading-relaxed">
              {t("portal.no_pages")}
            </div>
          ) : q ? (
            // Kết quả tìm kiếm — danh sách phẳng đã lọc theo tên.
            searchResults.length === 0 ? (
              <div className="p-4 text-xs text-muted text-center">Không tìm thấy trang</div>
            ) : (
              <ul className="py-1">
                {searchResults.map((p) => {
                  const active = p.id === activeId;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        title={pagePathMap.get(p.id) ?? p.name}
                        onClick={() => onSelectPage(p.id)}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors",
                          active
                            ? "bg-accent/10 text-accent font-medium"
                            : "text-text hover:bg-hover/40",
                        )}
                      >
                        <I.Layout size={13} className="shrink-0 text-muted" />
                        <span className="truncate">{p.name}</span>
                        {p.publishMode === "public" && (
                          <I.Globe size={10} className="ml-auto shrink-0 text-muted" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : navNodes.some((n) => n.pageId) ? (
            // Điều hướng THEO MENU DQHF (cây) khi có node link trang published.
            // Portal: mở hết cây lần đầu + NHỚ trạng thái mở/thu gọn qua reload.
            <MenuTree
              ref={menuTreeRef}
              nodes={navNodes}
              activePageId={activeId}
              onSelect={onSelectPage}
              expandAll
              storageKey="portal"
              cleanLabels
              compact
              isolatable
              isFav={(id) => favs.isFav(id)}
              onToggleFav={(node) => {
                if (!node.pageId) return;
                favs.toggle({
                  id: node.pageId,
                  to: `/pages/${node.pageId}`,
                  label: publishedPages.find((p) => p.id === node.pageId)?.name ?? node.name ?? "",
                  iconName: "Layout",
                });
              }}
            />
          ) : (
            // Fallback: danh sách phẳng (chưa link menu / chưa publish).
            <ul className="py-1">
              {publishedPages.map((p) => {
                const active = p.id === activeId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      title={pagePathMap.get(p.id) ?? p.name}
                      onClick={() => onSelectPage(p.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors",
                        active
                          ? "bg-accent/10 text-accent font-medium"
                          : "text-text hover:bg-hover/40",
                      )}
                    >
                      <I.Layout size={13} className="shrink-0 text-muted" />
                      <span className="truncate">{p.name}</span>
                      {p.publishMode === "public" && (
                        <I.Globe size={10} className="ml-auto shrink-0 text-muted" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* Vùng nội dung — tất cả trang được mount lazy, ẩn/hiện bằng CSS.
            Dịch trái khi panel Hỏi AI mở (desktop) để không bị che. */}
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
          ) : !activeId ? (
            <div className="absolute inset-0 flex items-center justify-center text-muted text-sm">
              {t("portal.select_page")}
            </div>
          ) : (
            publishedPages.map((p) =>
              mountedIds.has(p.id) ? (
                <div
                  key={p.id}
                  className={cn(
                    "absolute inset-0 overflow-hidden",
                    p.id === activeId ? "block" : "hidden",
                  )}
                >
                  <ConsumerPage key={`${p.id}-${refreshKeys[p.id] ?? 0}`} pageId={p.id} />
                </div>
              ) : null,
            )
          )}
        </main>
      </div>

      {/* Panel trợ lý AI — fixed bên phải; portal render full-screen (không có
          AppShell) nên phải tự mount ở đây + host dialog/toast cho AgentPanel. */}
      <AgentPanel />
      <DialogHost />
      <ToastHost />
    </div>
  );
}

export const Route = createFileRoute("/portal")({ component: PortalRoute });
