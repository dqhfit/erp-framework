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

/** Nhãn dùng để SO SÁNH gộp (bỏ đuôi " - <code>" như displayLabel, lower+trim). */
function compareName(node: NavNode): string {
  const nm = node.name ?? "";
  const suffix = ` - ${node.code}`;
  const base = nm.endsWith(suffix) ? nm.slice(0, -suffix.length) : nm;
  return base.trim().toLowerCase();
}

/** Gộp nhóm con TRÙNG TÊN nhóm cha (vd "Danh mục › Danh mục › Danh Mục" → 1
 *  "Danh mục"): node nhóm (có con, KHÔNG phải trang) mà tên == tên cha → bỏ node
 *  đó, kéo con của nó lên thẳng nhóm cha, đệ quy mọi cấp. Giữ thứ tự + `code`
 *  (trạng thái mở/thu gọn theo code vẫn đúng). Chỉ dùng ở portal (end-user) —
 *  admin giữ nguyên cấu trúc menu gốc để quản lý. */
function collapseSameNameGroups(nodes: NavNode[]): NavNode[] {
  const codes = new Set(nodes.map((n) => n.code));
  const childrenOf = new Map<string, NavNode[]>();
  for (const n of nodes) {
    // Gốc = không có cha HOẶC cha nằm NGOÀI tập (navTree lọc có thể giữ node con
    // mà cắt mất cha → node "mồ côi" vẫn phải coi là gốc; nếu không rớt cả nhánh).
    const k = !n.parentCode || !codes.has(n.parentCode) ? "__root" : n.parentCode;
    const arr = childrenOf.get(k);
    if (arr) arr.push(n);
    else childrenOf.set(k, [n]);
  }
  for (const arr of childrenOf.values()) arr.sort((a, b) => a.sort - b.sort);
  const isGroup = (n: NavNode) => (childrenOf.get(n.code)?.length ?? 0) > 0 && n.pageId == null;
  const out: NavNode[] = [];
  const emit = (node: NavNode, hostCode: string | null, sortIdx: number): void => {
    out.push({ ...node, parentCode: hostCode, sort: sortIdx });
    let s = 0;
    const addKids = (ofNode: NavNode): void => {
      for (const child of childrenOf.get(ofNode.code) ?? []) {
        if (isGroup(child) && compareName(child) === compareName(node)) {
          addKids(child); // trùng tên cha → nâng con của child lên dưới `node`
        } else {
          emit(child, node.code, s++);
        }
      }
    };
    addKids(node);
  };
  const rootList = childrenOf.get("__root") ?? [];
  for (const [i, root] of rootList.entries()) emit(root, null, i);
  return out;
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
    /** Gộp nhóm con trùng tên nhóm cha (portal). Admin để false giữ cấu trúc gốc. */
    compact?: boolean;
    /** Cho phép "cô lập" 1 nhóm: mỗi nhóm có nút focus → chỉ hiện riêng nhánh đó. */
    isolatable?: boolean;
    /** Yêu thích: kiểm tra pageId đã yêu thích chưa + toggle (bật thì hiện sao). */
    isFav?: (pageId: string) => boolean;
    onToggleFav?: (node: NavNode) => void;
    /** Admin: gỡ trang khỏi mục menu (đối xứng "Gán vào menu"). Bỏ trống = không hiện nút. */
    onUnassign?: (node: NavNode) => void;
    /** Admin: đổi TRANG liên kết của mục menu ngay tại cây. Bỏ trống = không hiện nút. */
    onChangePage?: (node: NavNode) => void;
  }
