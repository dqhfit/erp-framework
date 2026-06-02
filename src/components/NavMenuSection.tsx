/* ==========================================================
   NavMenuSection — render cây menu tự dựng (nav_items) ở Sidebar.
   Tự fetch nav.list; ẩn nếu rỗng. Nhóm (group) gấp/mở; trang/liên kết
   điều hướng. Cấu hình ở Settings → Trình dựng menu (/settings/navigation).
   ========================================================== */
import { createNavClient, type NavItem } from "@erp-framework/client";
import { useNavigate } from "@tanstack/react-router";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";

const navApi = createNavClient("");
const IconMap = I as unknown as Record<
  string,
  (p: { size?: number; className?: string }) => ReactElement
>;

export function NavMenuSection({ collapsed }: { collapsed?: boolean }) {
  const navigate = useNavigate();
  const go = (to: string) => (navigate as unknown as (o: { to: string }) => void)({ to });

  const [items, setItems] = useState<NavItem[]>([]);
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    navApi
      .list()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, NavItem[]>();
    for (const it of items) {
      const k = it.parentId;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
    return m;
  }, [items]);

  const roots = childrenOf.get(null) ?? [];
  if (items.length === 0 || collapsed) return null;

  const onClickItem = (it: NavItem) => {
    if (it.kind === "group") {
      setExpanded((prev) => {
        const n = new Set(prev);
        n.has(it.id) ? n.delete(it.id) : n.add(it.id);
        return n;
      });
      return;
    }
    if (!it.target) return;
    if (it.kind === "page") {
      go(`/pages/${it.target}`);
    } else if (/^https?:\/\//.test(it.target)) {
      window.open(it.target, "_blank", "noopener");
    } else {
      go(it.target.startsWith("/") ? it.target : `/${it.target}`);
    }
  };

  const renderRow = (it: NavItem, depth: number, seen: Set<string>): ReactElement | null => {
    // Phòng thủ chống cây vòng (DB lỗi) → render đệ quy không vô hạn.
    if (seen.has(it.id) || depth > 50) return null;
    const here = new Set(seen).add(it.id);
    const kids = childrenOf.get(it.id) ?? [];
    const isOpen = expanded.has(it.id);
    const Custom = it.icon && typeof IconMap[it.icon] === "function" ? IconMap[it.icon] : undefined;
    return (
      <div key={it.id}>
        <button
          type="button"
          onClick={() => onClickItem(it)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[13px] text-text-sub hover:bg-hover/50"
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          {it.kind === "group" ? (
            isOpen ? (
              <I.ChevronDown size={13} className="shrink-0 text-muted" />
            ) : (
              <I.ChevronRight size={13} className="shrink-0 text-muted" />
            )
          ) : (
            <span className="inline-block w-[13px]" />
          )}
          {Custom ? (
            <Custom size={13} />
          ) : it.kind === "group" ? (
            <I.Folder size={13} className="shrink-0 text-amber-500" />
          ) : it.kind === "page" ? (
            <I.File size={13} className="shrink-0 text-sky-500" />
          ) : (
            <I.Link size={13} className="shrink-0 text-violet-500" />
          )}
          <span className="flex-1 truncate">{it.label}</span>
        </button>
        {it.kind === "group" && isOpen && kids.map((c) => renderRow(c, depth + 1, here))}
      </div>
    );
  };

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-text"
      >
        {open ? <I.ChevronDown size={12} /> : <I.ChevronRight size={12} />}
        Menu
      </button>
      {open && <div className="px-1">{roots.map((r) => renderRow(r, 0, new Set()))}</div>}
    </div>
  );
}
