/* ==========================================================
   MenuTree — Cây điều hướng theo menu DQHF (legacy_menu_map.navTree).
   Dùng chung Portal (viewer) + Sidebar (admin). Node nhóm collapsible →
   mục (trang). Lá có pageId → onSelect(pageId). Nhánh không dẫn tới trang
   đã lọc ở server (navTree).
   ========================================================== */
import { useMemo, useState } from "react";
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

export function MenuTree({
  nodes,
  activePageId,
  onSelect,
}: {
  nodes: NavNode[];
  activePageId: string | null;
  onSelect: (pageId: string) => void;
}) {
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
  return (
    <ul className="py-1">
      {roots.map((r) => (
        <MenuBranch
          key={r.code}
          node={r}
          childrenOf={childrenOf}
          activePageId={activePageId}
          onSelect={onSelect}
          depth={0}
        />
      ))}
    </ul>
  );
}

function MenuBranch({
  node,
  childrenOf,
  activePageId,
  onSelect,
  depth,
}: {
  node: NavNode;
  childrenOf: Map<string, NavNode[]>;
  activePageId: string | null;
  onSelect: (pageId: string) => void;
  depth: number;
}) {
  const kids = childrenOf.get(node.code) ?? [];
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
  const [open, setOpen] = useState(depth === 0 || hasActiveDesc);
  const isLeaf = kids.length === 0 && node.pageId;
  const active = node.pageId != null && node.pageId === activePageId;
  if (isLeaf) {
    return (
      <li>
        <button
          type="button"
          onClick={() => node.pageId && onSelect(node.pageId)}
          style={{ paddingLeft: 12 + depth * 12 }}
          className={cn(
            "w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors",
            active ? "bg-accent/10 text-accent font-medium" : "text-text hover:bg-hover/40",
          )}
        >
          <I.Layout size={13} className="shrink-0 text-muted" />
          <span className="truncate">{node.name}</span>
        </button>
      </li>
    );
  }
  if (kids.length === 0) return null; // nhóm rỗng — ẩn
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: 12 + depth * 12 }}
        className="w-full text-left px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5 hover:bg-hover/40"
      >
        <I.ChevronRight
          size={12}
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        />
        <span className="truncate">{node.name}</span>
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
            />
          ))}
        </ul>
      )}
    </li>
  );
}
