/* ==========================================================
   MenuTree — Cây điều hướng theo menu DQHF (legacy_menu_map.navTree).
   Dùng chung Portal (viewer) + Sidebar (admin). Node nhóm collapsible →
   mục (trang). Lá có pageId → onSelect(pageId). Nhánh không dẫn tới trang
   đã lọc ở server (navTree).

   Trạng thái mở/thu gọn TỪNG nhánh được NHỚ (localStorage theo node.code)
   → khôi phục y nguyên khi reload. `expandAll` chỉ là mặc định lần đầu
   (khi node CHƯA có trạng thái lưu); `storageKey` tách biệt portal/sidebar.
   ========================================================== */
import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { cn } from "@/lib/utils";

export interface NavNode {
  code: string;
  name: string | null;
  level: number | null;
  parentCode: string | null;
  sort: number;
  pageId: string | null;
}

/** Nhãn hiển thị: bỏ đuôi " - <source_code>" (vd "ĐỊNH MỨC NGŨ KIM - bbiDinhMucNKI")
 *  khi clean=true (portal/end-user). Admin giữ nguyên để đối chiếu code gốc. */
function displayLabel(node: NavNode, clean?: boolean): string {
  const n = node.name ?? "";
  if (clean && node.code) {
    const suffix = ` - ${node.code}`;
    if (n.endsWith(suffix)) return n.slice(0, -suffix.length);
  }
  return n;
}

/** Map code→open, persist localStorage. Trả về trạng thái đã lưu + toggle.
 *  Node CHƯA có trong map dùng `fallback` (expandAll / depth0 / có-trang-active). */
