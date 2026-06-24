import { useCallback, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import type { NavNode } from "@/components/MenuTree";
import { cn } from "@/lib/utils";

export function labelOf(n: NavNode): string {
  const nm = n.name ?? "";
  const suffix = ` - ${n.code}`;
  return nm.endsWith(suffix) ? nm.slice(0, -suffix.length) : nm;
}

function findInChildren(
  target: string,
  parent: string,
  map: Map<string, NavNode[]>,
): string[] | null {
  const kids = map.get(parent) ?? [];
  for (const k of kids) {
    if (k.code === target) return [target];
    const sub = findInChildren(target, k.code, map);
    if (sub) return [k.code, ...sub];
  }
  return null;
}

export function MenuBrowser({
  roots,
  childrenOf,
  onSelectPage,
  focusCategory,
  onFocusCategoryUsed,
  isFav,
  onToggleFav,
}: {
  roots: NavNode[];
  childrenOf: Map<string, NavNode[]>;
  activePageId: string | null;
  onSelectPage: (id: string) => void;
  focusCategory?: string | null;
  onFocusCategoryUsed?: () => void;
  isFav?: (id: string) => boolean;
  onToggleFav?: (item: { id: string; to: string; label: string; iconName: string }) => void;
}) {
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [drillPath, setDrillPath] = useState<string[]>([]);

  // Khi focusCategory thay đổi, chọn root và mở drill path
  useEffect(() => {
    if (!focusCategory) return;
    // Tìm root chứa category này
    const findPath = (code: string): string[] | null => {
      for (const root of roots) {
        if (root.code === code) return [code];
        const sub = findInChildren(code, root.code, childrenOf);
        if (sub) return sub;
      }
      return null;
    };
    const path = findPath(focusCategory);
    if (path) {
      setSelectedRoot(path[0] ?? null);
      setDrillPath(path.slice(1));
    }
    onFocusCategoryUsed?.();
  }, [focusCategory, roots, childrenOf, onFocusCategoryUsed]);

  const visibleRoots = useMemo(
    () => roots.filter((r) => (childrenOf.get(r.code)?.length ?? 0) > 0),
    [roots, childrenOf],
  );

  // Items hiện tại trong panel phải (theo drillPath)
  const currentItems = useMemo((): { code: string; node: NavNode }[] => {
    const target = drillPath.length > 0 ? drillPath[drillPath.length - 1] : selectedRoot;
    if (!target) return [];
    const kids = childrenOf.get(target) ?? [];
    return kids.map((n) => ({ code: n.code, node: n }));
  }, [selectedRoot, drillPath, childrenOf]);

  const selectRoot = useCallback((code: string) => {
    setSelectedRoot(code);
    setDrillPath([]);
  }, []);

  const drillIn = useCallback((code: string) => {
    setDrillPath((prev) => [...prev, code]);
  }, []);

  // Breadcrumb cho panel phải
  const breadcrumb = useMemo(() => {
    const parts: { code: string; label: string }[] = [];
    if (!selectedRoot) return parts;
    const rootNode = roots.find((r) => r.code === selectedRoot);
    if (rootNode) parts.push({ code: selectedRoot, label: labelOf(rootNode) });
    let curCode = selectedRoot;
    for (const step of drillPath) {
      const kids = childrenOf.get(curCode);
      const node = kids?.find((n) => n.code === step);
      if (node) {
        parts.push({ code: step, label: labelOf(node) });
        curCode = step;
      }
    }
    return parts;
  }, [selectedRoot, drillPath, roots, childrenOf]);

  // Tự chọn danh mục đầu tiên khi danh sách sẵn sàng
  useEffect(() => {
    if (!selectedRoot && visibleRoots.length > 0) {
      setSelectedRoot(visibleRoots[0]?.code ?? null);
    }
  }, [visibleRoots, selectedRoot]);

  if (visibleRoots.length === 0) return null;

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      {/* Left panel — root list */}
      <div className="w-40 shrink-0 border-r border-border bg-panel-2/50 overflow-y-auto">
        {visibleRoots.map((r) => {
          const active = r.code === selectedRoot;
          const kids = childrenOf.get(r.code) ?? [];
          return (
            <button
              key={r.code}
              type="button"
              onClick={() => {
                if (active) {
                  setSelectedRoot(null);
                  setDrillPath([]);
                } else {
                  selectRoot(r.code);
                }
              }}
              className={cn(
                "w-full text-left px-3 py-2 text-sm flex items-start gap-2 transition-colors",
                active ? "bg-accent/10 text-accent font-medium" : "text-text hover:bg-hover/40",
              )}
            >
              <I.ChevronRight
                size={10}
                className={cn(
                  "shrink-0 text-muted/40 transition-transform mt-1",
                  active && "rotate-90",
                )}
              />
              <span className="flex-1 min-w-0 lowercase first-letter:uppercase text-left break-words whitespace-normal leading-tight">
                {labelOf(r)}
              </span>
              <span className="text-[10px] text-muted/30 ml-auto mt-0.5">{kids.length}</span>
            </button>
          );
        })}
      </div>

      {/* Right panel — items */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {!selectedRoot ? (
          <div className="flex items-center justify-center h-24 text-xs text-muted/50">
            Chọn danh mục bên trái
          </div>
        ) : (
          <div className="py-1">
            {/* Breadcrumb */}
            {breadcrumb.length > 1 && (
              <div className="flex items-center gap-1 px-3 pb-1.5 text-xs text-muted/60 border-b border-border mb-1">
                {breadcrumb.map((crumb, ci) => (
                  <span key={crumb.code} className="flex items-center gap-1">
                    {ci > 0 && <I.ChevronRight size={9} className="text-muted/30" />}
                    {ci < breadcrumb.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDrillPath(drillPath.slice(0, ci));
                        }}
                        className="hover:text-accent transition-colors"
                      >
                        {crumb.label}
                      </button>
                    ) : (
                      <span className="font-medium text-text">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </div>
            )}
            {currentItems.map(({ node }) => {
              const hasKids = (childrenOf.get(node.code)?.length ?? 0) > 0;
              const isFolder = hasKids && !node.pageId;
              const isPage = !!node.pageId;
              const faved = isPage && isFav ? isFav(node.pageId as string) : false;
              return (
                <div
                  key={node.code}
                  className={cn(
                    "group flex items-center text-sm transition-colors",
                    isPage ? "hover:bg-hover/40" : "hover:bg-accent/5",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (isPage) onSelectPage(node.pageId as string);
                      else if (hasKids) drillIn(node.code);
                    }}
                    className="flex-1 flex items-center gap-2 px-3 py-2 text-left min-w-0"
                  >
                    {isFolder ? (
                      <I.FolderOpen size={13} className="shrink-0 text-warning/60" />
                    ) : (
                      <I.Layout size={13} className="shrink-0 text-muted" />
                    )}
                    <span className="truncate lowercase first-letter:uppercase text-text">
                      {labelOf(node)}
                    </span>
                    {hasKids && (
                      <I.ChevronRight size={11} className="ml-auto shrink-0 text-muted/40" />
                    )}
                  </button>
                  {isPage && onToggleFav && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFav({
                          id: node.pageId as string,
                          to: `/pages/${node.pageId}`,
                          label: labelOf(node),
                          iconName: "Layout",
                        });
                      }}
                      className={cn(
                        "px-2 py-2 shrink-0 transition-colors opacity-0 group-hover:opacity-100",
                        faved ? "opacity-100 text-warning" : "text-muted/40 hover:text-warning",
                      )}
                      title={faved ? "Bỏ yêu thích" : "Thêm vào yêu thích"}
                    >
                      <I.Star size={13} className={faved ? "fill-current" : ""} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
