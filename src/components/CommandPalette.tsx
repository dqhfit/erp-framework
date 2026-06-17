import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Kbd } from "@/components/ui";
import { useT } from "@/hooks/useT";
import type { IconName } from "@/lib/object-types";
import { cn } from "@/lib/utils";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

interface Item {
  id: string;
  label: string;
  hint: string;
  iconName: IconName;
  to?: string;
  action?: () => void;
}

export function CommandPalette() {
  const t = useT();
  const open = useUI((s) => s.cmdOpen);
  const setOpen = useUI((s) => s.setCmdOpen);
  const setAgentOpen = useUI((s) => s.setAgentOpen);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const entities = useUserObjects((s) => s.entities);
  const pages = useUserObjects((s) => s.pages);
  const workflows = useUserObjects((s) => s.workflows);
  const agents = useUserObjects((s) => s.agents);

  const items: Item[] = useMemo(
    () => [
      /* ── Điều hướng chính ── */
      {
        id: "home",
        label: t("cmd.workspace"),
        hint: t("cmd.home_hint"),
        iconName: "Home",
        to: "/",
      },
      {
        id: "agent",
        label: t("cmd.ask_agent"),
        hint: t("cmd.ask_agent_hint"),
        iconName: "Sparkles",
        action: () => setAgentOpen(true),
      },

      /* ── Dynamic objects ── */
      ...entities.map<Item>((e) => ({
        id: `ent-${e.id}`,
        label: e.name,
        hint: t("cmd.hint_entity", { mcp: e.mcp }),
        iconName: e.icon,
        to: `/entities/${e.id}`,
      })),
      ...pages.map<Item>((p) => ({
        id: `page-${p.id}`,
        label: p.name,
        hint: t("cmd.hint_page"),
        iconName: p.icon,
        to: `/pages/${p.id}`,
      })),
      ...workflows.map<Item>((w) => ({
        id: `wf-${w.id}`,
        label: w.name,
        hint: t("cmd.hint_workflow", { runs: w.runs }),
        iconName: w.icon,
        to: `/workflows/${w.id}`,
      })),
      ...agents.map<Item>((a) => ({
        id: `agent-${a.id}`,
        label: a.name,
        hint: t("cmd.hint_agent", { model: a.model }),
        iconName: "Bot",
        to: `/agents/${a.id}`,
      })),

      /* ── Entity extras ── */
      {
        id: "entities-erd",
        label: "Sơ đồ ERD",
        hint: "Sơ đồ quan hệ giữa các entity",
        iconName: "GitBranch",
        to: "/entities/erd",
      },

      /* ── Agent extras ── */
      {
        id: "agents-library",
        label: "Thư viện agent",
        hint: "Template agent dùng sẵn cho nhiều nghiệp vụ",
        iconName: "Library",
        to: "/agents/library",
      },
      {
        id: "org-chart",
        label: "Sơ đồ phân cấp agent",
        hint: "Cây tổ chức agent theo cấp trên / quản lý",
        iconName: "GitBranch",
        to: "/org-chart",
      },

      /* ── Ops ── */
      {
        id: "activity",
        label: "Hoạt động",
        hint: "Nhật ký hoạt động hệ thống",
        iconName: "Activity",
        to: "/activity",
      },
      {
        id: "approvals",
        label: "Phê duyệt",
        hint: "Quản lý yêu cầu cần phê duyệt",
        iconName: "CheckSq",
        to: "/approvals",
      },
      {
        id: "knowledge",
        label: "Kiến thức",
        hint: "Kho tri thức dùng cho AI",
        iconName: "File",
        to: "/knowledge",
      },
      {
        id: "iot",
        label: "IoT",
        hint: "Thiết bị IoT và dữ liệu cảm biến",
        iconName: "Server",
        to: "/iot",
      },
      {
        id: "procedures",
        label: "Thủ tục",
        hint: "Native procedure JS chạy server-side",
        iconName: "Terminal",
        to: "/procedures",
      },
      {
        id: "enums",
        label: "Danh mục",
        hint: "Bộ giá trị tái dùng cho field enum/multi-enum",
        iconName: "Tag",
        to: "/enums",
      },
      {
        id: "tools",
        label: "Tools",
        hint: "Khám phá + chạy tools ngoài (web-app, MCP, CLI)",
        iconName: "Wand",
        to: "/tools",
      },
      {
        id: "feedback",
        label: "Phản hồi",
        hint: "Gửi bất cập + đề xuất cải thiện hệ thống",
        iconName: "HelpCircle",
        to: "/feedback",
      },

      /* ── Settings ── */
      {
        id: "set-llm",
        label: t("cmd.settings_llm"),
        hint: t("cmd.settings_llm_hint"),
        iconName: "Sparkles",
        to: "/settings/llm",
      },
      {
        id: "set-mcp",
        label: t("cmd.settings_mcp"),
        hint: t("cmd.settings_mcp_hint"),
        iconName: "Server",
        to: "/settings/mcp",
      },
      {
        id: "set-agents",
        label: "Cài đặt Agent",
        hint: "Cấu hình agent AI của công ty",
        iconName: "Bot",
        to: "/settings/agents",
      },
      {
        id: "set-rbac",
        label: "Phân quyền (RBAC)",
        hint: "Quản lý vai trò và quyền hạn người dùng",
        iconName: "Users",
        to: "/settings/rbac",
      },
      {
        id: "set-companies",
        label: "Công ty",
        hint: "Quản lý thông tin công ty trong hệ thống",
        iconName: "Briefcase",
        to: "/settings/companies",
      },
      {
        id: "set-embedding",
        label: "Embedding",
        hint: "Cấu hình mô hình embedding vector",
        iconName: "Hash",
        to: "/settings/embedding",
      },
      {
        id: "set-transfer",
        label: "Chuyển dữ liệu",
        hint: "Xuất / nhập dữ liệu giữa môi trường",
        iconName: "Save",
        to: "/settings/transfer",
      },
      {
        id: "set-backup",
        label: "Sao lưu",
        hint: "Tạo và phục hồi bản sao lưu hệ thống",
        iconName: "Save",
        to: "/settings/backup",
      },
      {
        id: "set-migration",
        label: "Migration MSSQL",
        hint: "Di chuyển dữ liệu từ MSSQL sang hệ thống",
        iconName: "Database",
        to: "/settings/migration",
      },
      {
        id: "set-plugins",
        label: "Plugins",
        hint: "Quản lý plugin mở rộng hệ thống",
        iconName: "Package",
        to: "/settings/plugins",
      },
      {
        id: "set-tools",
        label: "Quản lý Tools",
        hint: "Cấu hình và kích hoạt tools tích hợp",
        iconName: "Wand",
        to: "/settings/tools",
      },
      {
        id: "set-embed",
        label: "Nhúng (Embed)",
        hint: "Cấu hình nhúng trang vào website khác",
        iconName: "Link",
        to: "/settings/embed",
      },
      {
        id: "set-api-keys",
        label: "API Keys",
        hint: "Quản lý khoá API truy cập hệ thống",
        iconName: "Key",
        to: "/settings/api-keys",
      },
      {
        id: "set-viewer-groups",
        label: "Nhóm Viewer",
        hint: "Nhóm người dùng chỉ xem trang công khai",
        iconName: "Users",
        to: "/settings/viewer-groups",
      },
      {
        id: "set-shortcuts",
        label: "Phím tắt",
        hint: "Xem và tự đặt phím tắt bàn phím (lưu theo tài khoản)",
        iconName: "Command",
        to: "/settings/shortcuts",
      },
    ],
    [t, setAgentOpen, entities, pages, workflows, agents],
  );

  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const lower = q.toLowerCase();
    return items.filter(
      (i) => i.label.toLowerCase().includes(lower) || i.hint.toLowerCase().includes(lower),
    );
  }, [items, q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const run = (item: Item) => {
    setOpen(false);
    if (item.action) item.action();
    else if (item.to) navigate({ to: item.to });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: closure ổn định mount-only
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIdx((v) => Math.min(v + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIdx((v) => Math.max(v - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[idx];
        if (item) run(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // run là closure đóng trên setOpen/navigate ổn định — không cần làm dep.
  }, [open, filtered, idx, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-950 flex items-start justify-center pt-[15vh] p-4"
      onMouseDown={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[3px]" />
      <div
        className="relative panel rounded-lg shadow-2xl w-[640px] max-w-full overflow-hidden flex flex-col max-h-[60vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 h-12 border-b border-border shrink-0">
          <I.Search size={16} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("cmd.placeholder")}
            className="flex-1 bg-transparent outline-hidden text-sm placeholder:text-muted"
          />
          <Kbd>ESC</Kbd>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted text-sm">{t("cmd.empty")}</div>
          ) : (
            filtered.map((item, i) => {
              const IC = I[item.iconName] ?? I.Folder;
              return (
                <button
                  type="button"
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
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t("cmd.nav_select")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> {t("cmd.nav_open")}
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <Kbd>⌘K</Kbd> {t("cmd.nav_toggle")}
          </span>
        </div>
      </div>
    </div>
  );
}
