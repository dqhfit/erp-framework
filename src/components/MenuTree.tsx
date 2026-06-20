import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
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

const INDENT = 2;
const GUTTER = 12;

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

function useTreeKeyboardNav(
  containerRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    function getVisibleItems(): HTMLElement[] {
      const all = el.querySelectorAll<HTMLElement>("button[data-tree-item]:not([disabled])");
      return Array.from(all).filter((btn) => {
        const li = btn.closest("li");
        return li && li.offsetParent !== null;
      });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const items = getVisibleItems();
      const currentIdx = items.findIndex(
        (item) => item === e.target || item.contains(e.target as Node),
      );
      if (currentIdx === -1) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = items[currentIdx + 1];
          next?.focus();
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = items[currentIdx - 1];
          prev?.focus();
          break;
        }
        case "ArrowRight": {
          const code = e.target?.getAttribute?.("data-tree-item");
          if (code) {
            const groupBtn = el.querySelector<HTMLButtonElement>(
              `button[data-tree-group="${code}"]`,
            );
            if (groupBtn) {
              e.preventDefault();
              groupBtn.click();
            }
          }
          break;
        }
        case "ArrowLeft": {
          const code = e.target?.getAttribute?.("data-tree-item");
          if (code) {
            const groupBtn = el.querySelector<HTMLButtonElement>(
              `button[data-tree-group="${code}"]`,
            );
            if (groupBtn) {
              e.preventDefault();
              groupBtn.click();
            } else {
              const parent = e.target?.closest("li")?.parentElement?.closest("li");
              const parentBtn = parent?.querySelector<HTMLButtonElement>("button[data-tree-group]");
              if (parentBtn) {
                e.preventDefault();
                parentBtn.focus();
              }
            }
          }
          break;
        }
      }
    }

    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [containerRef, enabled]);
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
    onGroupClick?: (code: string) => void;
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
    onGroupClick,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
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
  useTreeKeyboardNav(containerRef, !loading && effNodes.length > 0);
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
    <div ref={containerRef} className="overflow-x-auto scrollbar-thin">
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
      {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: valid ARIA tree pattern */}
      <ul className="py-1 w-max min-w-full" role="tree">
        {shownRoots.map((r, i) => (
          <MenuBranch
            key={r.code}
            node={r}
            childrenOf={childrenOf}
            activePageId={activePageId}
            onSelect={onSelect}
            depth={0}
            isLast={i === shownRoots.length - 1}
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
            onGroupClick={onGroupClick}
          />
        ))}
      </ul>
    </div>
  );
});

/** Ô dẫn hướng thụt cấp — đường kẻ dọc nối nhánh. */
function IndentGuides({ depth, isLast }: { depth: number; isLast: boolean }) {
  if (depth === 0) return null;
  return (
    <>
      {Array.from({ length: depth - 1 }, (_, level) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: indent guide slots are static, never reorder
        <div key={level} className="w-[2px] shrink-0 relative">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border/20" />
        </div>
      ))}
      <div className="w-[2px] shrink-0 relative">
        <div
          className={cn(
            "absolute left-1/2 top-0 w-px bg-border/20",
            isLast ? "bottom-1/2" : "bottom-0",
          )}
        />
        <div className="absolute left-1/2 top-1/2 w-1 h-px bg-border/20 -translate-y-1/2" />
      </div>
    </>
  );
}

function MenuBranch({
  node,
  childrenOf,
  activePageId,
  onSelect,
  depth,
  isLast,
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
  onGroupClick,
}: {
  node: NavNode;
  childrenOf: Map<string, NavNode[]>;
  activePageId: string | null;
  onSelect: (pageId: string) => void;
  depth: number;
  isLast: boolean;
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
  onGroupClick?: (code: string) => void;
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
      <li role="none" className={cn("flex", depth > 0 && "relative")}>
        <button
          type="button"
          role="treeitem"
          data-tree-item={node.code}
          title={tooltip}
          onClick={() => node.pageId && onSelect(node.pageId)}
          className={cn(
            "flex-1 min-w-0 text-left flex items-center gap-1.5 transition-colors outline-none",
            "focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-inset",
            active
              ? "bg-accent/10 text-accent font-medium border-l-2 border-accent"
              : "text-text hover:bg-hover/40",
          )}
          style={{ paddingLeft: GUTTER + depth * INDENT }}
        >
          <IndentGuides depth={depth} isLast={isLast} />
          <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
            <I.Layout size={13} className="text-muted" />
          </span>
          <span className="truncate py-1.5 text-sm lowercase first-letter:uppercase">
            {myLabel}
          </span>
        </button>
        {node.pageId && (onToggleFav || onChangePage || onUnassign) && (
          <div className="sticky right-1 shrink-0 flex items-center gap-0.5 pr-1">
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
  const leafCount = kids.filter((k) => k.pageId != null).length;
  return (
    <li role="none">
      <button
        type="button"
        role="treeitem"
        aria-expanded={open}
        data-tree-item={node.code}
        data-tree-group={node.code}
        onClick={() => {
          onToggle(node.code, open);
          onGroupClick?.(node.code);
        }}
        className={cn(
          "flex w-full items-center gap-1.5 transition-colors outline-none text-xs font-semibold uppercase tracking-wide",
          "hover:bg-accent/5 focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-inset",
          "text-muted",
        )}
        style={{ paddingLeft: GUTTER + depth * INDENT }}
      >
        <IndentGuides depth={depth} isLast={false} />
        <I.ChevronRight
          size={12}
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        />
        <span className="truncate py-1.5 lowercase first-letter:uppercase">
          {displayLabel(node, cleanLabels)}
        </span>
        {leafCount > 0 && (
          <span className="text-[10px] text-muted/50 font-normal ml-auto mr-1">{leafCount}</span>
        )}
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
      </button>
      <div
        className={cn(
          "menu-collapse overflow-hidden transition-[grid-template-rows] duration-150",
          open ? "open" : "",
        )}
      >
        {showKids && (
          // biome-ignore lint/a11y/useSemanticElements: ul[role="group"] is valid ARIA tree pattern
          <ul role="group">
            {kids.map((k, i) => (
              <MenuBranch
                key={k.code}
                node={k}
                childrenOf={childrenOf}
                activePageId={activePageId}
                onSelect={onSelect}
                depth={depth + 1}
                isLast={i === kids.length - 1}
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
                onGroupClick={onGroupClick}
              />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
