import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
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

function displayLabel(node: NavNode, clean?: boolean): string {
  const n = node.name ?? "";
  if (clean && node.code) {
    const suffix = ` - ${node.code}`;
    if (n.endsWith(suffix)) return n.slice(0, -suffix.length);
  }
  return n;
}

function compareName(node: NavNode): string {
  const nm = node.name ?? "";
  const suffix = ` - ${node.code}`;
  const base = nm.endsWith(suffix) ? nm.slice(0, -suffix.length) : nm;
  return base.trim().toLowerCase();
}

function collapseSameNameGroups(nodes: NavNode[]): NavNode[] {
  const codes = new Set(nodes.map((n) => n.code));
  const childrenOf = new Map<string, NavNode[]>();
  for (const n of nodes) {
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
          addKids(child);
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

function SkeletonLine({ width }: { width: string }) {
  return (
    <li className="flex items-center px-3 py-1.5 gap-2">
      <div className="w-3.5 h-3.5 rounded bg-hover/40 animate-pulse shrink-0" />
      <div className={`h-2.5 rounded bg-hover/40 animate-pulse ${width}`} />
    </li>
  );
}

function LoadingSkeleton() {
  return (
    <ul className="py-1">
      <SkeletonLine width="w-24" />
      <SkeletonLine width="w-28" />
      <div className="pl-5">
        <SkeletonLine width="w-20" />
        <SkeletonLine width="w-32" />
        <SkeletonLine width="w-24" />
      </div>
      <SkeletonLine width="w-20" />
      <SkeletonLine width="w-28" />
    </ul>
  );
}

export const MenuTree = forwardRef<
  MenuTreeHandle,
  {
    nodes: NavNode[];
    activePageId: string | null;
    onSelect: (pageId: string) => void;
    expandAll?: boolean;
    storageKey?: string;
    cleanLabels?: boolean;
    compact?: boolean;
    isolatable?: boolean;
    loading?: boolean;
    isFav?: (pageId: string) => boolean;
    onToggleFav?: (node: NavNode) => void;
    onUnassign?: (node: NavNode) => void;
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
    loading = false,
    isFav,
    onToggleFav,
    onUnassign,
    onChangePage,
  },
  ref,
) {
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
  const groupCodes = useMemo(
    () => effNodes.filter((n) => (childrenOf.get(n.code)?.length ?? 0) > 0).map((n) => n.code),
    [effNodes, childrenOf],
  );
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

  if (loading) {
    return (
      <div className="overflow-x-auto">
        <LoadingSkeleton />
      </div>
    );
  }

  if (effNodes.length === 0) {
    return (
      <div className="overflow-x-auto py-4 px-3 text-xs text-muted text-center">
        <I.Layout size={20} className="mx-auto mb-2 opacity-30" />
        Chưa có menu điều hướng
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
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
  const open = expandState[node.code] ?? (expandAll || depth === 0 || hasActiveDesc);
  // Trì hoãn unmount để animate thu gọn
  const [showKids, setShowKids] = useState(open);
  useEffect(() => {
    if (open) setShowKids(true);
    const t = setTimeout(() => {
      if (!open) setShowKids(false);
    }, 150);
    return () => clearTimeout(t);
  }, [open]);

  if (isLeaf) {
    const tooltip = [...parentPath, myLabel].join(" › ");
    const favored = !!(node.pageId && isFav?.(node.pageId));
    return (
      <li
        className={cn(
          "group/leaf flex items-center transition-colors",
          active
            ? "bg-accent/10 text-accent font-medium border-l-2 border-accent -ml-px"
            : "text-text hover:bg-hover/40",
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
  if (kids.length === 0) return null;
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
      <div
        className={cn(
          "menu-collapse overflow-hidden transition-[grid-template-rows] duration-150",
          open ? "open" : "",
        )}
      >
        {showKids && (
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
      </div>
    </li>
  );
}
