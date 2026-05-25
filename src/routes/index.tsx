import { createFileRoute, Link } from "@tanstack/react-router";
import { Button, Kbd, Textarea } from "@/components/ui";
import { I } from "@/components/Icons";
import type { IconName } from "@/lib/object-types";
import { useUserObjects } from "@/stores/userObjects";
import { useUI } from "@/stores/ui";
import { useAuth } from "@/stores/auth";
import { useT } from "@/hooks/useT";

type Tint = "accent" | "accent-2" | "success" | "warning";

const templateDefs: Array<{ nameKey: string; descKey: string; icon: IconName; tint: Tint }> = [
  { nameKey: "home.tpl_crm_name",       descKey: "home.tpl_crm_desc",       icon: "Users",     tint: "accent" },
  { nameKey: "home.tpl_orders_name",    descKey: "home.tpl_orders_desc",    icon: "Cart",      tint: "accent-2" },
  { nameKey: "home.tpl_warehouse_name", descKey: "home.tpl_warehouse_desc", icon: "Warehouse", tint: "success" },
  { nameKey: "home.tpl_hr_name",        descKey: "home.tpl_hr_desc",        icon: "Briefcase", tint: "warning" },
];

const tintBg: Record<string, string> = {
  accent: "bg-accent/15 text-accent",
  "accent-2": "bg-accent-2/15 text-accent-2",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
};

function getGreeting(t: (k: string) => string) {
  const h = new Date().getHours();
  return h < 11 ? t("home.greeting_morning")
       : h < 14 ? t("home.greeting_noon")
       : h < 18 ? t("home.greeting_evening")
       : t("home.greeting_night");
}

