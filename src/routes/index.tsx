import { createObjectsClient } from "@erp-framework/client";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { useFavs } from "@/components/Sidebar";
import { Button, Input, Kbd, Modal, Textarea } from "@/components/ui";
import { useResolvedShortcuts } from "@/hooks/useShortcut";
import { useT } from "@/hooks/useT";
import type { IconName } from "@/lib/object-types";
import { formatCombo } from "@/lib/shortcuts";
import { useAuth } from "@/stores/auth";
import type { SidebarFavItem } from "@/stores/preferences";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

/** Mục có thể ghim (trang/đối tượng/workflow/agent/nguồn dữ liệu) cho picker. */
interface PinCandidate {
  id: string;
  label: string;
  to: string;
  iconName: IconName;
  kind: string;
}

/* URL tương đối — đi qua proxy /trpc của Vite (dev) hoặc nginx (prod). */
const api = createObjectsClient("");

type Tint = "accent" | "accent-2" | "success" | "warning";

const templateDefs: Array<{ nameKey: string; descKey: string; icon: IconName; tint: Tint }> = [
  { nameKey: "home.tpl_crm_name", descKey: "home.tpl_crm_desc", icon: "Users", tint: "accent" },
  {
    nameKey: "home.tpl_orders_name",
    descKey: "home.tpl_orders_desc",
    icon: "Cart",
    tint: "accent-2",
  },
  {
    nameKey: "home.tpl_warehouse_name",
    descKey: "home.tpl_warehouse_desc",
    icon: "Warehouse",
    tint: "success",
  },
  { nameKey: "home.tpl_hr_name", descKey: "home.tpl_hr_desc", icon: "Briefcase", tint: "warning" },
];

const tintBg: Record<string, string> = {
  accent: "bg-accent/15 text-accent",
  "accent-2": "bg-accent-2/15 text-accent-2",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
};

function getGreeting(t: (k: string) => string) {
  const h = new Date().getHours();
  return h < 11
    ? t("home.greeting_morning")
    : h < 14
      ? t("home.greeting_noon")
      : h < 18
        ? t("home.greeting_evening")
        : t("home.greeting_night");
}

