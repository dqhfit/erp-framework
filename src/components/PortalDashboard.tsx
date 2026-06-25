import { createApprovalsClient, createObjectsClient } from "@erp-framework/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";

const api = createObjectsClient("");
const govApi = createApprovalsClient("");

interface PageInfo {
  id: string;
  name: string;
  icon: string;
  techName?: string;
}

interface PortalDashboardProps {
  userName: string;
  pages: PageInfo[];
  favs: { ids: Set<string>; isFav: (id: string) => boolean };
  onSelectPage: (id: string) => void;
  onOpenAllPages?: () => void;
}

function stripAccents(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function useUserStats() {
  const [unread, setUnread] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    api.notifications
      .unreadCount()
      .then((r) => setUnread((r as { count: number }).count))
      .catch(() => {});
  }, []);

  useEffect(() => {
    govApi
      .list("pending")
      .then((list) => setPending((list as unknown[]).length))
      .catch(() => {});
  }, []);

  return { unread, pending };
}

function StatCard({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number | null;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-lg border border-border/60 bg-panel text-left transition-all",
        onClick ? "hover:bg-accent/5 hover:border-accent/20 cursor-pointer" : "cursor-default",
      )}
    >
      <span className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <div className="text-lg font-semibold text-text leading-none">
          {value === null ? (
            <span className="inline-block w-6 h-4 bg-border/40 rounded animate-pulse" />
          ) : (
            value
          )}
        </div>
        <div className="text-xs text-muted mt-0.5 truncate">{label}</div>
      </div>
    </button>
  );
}