function Home() {
  const t = useT();
  const user = useAuth((s) => s.user);
  const setAgentOpen = useUI((s) => s.setAgentOpen);
  const setAiCreateTarget = useUI((s) => s.setAiCreateTarget);
  const uEntities = useUserObjects((s) => s.entities);
  const uPages = useUserObjects((s) => s.pages);
  const uWorkflows = useUserObjects((s) => s.workflows);
  const uAgents = useUserObjects((s) => s.agents);

  const stats: Array<{ labelKey: string; value: number; icon: IconName; tint: Tint }> = [
    { labelKey: "sidebar.entities",  value: uEntities.length,  icon: "Database", tint: "accent" },
    { labelKey: "sidebar.pages",     value: uPages.length,     icon: "Layout",   tint: "accent-2" },
    { labelKey: "sidebar.workflows", value: uWorkflows.length, icon: "Workflow", tint: "success" },
    { labelKey: "sidebar.agents",    value: uAgents.length,    icon: "Bot",      tint: "warning" },
  ];

  const recents: Array<{ kind: string; name: string; icon: IconName; to: string }> = [
    ...uEntities.map((e) => ({ kind: "Entity", name: e.name, icon: e.icon, to: `/entities/${e.id}` })),
    ...uPages.map((p) => ({ kind: "Page", name: p.name, icon: p.icon, to: `/pages/${p.id}` })),
    ...uWorkflows.map((w) => ({ kind: "Workflow", name: w.name, icon: w.icon, to: `/workflows/${w.id}` })),
  ].slice(0, 6);

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1180px] mx-auto px-8 py-10">
        {/* Hero */}
        <div className="mb-8">
          <div className="text-sm text-muted mb-1">{getGreeting(t)}, {user?.name ?? ""}</div>
          <h1 className="text-[34px] leading-[1.15] font-semibold tracking-tight mb-4">
            {t("home.hero_title")}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="lg" icon={<I.Database size={14} />} onClick={() => setAiCreateTarget("entity")}>
              {t("home.btn_entity")}
            </Button>
            <Button variant="default" size="lg" icon={<I.Layout size={14} />} onClick={() => setAiCreateTarget("page")}>
              {t("home.btn_page")}
            </Button>
            <Button variant="default" size="lg" icon={<I.Workflow size={14} />} onClick={() => setAiCreateTarget("workflow")}>
              {t("home.btn_workflow")}
            </Button>
            <Button variant="ghost" size="lg" icon={<I.Sparkles size={14} />} onClick={() => setAiCreateTarget("agent")}>
              {t("home.btn_agent")}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {stats.map((s) => {
            const IconC = I[s.icon];
            return (
              <div key={s.labelKey} className="card p-4 hover:border-hover transition-colors cursor-pointer">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-muted uppercase tracking-wider">{t(s.labelKey)}</div>
                    <div className="text-[28px] font-semibold mt-1 leading-none">{s.value}</div>
                  </div>
                  <div className={`w-8 h-8 rounded-md flex items-center justify-center ${tintBg[s.tint]}`}>
                    <IconC size={16} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-lg font-semibold">{t("home.recent_title")}</h2>
              <button className="text-xs text-muted hover:text-text">{t("home.recent_view_all")}</button>
            </div>
            <div className="card divide-y divide-border">
              {recents.length === 0 && (
                <div className="p-6 text-center text-sm text-muted">
                  {t("home.recent_empty")}
                </div>
              )}
              {recents.map((r, i) => {
                const IconC = I[r.icon] ?? I.Folder;
                return (
                  <Link key={i} to={r.to}
                        className="flex items-center gap-3 p-3 hover:bg-hover/30 cursor-pointer group">
                    <div className="w-8 h-8 rounded-md bg-panel-2 border border-border flex items-center justify-center text-muted group-hover:text-text">
                      <IconC size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-xs text-muted">
                        <span className="capitalize">{r.kind}</span>
                      </div>
                    </div>
                    <I.ChevronRight size={14} className="text-muted opacity-0 group-hover:opacity-100" />
                  </Link>
                );
              })}
            </div>

            <h2 className="text-lg font-semibold mt-8 mb-3">{t("home.templates_title")}</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {templateDefs.map((tpl) => {
                const IconC = I[tpl.icon];
                return (
                  <div key={tpl.nameKey} className="card p-4 hover:border-accent/50 cursor-pointer transition-colors group">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${tintBg[tpl.tint]}`}>
                      <IconC size={18} />
                    </div>
                    <div className="font-semibold">{t(tpl.nameKey)}</div>
                    <div className="text-xs text-muted mt-0.5">{t(tpl.descKey)}</div>
                    <div className="mt-3 text-xs text-accent opacity-0 group-hover:opacity-100 flex items-center gap-1">
                      {t("home.template_use")} <I.ArrowRight size={11} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Side rail */}
          <div className="space-y-4">
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-7 h-7 rounded-md flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))" }}>
                  <I.Sparkles size={14} className="text-white" />
                </span>
                <div className="font-semibold">{t("agent.title")}</div>
              </div>
              <p className="text-sm text-muted mb-3">
                {t("home.ai_desc")}
              </p>
              <Textarea rows={3} className="mb-2"
                placeholder={t("home.ai_placeholder")} />
              <Button variant="primary" className="w-full justify-center" icon={<I.Sparkles size={14} />} onClick={() => setAgentOpen(true)}>
                {t("home.ai_btn")}
              </Button>
            </div>

            <div className="card p-4">
              <div className="font-semibold mb-3 flex items-center gap-2">
                <I.Activity size={14} className="text-success" /> {t("home.activity_title")}
              </div>
              <ul className="space-y-2.5 text-sm">
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-success mt-1.5" />
                  <div className="flex-1">
                    <div>Workflow <b>Duyệt đơn hàng &gt; 50tr</b> chạy thành công</div>
                    <div className="text-xs text-muted">5 phút trước · DH-0142</div>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-2 mt-1.5" />
                  <div className="flex-1">
                    <div>MCP <b>crm.customer</b> đồng bộ 1,204 bản ghi</div>
                    <div className="text-xs text-muted">28 phút trước</div>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning mt-1.5" />
                  <div className="flex-1">
                    <div>Cảnh báo tồn kho thấp · 3 SKU</div>
                    <div className="text-xs text-muted">1 giờ trước</div>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent mt-1.5" />
                  <div className="flex-1">
                    <div><b>Chị Linh</b> chỉnh sửa Workflow <b>Onboarding</b></div>
                    <div className="text-xs text-muted">3 giờ trước</div>
                  </div>
                </li>
              </ul>
            </div>

            <div className="card p-4 bg-bg-soft">
              <div className="text-sm mb-3">{t("home.cmd_hint")}</div>
              <div className="flex items-center gap-1">
                <Kbd>⌘</Kbd><Kbd>K</Kbd>
              </div>
            </div>

            {/* Hướng dẫn sử dụng — file tĩnh public/huong-dan.html, mở tab mới. */}
            <a
              href="/huong-dan.html"
              target="_blank"
              rel="noopener"
              className="card p-4 flex items-center gap-3 hover:border-accent/50 transition-colors group"
            >
              <span className="w-9 h-9 rounded-md bg-accent/15 text-accent flex items-center justify-center shrink-0">
                <I.File size={16} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{t("home.guide_title")}</div>
                <div className="text-xs text-muted">{t("home.guide_desc")}</div>
              </div>
              <I.ChevronRight size={14} className="text-muted group-hover:text-accent" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({ component: Home });