>(function MenuTree(
  {
    nodes,
    activePageId,
    onSelect,
    expandAll = false,
    storageKey,
    cleanLabels = false,
    compact = false,
    isolatable = false,
    isFav,
    onToggleFav,
    onUnassign,
    onChangePage,
  },
  ref,
) {
  // Portal: gộp các nhóm trùng tên cha cho gọn (giữ code → trạng thái mở vẫn đúng).
  const effNodes = useMemo(
    () => (compact ? collapseSameNameGroups(nodes) : nodes),
    [compact, nodes],
  );
  const { map, toggle, setAll } = useTreeExpand(storageKey);
  const childrenOf = useMemo(() => {
    const m = new Map<string, NavNode[]>();
    for (const n of effNodes) {
      const k = n.parentCode ?? "__root";
      const arr = m.get(k) ?? [];
      arr.push(n);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort - b.sort);
    return m;
  }, [effNodes]);
  const roots = useMemo(() => {
    const codes = new Set(effNodes.map((n) => n.code));
    return effNodes
      .filter((n) => !n.parentCode || !codes.has(n.parentCode))
      .sort((a, b) => a.sort - b.sort);
  }, [effNodes]);
  // Code của node CÓ con (nhóm) — tập node có thể mở/thu gọn.
  const groupCodes = useMemo(
    () => effNodes.filter((n) => (childrenOf.get(n.code)?.length ?? 0) > 0).map((n) => n.code),
    [effNodes, childrenOf],
  );
  // Cô lập: chỉ hiện riêng 1 nhóm — ẩn MỌI nhóm khác (kể cả các nhóm cha lớn như
  // "Đối tượng", "Vận hành"…). Nếu code không còn trong cây (đổi dữ liệu) → tự coi
  // như tắt cô lập (hiện lại tất cả).
  const [isolateCode, setIsolateCode] = useState<string | null>(null);
  const isolated = useMemo(
    () => (isolateCode ? (effNodes.find((n) => n.code === isolateCode) ?? null) : null),
    [isolateCode, effNodes],
  );
  const shownRoots = isolated ? [isolated] : roots;
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
      {/* Đang cô lập 1 nhóm → thanh báo + nút hiện lại tất cả. */}
      {isolated && (
        <button
          type="button"
          onClick={() => setIsolateCode(null)}
          title="Hiện lại tất cả menu"
          className="sticky left-0 w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-accent bg-accent/10 hover:bg-accent/15 border-b border-border"
        >
          <I.X size={12} className="shrink-0" />
          <span className="whitespace-nowrap">
            Đang xem riêng:{" "}
            <span className="font-semibold lowercase first-letter:uppercase">
              {displayLabel(isolated, cleanLabels)}
            </span>{" "}
            — hiện tất cả
          </span>
        </button>
      )}
      <ul className="py-1 w-max min-w-full">
        {shownRoots.map((r) => (
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
            isolatable={isolatable}
            onIsolate={setIsolateCode}
            isFav={isFav}
            onToggleFav={onToggleFav}
            onUnassign={onUnassign}
            onChangePage={onChangePage}
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
  isolatable,
  onIsolate,
  isFav,
  onToggleFav,
  onUnassign,
  onChangePage,
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
  isolatable?: boolean;
  onIsolate?: (code: string) => void;
  isFav?: (pageId: string) => boolean;
  onToggleFav?: (node: NavNode) => void;
  onUnassign?: (node: NavNode) => void;
  onChangePage?: (node: NavNode) => void;
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
      <li
        className={cn(
          "group/leaf flex items-center transition-colors",
          active ? "bg-accent/10 text-accent font-medium" : "text-text hover:bg-hover/40",
        )}
      >
        <button
          type="button"
          title={tooltip}
          onClick={() => node.pageId && onSelect(node.pageId)}
          style={{ paddingLeft: 12 + depth * 12 }}
          className="flex-1 min-w-0 text-left px-3 py-1.5 text-sm flex items-center gap-2"
        >
          <I.Layout size={13} className="shrink-0 text-muted" />
          <span className="whitespace-nowrap lowercase first-letter:uppercase">{myLabel}</span>
        </button>
        {/* Nhóm nút thao tác — STICKY ghim mép phải vùng nhìn (cây cuộn ngang
            w-max nên absolute-right bị ra ngoài). Gộp 1 dải để nhiều nút không
            chồng lên nhau. Sao luôn hiện nếu đã thích; còn lại hiện khi hover. */}
        {node.pageId && (onToggleFav || onChangePage || onUnassign) && (
          <div className="sticky right-1 shrink-0 mr-1 flex items-center gap-0.5">
            {onToggleFav && (
              <button
                type="button"
                title={favored ? "Bỏ yêu thích" : "Yêu thích"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFav(node);
                }}
                className={cn(
                  "w-5 h-5 rounded flex items-center justify-center bg-panel hover:bg-hover/60 transition-opacity",
                  favored ? "opacity-100" : "opacity-0 group-hover/leaf:opacity-100",
                )}
              >
                <I.Star size={12} className={favored ? "text-warning" : "text-muted"} />
              </button>
            )}
            {/* Đổi trang liên kết (admin) — mở picker chọn trang khác cho mục này. */}
            {onChangePage && (
              <button
                type="button"
                title="Đổi trang liên kết"
                onClick={(e) => {
                  e.stopPropagation();
                  onChangePage(node);
                }}
                className="w-5 h-5 rounded flex items-center justify-center bg-panel text-muted hover:bg-accent/15 hover:text-accent opacity-0 group-hover/leaf:opacity-100 transition-opacity"
              >
                <I.Repeat size={12} />
              </button>
            )}
            {/* Gỡ khỏi menu (admin) — đối xứng "Gán vào menu". Khác nút xoá trang
                (đây chỉ bỏ liên kết node↔trang). */}
            {onUnassign && (
              <button
                type="button"
                title="Gỡ khỏi menu"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnassign(node);
                }}
                className="w-5 h-5 rounded flex items-center justify-center bg-panel text-muted hover:bg-danger/15 hover:text-danger opacity-0 group-hover/leaf:opacity-100 transition-opacity"
              >
                <I.X size={12} />
              </button>
            )}
          </div>
        )}
      </li>
    );
  }
  if (kids.length === 0) return null; // nhóm rỗng — ẩn
  return (
    <li>
      <div className="group/grp flex items-center text-muted hover:bg-hover/40">
        <button
          type="button"
          onClick={() => onToggle(node.code, open)}
          style={{ paddingLeft: 12 + depth * 12 }}
          className="flex-1 min-w-0 text-left px-3 py-1.5 text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5"
        >
          <I.ChevronRight
            size={12}
            className={cn("shrink-0 transition-transform", open && "rotate-90")}
          />
          <span className="whitespace-nowrap lowercase first-letter:uppercase">
            {displayLabel(node, cleanLabels)}
          </span>
        </button>
        {/* Nút "cô lập" — chỉ hiện riêng nhóm này, ẩn mọi nhóm khác. Sticky ghim mép
            phải (cây cuộn ngang). Hiện khi hover hàng nhóm. */}
        {isolatable && onIsolate && (
          <button
            type="button"
            title="Chỉ hiện riêng nhóm này"
            onClick={(e) => {
              e.stopPropagation();
              onIsolate(node.code);
            }}
            className="sticky right-1 shrink-0 w-5 h-5 mr-1 rounded flex items-center justify-center bg-panel hover:bg-hover/60 opacity-0 group-hover/grp:opacity-100 transition-opacity"
          >
            <I.Focus size={12} className="text-muted" />
          </button>
        )}
      </div>
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
              isolatable={isolatable}
              onIsolate={onIsolate}
              isFav={isFav}
              onToggleFav={onToggleFav}
              onUnassign={onUnassign}
              onChangePage={onChangePage}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