/** Modal chọn mục để ghim. Click 1 mục = ghim/bỏ ghim (giữ mở để ghim nhiều). */
function PinPicker({
  open,
  onClose,
  candidates,
  isPinned,
  onToggle,
}: {
  open: boolean;
  onClose: () => void;
  candidates: PinCandidate[];
  isPinned: (id: string) => boolean;
  onToggle: (item: SidebarFavItem) => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const filtered = ql ? candidates.filter((c) => c.label.toLowerCase().includes(ql)) : candidates;
  const CAP = 200;
  const shown = filtered.slice(0, CAP);
  return (
    <Modal open={open} onClose={onClose} title={t("home.pin_modal_title")} width={520} align="top">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("home.pin_search")}
        className="mb-2"
      />
      <div className="text-xs text-muted mb-2">{t("home.pin_hint")}</div>
      <div className="max-h-[50vh] overflow-y-auto -mx-1">
        {shown.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">{t("home.pin_empty_results")}</div>
        ) : (
          shown.map((c) => {
            const IconC = I[c.iconName] ?? I.Folder;
            const pinned = isPinned(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() =>
                  onToggle({ id: c.id, label: c.label, to: c.to, iconName: c.iconName })
                }
                className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-hover/40 text-left"
              >
                <span className="w-7 h-7 rounded-md bg-panel-2 border border-border flex items-center justify-center text-muted shrink-0">
                  <IconC size={14} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm">{c.label}</span>
                  <span className="block text-[11px] text-muted">{c.kind}</span>
                </span>
                {pinned ? (
                  <I.Star size={15} className="text-warning shrink-0" />
                ) : (
                  <I.Plus size={15} className="text-muted/50 shrink-0" />
                )}
              </button>
            );
          })
        )}
        {filtered.length > CAP && (
          <div className="px-2 py-2 text-[11px] text-muted/70">
            {t("home.pin_more", { n: filtered.length - CAP })}
          </div>
        )}
      </div>
    </Modal>
  );
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
  const uDataSources = useUserObjects((s) => s.dataSources);

  // Thống kê SỐ LƯỢNG mỗi loại đối tượng low-code (đếm đủ 5 loại).
  const stats: Array<{ labelKey: string; value: number; icon: IconName; tint: Tint }> = [
    { labelKey: "sidebar.entities", value: uEntities.length, icon: "Database", tint: "accent" },
    { labelKey: "sidebar.pages", value: uPages.length, icon: "Layout", tint: "accent-2" },
    { labelKey: "sidebar.workflows", value: uWorkflows.length, icon: "Workflow", tint: "success" },
    { labelKey: "sidebar.agents", value: uAgents.length, icon: "Bot", tint: "warning" },
    {
      labelKey: "sidebar.datasources",
      value: uDataSources.length,
      icon: "Layers",
      tint: "accent",
    },
  ];

  // Số BẢN GHI theo từng đối tượng (entity) — nạp từ server 1 lần khi mở trang.
  // null = đang tải; {} = tải xong nhưng rỗng/lỗi (fail-safe).
  const [recordCounts, setRecordCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let alive = true;
    api.entities
      .recordCounts()
      .then((c) => alive && setRecordCounts(c))
      .catch(() => alive && setRecordCounts({}));
    return () => {
      alive = false;
    };
  }, []);
  // Ghép số đếm vào entity (tên + icon), sắp xếp giảm dần theo số bản ghi.
  const entityCounts = useMemo(() => {
    if (!recordCounts) return [];
    return uEntities
      .map((e) => ({ id: e.id, name: e.name, icon: e.icon, count: recordCounts[e.id] ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [recordCounts, uEntities]);
  const totalRecords = useMemo(() => entityCounts.reduce((s, e) => s + e.count, 0), [entityCounts]);

  // Phím tắt toàn cục — combo ĐÃ ÁP tuỳ chỉnh tài khoản (override) hoặc mặc định.
  // Hiển thị ở side-rail; bấm "Tuỳ chỉnh" sang /settings/shortcuts để đổi.
  const globalShortcuts = useResolvedShortcuts().filter((s) => s.category === "global");

  // Truy cập nhanh — ghim công việc thường xuyên (DÙNG CHUNG ★ với sidebar).
  const favs = useFavs();
  const [pinOpen, setPinOpen] = useState(false);
  const role = useAuth((s) => s.user?.role);
  // Danh sách mục có thể ghim. Viewer chỉ ghim Trang (như sidebar — không thấy
  // đối tượng/workflow/agent/nguồn dữ liệu).
  const pinCandidates = useMemo<PinCandidate[]>(() => {
    const items: PinCandidate[] = uPages.map((p) => ({
      id: p.id,
      label: p.name,
      to: `/pages/${p.id}`,
      iconName: p.icon,
      kind: t("sidebar.pages"),
    }));
    if (role !== "viewer") {
      items.push(
        ...uEntities.map((e) => ({
          id: e.id,
          label: e.name,
          to: `/entities/${e.id}`,
          iconName: e.icon,
          kind: t("sidebar.entities"),
        })),
        ...uWorkflows.map((w) => ({
          id: w.id,
          label: w.name,
          to: `/workflows/${w.id}`,
          iconName: w.icon,
          kind: t("sidebar.workflows"),
        })),
        ...uAgents.map((a) => ({
          id: a.id,
          label: a.name,
          to: `/agents/${a.id}`,
          iconName: "Bot" as IconName,
          kind: t("sidebar.agents"),
        })),
        ...uDataSources.map((d) => ({
          id: d.id,
          label: d.name,
          to: `/datasources/${d.id}`,
          iconName: d.icon,
          kind: t("sidebar.datasources"),
        })),
      );
    }
    return items;
  }, [role, t, uPages, uEntities, uWorkflows, uAgents, uDataSources]);

  const recents: Array<{ kind: string; name: string; icon: IconName; to: string }> = [
    ...uEntities.map((e) => ({
      kind: "Entity",
      name: e.name,
      icon: e.icon,
      to: `/entities/${e.id}`,
    })),
    ...uPages.map((p) => ({ kind: "Page", name: p.name, icon: p.icon, to: `/pages/${p.id}` })),
    ...uWorkflows.map((w) => ({
      kind: "Workflow",
      name: w.name,
      icon: w.icon,
      to: `/workflows/${w.id}`,
    })),
  ].slice(0, 6);

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1180px] mx-auto px-3 py-4 sm:px-8 sm:py-10">
        {/* Hero */}
        <div className="mb-8">
          <div className="text-sm text-muted mb-1">
            {getGreeting(t)}, {user?.name ?? ""}
          </div>
          <h1 className="text-[34px] leading-[1.15] font-semibold tracking-tight mb-4">
            {t("home.hero_title")}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="lg"
              icon={<I.Database size={14} />}
              onClick={() => setAiCreateTarget("entity")}
            >
              {t("home.btn_entity")}
            </Button>
            <Button
              variant="default"
              size="lg"
              icon={<I.Layout size={14} />}
              onClick={() => setAiCreateTarget("page")}
            >
              {t("home.btn_page")}
            </Button>
            <Button
              variant="default"
              size="lg"
              icon={<I.Workflow size={14} />}
              onClick={() => setAiCreateTarget("workflow")}
            >
              {t("home.btn_workflow")}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              icon={<I.Sparkles size={14} />}
              onClick={() => setAiCreateTarget("agent")}
            >
              {t("home.btn_agent")}
            </Button>
          </div>
        </div>

        {/* Stats — số lượng mỗi loại đối tượng */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
          {stats.map((s) => {
            const IconC = I[s.icon];
            return (
              <div
                key={s.labelKey}
                className="card p-4 hover:border-hover transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-muted uppercase tracking-wider">
                      {t(s.labelKey)}
                    </div>
                    <div className="text-[28px] font-semibold mt-1 leading-none">{s.value}</div>
                  </div>
                  <div
                    className={`w-8 h-8 rounded-md flex items-center justify-center ${tintBg[s.tint]}`}
                  >
                    <IconC size={16} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Truy cập nhanh — ghim công việc thường xuyên (dùng chung ★ với sidebar) */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">{t("home.pinned_title")}</h2>
            <Button
              variant="default"
              size="sm"
              icon={<I.Star size={13} />}
              onClick={() => setPinOpen(true)}
            >
              {t("home.pinned_add")}
            </Button>
          </div>
          {favs.favs.length === 0 ? (
            <button
              type="button"
              onClick={() => setPinOpen(true)}
              className="card w-full p-6 text-center text-sm text-muted hover:border-accent/50 transition-colors"
            >
              {t("home.pinned_empty")}
            </button>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {favs.favs.map((f) => {
                const IconC = I[f.iconName as IconName] ?? I.Star;
                return (
                  <div key={f.id} className="relative group">
                    <Link
                      to={f.to}
                      className="card p-3 flex items-center gap-3 hover:border-accent/50 transition-colors"
                    >
                      <span className="w-9 h-9 rounded-md bg-accent/15 text-accent flex items-center justify-center shrink-0">
                        <IconC size={16} />
                      </span>
                      <span className="font-medium truncate flex-1 min-w-0 pr-4">{f.label}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => favs.remove(f.id)}
                      className="absolute right-1.5 top-1.5 w-5 h-5 rounded-sm flex items-center justify-center text-muted/40 hover:text-danger hover:bg-hover/80 opacity-0 group-hover:opacity-100 transition-opacity"
                      title={t("home.pinned_remove")}
                    >
                      <I.X size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-semibold">{t("home.recent_title")}</h2>
              <button type="button" className="text-xs text-muted hover:text-text">
                {t("home.recent_view_all")}
              </button>
            </div>
            <div className="card divide-y divide-border">
              {recents.length === 0 && (
                <div className="p-6 text-center text-sm text-muted">{t("home.recent_empty")}</div>
              )}
              {recents.map((r, i) => {
                const IconC = I[r.icon] ?? I.Folder;
                return (
                  <Link
                    // biome-ignore lint/suspicious/noArrayIndexKey: list ổn định, không reorder
                    key={i}
                    to={r.to}
                    className="flex items-center gap-3 p-3 hover:bg-hover/30 cursor-pointer group"
                  >
                    <div className="w-8 h-8 rounded-md bg-panel-2 border border-border flex items-center justify-center text-muted group-hover:text-text">
                      <IconC size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-xs text-muted">
                        <span className="capitalize">{r.kind}</span>
                      </div>
                    </div>
                    <I.ChevronRight
                      size={14}
                      className="text-muted opacity-0 group-hover:opacity-100"
                    />
                  </Link>
                );
              })}
            </div>

            {/* Bản ghi theo đối tượng — số record thực tế trong từng entity */}
            <div className="flex items-baseline justify-between mt-4 mb-2">
              <h2 className="text-sm font-semibold">{t("home.records_title")}</h2>
              {recordCounts && entityCounts.length > 0 && (
                <span className="text-xs text-muted">
                  {t("home.records_total", { n: totalRecords.toLocaleString("vi-VN") })}
                </span>
              )}
            </div>
            <div className="card">
              {recordCounts === null ? (
                <div className="p-6 text-center text-sm text-muted">
                  {t("home.records_loading")}
                </div>
              ) : entityCounts.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted">{t("home.records_empty")}</div>
              ) : (
                <div className="max-h-[360px] overflow-y-auto divide-y divide-border">
                  {entityCounts.map((e) => {
                    const IconC = I[e.icon] ?? I.Database;
                    return (
                      <Link
                        key={e.id}
                        to="/entities/$id"
                        params={{ id: e.id }}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-hover/30 cursor-pointer group"
                      >
                        <div className="w-7 h-7 rounded-md bg-panel-2 border border-border flex items-center justify-center text-muted group-hover:text-text">
                          <IconC size={14} />
                        </div>
                        <span className="flex-1 min-w-0 truncate text-sm">{e.name}</span>
                        <span className="text-sm font-semibold tabular-nums">
                          {e.count.toLocaleString("vi-VN")}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            <h2 className="text-sm font-semibold mt-4 mb-2">{t("home.templates_title")}</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {templateDefs.map((tpl) => {
                const IconC = I[tpl.icon];
                return (
                  <div
                    key={tpl.nameKey}
                    className="card p-4 hover:border-accent/50 cursor-pointer transition-colors group"
                  >
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${tintBg[tpl.tint]}`}
                    >
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
                <span
                  className="w-7 h-7 rounded-md flex items-center justify-center"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
                  }}
                >
                  <I.Sparkles size={14} className="text-white" />
                </span>
                <div className="font-semibold">{t("agent.title")}</div>
              </div>
              <p className="text-sm text-muted mb-3">{t("home.ai_desc")}</p>
              <Textarea rows={3} className="mb-2" placeholder={t("home.ai_placeholder")} />
              <Button
                variant="primary"
                className="w-full justify-center"
                icon={<I.Sparkles size={14} />}
                onClick={() => setAgentOpen(true)}
              >
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
                    <div>
                      Workflow <b>Duyệt đơn hàng &gt; 50tr</b> chạy thành công
                    </div>
                    <div className="text-xs text-muted">5 phút trước · DH-0142</div>
                  </div>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-2 mt-1.5" />
                  <div className="flex-1">
                    <div>
                      MCP <b>crm.customer</b> đồng bộ 1,204 bản ghi
                    </div>
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
                    <div>
                      <b>Chị Linh</b> chỉnh sửa Workflow <b>Onboarding</b>
                    </div>
                    <div className="text-xs text-muted">3 giờ trước</div>
                  </div>
                </li>
              </ul>
            </div>

            {/* Phím tắt — combo thực tế (đã áp tuỳ chỉnh tài khoản), link sang cấu hình */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold flex items-center gap-2">
                  <I.Command size={14} className="text-accent" /> {t("home.shortcuts_title")}
                </div>
                <Link
                  to="/settings/shortcuts"
                  className="text-xs text-muted hover:text-accent transition-colors"
                >
                  {t("home.shortcuts_customize")}
                </Link>
              </div>
              <ul className="space-y-2">
                {globalShortcuts.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted truncate">{s.label}</span>
                    <Kbd>{formatCombo(s.combo)}</Kbd>
                  </li>
                ))}
              </ul>
              <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between gap-3 text-xs text-muted">
                <span className="truncate">{t("home.shortcuts_palette_alt")}</span>
                <Kbd>/</Kbd>
              </div>
            </div>

            {/* Hướng dẫn sử dụng — file tĩnh public/huong-dan.html, mở tab mới. */}
            <a
              href="/huong-dan.html"
              target="_blank"
              rel="noreferrer noopener"
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

        <PinPicker
          open={pinOpen}
          onClose={() => setPinOpen(false)}
          candidates={pinCandidates}
          isPinned={favs.isFav}
          onToggle={favs.toggle}
        />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({ component: Home });
