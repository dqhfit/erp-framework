import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useUI } from "@/stores/ui";
import { I } from "@/components/Icons";
import { Kbd } from "@/components/ui";
import type { IconName } from "@/lib/mock-data";
import { useUserObjects } from "@/stores/userObjects";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  label: string;
  hint: string;
  iconName: IconName;
  to?: string;
  action?: () => void;
}

export function CommandPalette() {
  const open = useUI((s) => s.cmdOpen);
  const setOpen = useUI((s) => s.setCmdOpen);
  const setAgentOpen = useUI((s) => s.setAgentOpen);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const entities = useUserObjects((s) => s.entities);
  const pages = useUserObjects((s) => s.pages);
  const workflows = useUserObjects((s) => s.workflows);
  const agents = useUserObjects((s) => s.agents);

  const items: Item[] = useMemo(() => [
    { id: "home", label: "Workspace", hint: "Trang chủ", iconName: "Home", to: "/" },
    { id: "agent", label: "Hỏi Agent", hint: "Mở chat panel", iconName: "Sparkles", action: () => setAgentOpen(true) },
    ...entities.map<Item>((e) => ({
      id: `ent-${e.id}`, label: e.name, hint: `Entity · ${e.mcp}`, iconName: e.icon, to: `/entities/${e.id}`,
    })),
    ...pages.map<Item>((p) => ({
      id: `page-${p.id}`, label: p.name, hint: "Page", iconName: p.icon, to: `/pages/${p.id}`,
    })),
    ...workflows.map<Item>((w) => ({
      id: `wf-${w.id}`, label: w.name, hint: `Workflow · ${w.runs} runs`, iconName: w.icon, to: `/workflows/${w.id}`,
    })),
    ...agents.map<Item>((a) => ({
      id: `agent-${a.id}`, label: a.name, hint: `Agent · ${a.model}`, iconName: "Bot", to: `/agents/${a.id}`,
    })),
    { id: "set-llm", label: "Cài đặt LLM", hint: "Profile / API key", iconName: "Sparkles", to: "/settings/llm" },
    { id: "set-mcp", label: "Cài đặt MCP", hint: "Server URL", iconName: "Server", to: "/settings/mcp" },
  ], [setAgentOpen, entities, pages, workflows, agents]);

  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const lower = q.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(lower) || i.hint.toLowerCase().includes(lower));
  }, [items, q]);

  useEffect(() => { setIdx(0); }, [q, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx((v) => Math.min(v + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setIdx((v) => Math.max(v - 1, 0)); }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[idx];
        if (item) run(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, idx, setOpen]);

  const run = (item: Item) => {
    setOpen(false);
    if (item.action) item.action();
    else if (item.to) navigate({ to: item.to });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[950] flex items-start justify-center pt-[15vh] p-4" onMouseDown={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[3px]" />
      <div className="relative panel rounded-lg shadow-2xl w-[640px] max-w-full overflow-hidden flex flex-col max-h-[60vh]"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 h-12 border-b border-border shrink-0">
          <I.Search size={16} className="text-muted shrink-0" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Gõ để tìm entity, page, workflow, lệnh…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted"
          />
          <Kbd>ESC</Kbd>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted text-sm">Không tìm thấy.</div>
          ) : (
            filtered.map((item, i) => {
              const IC = I[item.iconName] ?? I.Folder;
              return (
                <button
                  key={item.id}
                  onClick={() => run(item)}
                  onMouseEnter={() => setIdx(i)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 h-10 text-left text-sm",
                    i === idx ? "bg-accent/15" : "hover:bg-hover/30",
                  )}
                >
                  <span className="w-7 h-7 rounded-md bg-panel-2 border border-border flex items-center justify-center text-muted">
                    <IC size={13} />
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  <span className="text-xs text-muted truncate">{item.hint}</span>
                </button>
              );
            })
          )}
        </div>
        <div className="px-3 h-9 shrink-0 border-t border-border flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> Chọn</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> Mở</span>
          <span className="flex items-center gap-1 ml-auto"><Kbd>⌘K</Kbd> Toggle</span>
        </div>
      </div>
    </div>
  );
}