export function PortalDashboard({
  userName,
  pages,
  favs,
  onSelectPage,
  onOpenAllPages,
}: PortalDashboardProps) {
  const { prefs } = usePreferences();
  const { unread, pending } = useUserStats();
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  const favPages = useMemo(() => pages.filter((p) => favs.isFav(p.id)), [pages, favs]);

  const recentPageIds = useMemo(() => {
    const ids = prefs.portal?.recentPages;
    if (!ids?.length) {
      // fallback: lastPageId + first 5 pages
      const last = prefs.portal?.lastPageId;
      if (!last) return [];
      const arr = [last];
      for (const p of pages) {
        if (p.id !== last) {
          arr.push(p.id);
          if (arr.length >= 12) break;
        }
      }
      return arr;
    }
    return ids.slice(0, 12);
  }, [prefs.portal?.recentPages, prefs.portal?.lastPageId, pages]);

  const recentPages = useMemo(
    () => recentPageIds.map((id) => pages.find((p) => p.id === id)).filter(Boolean) as PageInfo[],
    [recentPageIds, pages],
  );

  const qlNorm = useMemo(() => stripAccents(q.trim()), [q]);

  const filteredPages = qlNorm
    ? pages.filter(
        (p) =>
          stripAccents(p.name).includes(qlNorm) ||
          (p.techName && stripAccents(p.techName).includes(qlNorm)),
      )
    : null;

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!qlNorm) return;
      const found = pages.find(
        (p) =>
          stripAccents(p.name).includes(qlNorm) ||
          (p.techName && stripAccents(p.techName).includes(qlNorm)),
      );
      if (found) onSelectPage(found.id);
    },
    [qlNorm, pages, onSelectPage],
  );

  return (
    <div className="h-full flex justify-center w-full overflow-hidden">
      {/* Cột chính: scrollable */}
      <div className="flex-1 overflow-y-auto px-12 md:px-16 lg:px-24 py-10 min-w-0 max-w-5xl w-full">
        {/* Greeting + date */}
        <div className="mb-5">
          <h1 className="text-2xl font-semibold text-text tracking-tight">
            Xin chào, <span className="text-accent">{userName}</span>
          </h1>
          <p className="text-sm text-muted mt-1">
            Hôm nay là{" "}
            {new Date().toLocaleDateString("vi-VN", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        {/* Search */}
        <form onSubmit={onSubmit} className="relative mb-8">
          <I.Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted/40 pointer-events-none"
          />
          <input
            ref={searchRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm kiếm trang, báo cáo, chức năng..."
            className="w-full h-11 pl-10 pr-4 bg-panel-2 border border-border rounded-lg text-sm text-text placeholder:text-muted/40 outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-colors"
          />
          <kbd className="absolute right-3.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-muted/40 bg-bg rounded border border-border/40">
            ⌘K
          </kbd>
        </form>

        {/* Kết quả tìm kiếm */}
        {filteredPages && (
          <section className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted/60 mb-3">
              Tất cả ({filteredPages.length})
            </h2>
            {filteredPages.length === 0 ? (
              <p className="text-sm text-muted">Không tìm thấy trang</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {filteredPages.map((p) => {
                  const IconC =
                    (
                      I as Record<
                        string,
                        React.ComponentType<{ size?: number; className?: string }>
                      >
                    )[p.icon] ?? I.Layout;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectPage(p.id)}
                      className="group flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent/5 transition-colors text-left"
                    >
                      <IconC
                        size={12}
                        className="shrink-0 text-muted/60 group-hover:text-accent transition-colors"
                      />
                      <span className="text-sm text-text truncate group-hover:text-accent transition-colors">
                        {p.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Yêu thích + Gần đây */}
        {!filteredPages && (
          <>
            {favPages.length > 0 && (
              <section className="mb-8">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted/60 mb-3 flex items-center gap-1.5">
                  <I.Star size={12} className="text-warning" />
                  Yêu thích
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {favPages.map((p) => {
                    const IconC =
                      (
                        I as Record<
                          string,
                          React.ComponentType<{ size?: number; className?: string }>
                        >
                      )[p.icon] ?? I.Layout;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onSelectPage(p.id)}
                        className="group flex items-center gap-3 p-3.5 rounded-lg border border-border/60 bg-panel hover:bg-accent/5 hover:border-accent/20 transition-all text-left"
                      >
                        <span className="w-9 h-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0 group-hover:bg-accent/15 transition-colors">
                          <IconC size={16} />
                        </span>
                        <span className="text-sm text-text font-medium truncate group-hover:text-accent transition-colors">
                          {p.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {recentPages.length > 0 && (
              <section className="mb-6">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted/60 mb-3 flex items-center gap-1.5">
                  <I.Clock size={12} />
                  Gần đây
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {recentPages.map((p) => {
                    const IconC =
                      (
                        I as Record<
                          string,
                          React.ComponentType<{ size?: number; className?: string }>
                        >
                      )[p.icon] ?? I.Layout;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onSelectPage(p.id)}
                        className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border/40 bg-panel hover:bg-accent/5 hover:border-accent/20 transition-all text-left"
                      >
                        <IconC
                          size={14}
                          className="shrink-0 text-muted group-hover:text-accent transition-colors"
                        />
                        <span className="text-sm text-text truncate group-hover:text-accent transition-colors">
                          {p.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Thống kê cá nhân */}
            <section className="mb-6">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted/60 mb-3 flex items-center gap-1.5">
                <I.BarChart2 size={12} />
                Của tôi
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <StatCard icon={I.Bell} label="Thông báo chưa đọc" value={unread} />
                <StatCard icon={I.ClipboardList} label="Phê duyệt chờ" value={pending} />
                <StatCard icon={I.Star} label="Trang yêu thích" value={favPages.length} />
                <StatCard icon={I.Layout} label="Tổng số trang" value={pages.length} />
              </div>
            </section>

            {onOpenAllPages && (
              <button
                type="button"
                onClick={onOpenAllPages}
                className="flex items-center gap-1.5 text-xs text-accent/60 hover:text-accent transition-colors"
              >
                <I.LayoutGrid size={11} className="shrink-0" />
                Mở menu điều hướng
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
