/* PagesListSection — nhóm "Trang" liệt kê mọi trang (đã/chưa gắn menu)
   + cờ trạng thái + gán-vào-menu/xoá. Tách từ Sidebar.tsx. */
import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import type { NavNode } from "@/components/MenuTree";
import { FlagDot, PageStatusPicker } from "@/components/PageStatusFlag";
import { useT } from "@/hooks/useT";
import type { IconName } from "@/lib/object-types";
import { BUILTIN_PAGE_FLAGS, resolveFlag } from "@/lib/page-status";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";

/* ─── PagesListSection — nhóm "Trang" NGANG HÀNG với "Menu" ────────
   Liệt kê MỌI trang (đã/chưa gắn menu); trang đã nằm trong menu có badge.
   Mỗi trang: gán-vào-menu / xoá. Section riêng (thu gọn + tìm kiếm). */
/** Item trang cho danh sách Sidebar (kèm cờ trạng thái). */
export type PageListItem = {
  id: string;
  name: string;
  icon: IconName;
  to: string;
  status?: string | null;
};

export function PagesListSection({
  collapsed,
  pathname,
  allPages,
  navNodes,
  onOpen,
  onNavigate,
  onDeletePage,
  onAssignPage,
  canSetStatus,
  open,
  onToggle,
}: {
  collapsed: boolean;
  pathname: string;
  allPages: PageListItem[];
  navNodes: NavNode[];
  onOpen: (to: string) => void;
  onNavigate?: () => void;
  onDeletePage?: (id: string) => void;
  onAssignPage?: (page: { id: string; name: string }) => void;
  /** Có quyền sửa trang → cho gắn/đổi cờ trạng thái ngay trong danh sách. */
  canSetStatus?: boolean;
  /** Mở/đóng section (controlled bởi Sidebar — để "thu gọn tất cả" tác động). */
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const pageFlags = useUserObjects((s) => s.pageFlags);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [menuFilter, setMenuFilter] = useState<"all" | "with" | "no">("all");
  // Lọc theo cờ trạng thái: null = tất cả, "none" = chưa gắn cờ, else = value cờ.
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  if (collapsed || allPages.length === 0) return null;
  const matched = pathname.match(/^\/(?:pages|view)\/([^/]+)/);
  const activePageId = matched?.[1] ?? null;
  const linkedPageIds = new Set(navNodes.filter((n) => n.pageId).map((n) => n.pageId as string));
  const ql = q.trim().toLowerCase();
  // Cờ thực sự đang dùng trên các trang (để chỉ hiện chip lọc có ý nghĩa).
  const usedFlagValues = new Set(
    allPages.map((p) => resolveFlag(p.status, pageFlags)?.value).filter(Boolean) as string[],
  );
  const filterFlags = [
    ...BUILTIN_PAGE_FLAGS,
    ...pageFlags.map((f) => ({ value: f.id, label: f.label })),
  ].filter((f) => usedFlagValues.has(f.value));
  // Lọc: theo ô tìm + trạng thái menu (tất cả/đã có/chưa có) + cờ trạng thái.
  const filtered = allPages.filter((p) => {
    if (ql && !p.name.toLowerCase().includes(ql)) return false;
    const has = linkedPageIds.has(p.id);
    if (menuFilter === "with" && !has) return false;
    if (menuFilter === "no" && has) return false;
    if (statusFilter) {
      const fv = resolveFlag(p.status, pageFlags)?.value ?? null;
      if (statusFilter === "none" ? fv !== null : fv !== statusFilter) return false;
    }
    return true;
  });
  return (
    <div>
      <div className="group/sec flex items-center px-3 py-0.5">
        {searchOpen ? (
          <>
            <I.Search size={11} className="shrink-0 text-muted" />
            <input
              ref={searchRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchOpen(false);
                  setQ("");
                }
              }}
              placeholder="Tìm trang…"
              className="flex-1 bg-transparent outline-none text-[12px] text-text placeholder:text-muted/50 min-w-0 ml-1.5"
            />
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setQ("");
              }}
              title={t("common.close")}
              className="w-5 h-5 rounded-sm flex items-center justify-center text-muted hover:text-text shrink-0"
            >
              <I.X size={11} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggle}
              className="flex-1 flex items-center gap-1 text-[10px] font-semibold tracking-[0.08em] uppercase text-muted/60 hover:text-muted transition-colors"
            >
              <I.ChevronRight
                size={9}
                className={cn("transition-transform shrink-0", open && "rotate-90")}
              />
              <span>Trang</span>
              <span className="text-muted/30 normal-case tracking-normal">{allPages.length}</span>
            </button>
            {open && (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                title="Tìm trang"
                className="w-5 h-5 rounded-sm hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text opacity-0 group-hover/sec:opacity-100 transition-opacity"
              >
                <I.Search size={11} />
              </button>
            )}
          </>
        )}
      </div>
      {open && (
        <>
          {/* Lọc theo trạng thái menu */}
          <div className="flex items-center gap-1 px-3 pb-1">
            {(
              [
                ["all", "Tất cả"],
                ["with", "Có menu"],
                ["no", "Chưa"],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMenuFilter(k)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                  menuFilter === k ? "bg-accent/15 text-accent" : "text-muted/60 hover:text-text",
                )}
              >
                {lbl}
              </button>
            ))}
          </div>
          {/* Lọc theo cờ trạng thái — chỉ hiện cờ đang được dùng trên trang. */}
          {filterFlags.length > 0 && (
            <div className="flex items-center gap-1 px-3 pb-1 flex-wrap">
              <button
                type="button"
                onClick={() => setStatusFilter(null)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] transition-colors inline-flex items-center gap-1",
                  statusFilter === null
                    ? "bg-accent/15 text-accent"
                    : "text-muted/60 hover:text-text",
                )}
              >
                <I.Tag size={9} /> Mọi cờ
              </button>
              {filterFlags.map((f) => {
                const fdef = resolveFlag(f.value, pageFlags);
                if (!fdef) return null;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setStatusFilter(f.value)}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] transition-colors inline-flex items-center gap-1",
                      statusFilter === f.value
                        ? "bg-accent/15 text-accent"
                        : "text-muted/60 hover:text-text",
                    )}
                  >
                    <FlagDot color={fdef.color} /> {f.label}
                  </button>
                );
              })}
            </div>
          )}
          <ul>
            {filtered.length === 0 ? (
              <li className="px-4 py-1 text-[11px] text-muted/50">Không có trang khớp.</li>
            ) : (
              filtered.map((p) => {
                const active = pathname === p.to || activePageId === p.id;
                const IconC = I[p.icon] ?? I.Layout;
                const hasMenu = linkedPageIds.has(p.id);
                const flagDef = resolveFlag(p.status, pageFlags);
                // staticPages có id là route (bắt đầu "/") — không phải trang DB,
                // không gắn cờ được. Chỉ trang thật mới cho picker.
                const isRealPage = !p.id.startsWith("/");
                const showPicker = canSetStatus && isRealPage;
                // Gán-menu áp cho CẢ trang built-in (id route "/…") — backend lưu
                // route vào overrides.staticRoute. Nhưng XÓA chỉ cho trang DB thật
                // (không xoá được màn built-in).
                const showAssign = !!onAssignPage;
                const showDelete = !!onDeletePage && isRealPage;
                const actN = (showPicker ? 1 : 0) + (showAssign ? 1 : 0) + (showDelete ? 1 : 0);
                return (
                  <li key={p.id} className="relative group/pg">
                    <button
                      type="button"
                      onClick={() => {
                        onOpen(p.to);
                        onNavigate?.();
                      }}
                      className={cn(
                        "w-full text-left pl-4 py-1.5 text-sm flex items-center gap-2 transition-colors",
                        actN >= 3 ? "pr-[72px]" : actN === 2 ? "pr-12" : "pr-7",
                        active
                          ? "bg-accent/10 text-accent font-medium"
                          : "text-text hover:bg-hover/40",
                      )}
                    >
                      <IconC size={13} className="shrink-0 text-muted" />
                      <span className="truncate">{p.name}</span>
                      {/* Cờ trạng thái — chấm màu (luôn hiện), tooltip = nhãn cờ. */}
                      {flagDef && (
                        <span title={`Cờ: ${flagDef.label}`} className="shrink-0">
                          <FlagDot color={flagDef.color} />
                        </span>
                      )}
                      {hasMenu && (
                        <span title="Đã có trong menu" className="shrink-0 text-accent/70">
                          <I.GitBranch size={10} />
                        </span>
                      )}
                    </button>
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/pg:opacity-100 transition-opacity">
                      {showPicker && (
                        <PageStatusPicker
                          pageId={p.id}
                          status={p.status}
                          align="right"
                          iconTrigger
                        />
                      )}
                      {showAssign && (
                        <button
                          type="button"
                          onClick={() => onAssignPage?.({ id: p.id, name: p.name })}
                          className="w-5 h-5 rounded-sm flex items-center justify-center text-muted/40 hover:bg-hover/80 hover:text-accent"
                          title="Gán vào menu"
                        >
                          <I.GitBranch size={11} />
                        </button>
                      )}
                      {showDelete && (
                        <button
                          type="button"
                          onClick={() => onDeletePage?.(p.id)}
                          className="w-5 h-5 rounded-sm flex items-center justify-center text-muted/30 hover:text-danger"
                          title={t("common.delete")}
                        >
                          <I.Trash size={11} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </>
      )}
    </div>
  );
}