function useTreeExpand(storageKey?: string) {
  const lsKey = storageKey ? `menu-exp-${storageKey}` : null;
  const [map, setMap] = useState<Record<string, boolean>>(() => {
    if (!lsKey) return {};
    try {
      const r = localStorage.getItem(lsKey);
      return r ? (JSON.parse(r) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const toggle = useCallback(
    (code: string, currentlyOpen: boolean) => {
      setMap((prev) => {
        const next = { ...prev, [code]: !currentlyOpen };
        if (lsKey) {
          try {
            localStorage.setItem(lsKey, JSON.stringify(next));
          } catch {}
        }
        return next;
      });
    },
    [lsKey],
  );
  // Đặt MỌI node (codes) cùng mở/thu gọn — dùng cho "mở rộng/thu gọn tất cả".
  const setAll = useCallback(
    (open: boolean, codes: string[]) => {
      const next: Record<string, boolean> = {};
      for (const c of codes) next[c] = open;
      if (lsKey) {
        try {
          localStorage.setItem(lsKey, JSON.stringify(next));
        } catch {}
      }
      setMap(next);
    },
    [lsKey],
  );
  return { map, toggle, setAll };
}

export interface MenuTreeHandle {
  expandAll: () => void;
  collapseAll: () => void;
}

export const MenuTree = forwardRef<
  MenuTreeHandle,
  {
    nodes: NavNode[];
    activePageId: string | null;
    onSelect: (pageId: string) => void;
    /** Mở sẵn MỌI nhánh lần đầu (portal: end-user thấy hết, khỏi bấm từng cấp). */
    expandAll?: boolean;
    /** Khóa lưu trạng thái mở/thu gọn (vd "portal" | "sidebar"). Bỏ trống = không nhớ. */
    storageKey?: string;
    /** Bỏ đuôi " - <source_code>" trong nhãn (portal). Admin để false giữ code. */
    cleanLabels?: boolean;
    /** Yêu thích: kiểm tra pageId đã yêu thích chưa + toggle (bật thì hiện sao). */
    isFav?: (pageId: string) => boolean;
    onToggleFav?: (node: NavNode) => void;
  }
>(function MenuTree(
  {
    nodes,
    activePageId,
    onSelect,
    expandAll = false,
    storageKey,
    cleanLabels = false,
    isFav,
    onToggleFav,
  },
  ref,
) {
  const { map, toggle, setAll } = useTreeExpand(storageKey);
  const childrenOf = useMemo(() => {
    const m = new Map<string, NavNode[]>();
    for (const n of nodes) {
      const k = n.parentCode ?? "__root";
      const arr = m.get(k) ?? [];
      arr.push(n);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort - b.sort);
    return m;
  }, [nodes]);
  const roots = useMemo(() => {
    const codes = new Set(nodes.map((n) => n.code));
    return nodes
      .filter((n) => !n.parentCode || !codes.has(n.parentCode))
      .sort((a, b) => a.sort - b.sort);
  }, [nodes]);
  // Code của node CÓ con (nhóm) — tập node có thể mở/thu gọn.
  const groupCodes = useMemo(
    () => nodes.filter((n) => (childrenOf.get(n.code)?.length ?? 0) > 0).map((n) => n.code),
    [nodes, childrenOf],
  );
  useImperativeHandle(
    ref,
    () => ({
      expandAll: () => setAll(true, groupCodes),
      collapseAll: () => setAll(false, groupCodes),
    }),
    [setAll, groupCodes],
  );
  return (
    // Cuộn ngang: nội dung w-max (theo nhãn dài nhất + thụt cấp) nên nhãn
    // KHÔNG bị cắt — kéo ngang để xem hết. min-w-full để vẫn lấp đầy bề
    // ngang sidebar khi nội dung ngắn.
    <div className="overflow-x-auto">
      <ul className="py-1 w-max min-w-full">
        {roots.map((r) => (
          <MenuBranch
            key={r.code}
            node={r}
            childrenOf={childrenOf}
            activePageId={activePageId}
            onSelect={onSelect}
            depth={0}
            parentPath={[]}
            expandAll={expandAll}
            expandState={map}
            onToggle={toggle}
            cleanLabels={cleanLabels}
            isFav={isFav}
            onToggleFav={onToggleFav}
          />
        ))}
      </ul>
    </div>
  );
});

function MenuBranch({
  node,
  childrenOf,
  activePageId,
  onSelect,
  depth,
  parentPath,
  expandAll,
  expandState,
  onToggle,
  cleanLabels,
  isFav,
  onToggleFav,
}: {
  node: NavNode;
  childrenOf: Map<string, NavNode[]>;
  activePageId: string | null;
  onSelect: (pageId: string) => void;
  depth: number;
  /** Nhãn các cấp cha (để dựng tooltip "đường dẫn" của lá). */
  parentPath: string[];
  expandAll?: boolean;
  expandState: Record<string, boolean>;
  onToggle: (code: string, currentlyOpen: boolean) => void;
  cleanLabels?: boolean;
  isFav?: (pageId: string) => boolean;
  onToggleFav?: (node: NavNode) => void;
}) {
  const kids = childrenOf.get(node.code) ?? [];
  const myLabel = displayLabel(node, cleanLabels);
  const hasActiveDesc = useMemo(() => {
    const stack = [...kids];
    while (stack.length) {
      const c = stack.pop();
      if (!c) break;
      if (c.pageId && c.pageId === activePageId) return true;
      stack.push(...(childrenOf.get(c.code) ?? []));
    }
    return false;
  }, [kids, childrenOf, activePageId]);
  const isLeaf = kids.length === 0 && node.pageId;
  const active = node.pageId != null && node.pageId === activePageId;
  // Trạng thái đã lưu thắng (kể cả false = user chủ động thu gọn); chưa lưu
  // (undefined) → mặc định: expandAll / gốc / nhánh chứa trang đang xem.
  const open = expandState[node.code] ?? (expandAll || depth === 0 || hasActiveDesc);
  if (isLeaf) {
    // Tooltip = "đường dẫn" của mục: chuỗi nhãn từ gốc tới mục này.
    const tooltip = [...parentPath, myLabel].join(" › ");
    const favored = !!(node.pageId && isFav?.(node.pageId));
    return (
      <li className="group/leaf relative">
        <button
          type="button"
          title={tooltip}
          onClick={() => node.pageId && onSelect(node.pageId)}
          style={{ paddingLeft: 12 + depth * 12 }}
          className={cn(
            "w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors",
            onToggleFav && "pr-8",
            active ? "bg-accent/10 text-accent font-medium" : "text-text hover:bg-hover/40",
          )}
        >
          <I.Layout size={13} className="shrink-0 text-muted" />
          <span className="whitespace-nowrap lowercase first-letter:uppercase">{myLabel}</span>
        </button>
        {/* Sao yêu thích — hiện khi hover (hoặc luôn hiện nếu đã thích). */}
        {onToggleFav && node.pageId && (
          <button
            type="button"
            title={favored ? "Bỏ yêu thích" : "Yêu thích"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFav(node);
            }}
            className={cn(
              "absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center hover:bg-hover/60 transition-opacity",
              favored ? "opacity-100" : "opacity-0 group-hover/leaf:opacity-100",
            )}
          >
            <I.Star size={12} className={favored ? "text-warning" : "text-muted"} />
          </button>
        )}
      </li>
    );
  }
  if (kids.length === 0) return null; // nhóm rỗng — ẩn
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(node.code, open)}
        style={{ paddingLeft: 12 + depth * 12 }}
        className="w-full text-left px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5 hover:bg-hover/40"
      >
        <I.ChevronRight
          size={12}
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        />
        <span className="whitespace-nowrap lowercase first-letter:uppercase">
          {displayLabel(node, cleanLabels)}
        </span>
      </button>
      {open && (
        <ul>
          {kids.map((k) => (
            <MenuBranch
              key={k.code}
              node={k}
              childrenOf={childrenOf}
              activePageId={activePageId}
              onSelect={onSelect}
              depth={depth + 1}
              parentPath={[...parentPath, myLabel]}
              expandAll={expandAll}
              expandState={expandState}
              onToggle={onToggle}
              cleanLabels={cleanLabels}
              isFav={isFav}
              onToggleFav={onToggleFav}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
