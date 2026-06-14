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
import { I } from "@/components/Icons";
import { MenuTree, type NavNode } from "@/components/MenuTree";
import { ConsumerPage } from "@/components/renderer/ConsumerPage";
import { Button } from "@/components/ui";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useT } from "@/hooks/useT";
import { idbDeletePrefix } from "@/lib/page-state-idb";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { usePreferences } from "@/stores/preferences";
import { useUserObjects } from "@/stores/userObjects";

function PortalRoute() {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const pages = useUserObjects((s) => s.pages);
  const hydrate = useUserObjects((s) => s.hydrate);
  const myGroupIds = useUserObjects((s) => s.myGroupIds);

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

  const activePage = publishedPages.find((p) => p.id === activeId);

  // Có query → lọc danh sách trang theo tên (hiện phẳng thay cây menu).
  const q = search.trim().toLowerCase();
  const searchResults = q ? publishedPages.filter((p) => p.name.toLowerCase().includes(q)) : [];

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
        <span className="font-semibold text-sm truncate">{t("portal.title")}</span>
        <div className="flex-1" />
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
            <MenuTree nodes={navNodes} activePageId={activeId} onSelect={onSelectPage} />
          ) : (
            // Fallback: danh sách phẳng (chưa link menu / chưa publish).
            <ul className="py-1">
              {publishedPages.map((p) => {
                const active = p.id === activeId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
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

        {/* Vùng nội dung — tất cả trang được mount lazy, ẩn/hiện bằng CSS */}
        <main className="flex-1 overflow-hidden relative">
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

      {/* Footer với tên trang đang xem */}
      {activePage && (
        <footer className="h-7 shrink-0 flex items-center px-4 gap-2 border-t border-border bg-panel text-xs text-muted">
          <I.Layout size={11} />
          <span>{activePage.name}</span>
          {activePage.publishMode === "public" && (
            <>
              <span>·</span>
              <span className="flex items-center gap-1">
                <I.Globe size={10} />
                {t("portal.public_badge")}
              </span>
            </>
          )}
        </footer>
      )}
    </div>
  );
}

export const Route = createFileRoute("/portal")({ component: PortalRoute });
