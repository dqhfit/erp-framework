import { I } from "@/components/Icons";
import { Button, Card, Chip, Input, Select } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { dialog } from "@/lib/dialog";
import { formatUsd } from "@/lib/pricing";
import { createObjectsClient } from "@erp-framework/client";
/* ==========================================================
   activity — Dashboard Nhật ký & Chi phí. Đọc bảng activity_log
   trên server qua objects.activity. Server ghi log khi chạy
   workflow (run-workflow.ts); nguồn log mở rộng dần.
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

const objects = createObjectsClient("");

interface ActivityRow {
  id: string;
  at: string | Date;
  kind: string;
  objectType?: string | null;
  target?: string | null;
  detail: string;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  model?: string | null;
  cost?: number | null;
}

const KIND_KEY: Record<string, string> = {
  create: "activity.kind_create",
  update: "activity.kind_update",
  delete: "activity.kind_delete",
  run_workflow: "activity.kind_run_workflow",
  run_agent: "activity.kind_run_agent",
  mcp_call: "activity.kind_mcp_call",
  login: "activity.kind_login",
  error: "activity.kind_error",
};
const kindLabel = (t: (k: string) => string, k: string) => t(KIND_KEY[k] ?? k);
const KIND_VARIANT: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  create: "success",
  update: "accent",
  delete: "warning",
  run_workflow: "accent",
  run_agent: "accent",
  mcp_call: "default",
  login: "default",
  error: "danger",
};
const kindVariant = (k: string) => KIND_VARIANT[k] ?? "default";

function fmtTime(ts: string | Date): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="flex-1">
      <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
    </Card>
  );
}

function ActivityDashboard() {
  const t = useT();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [budget, setBudget] = useState<{ monthlyUsd: number; usedUsd: number }>({
    monthlyUsd: 0,
    usedUsd: 0,
  });
  const [budgetInput, setBudgetInput] = useState("");

  const reload = useCallback(() => {
    setLoading(true);
    objects.activity
      .list()
      .then((r) => {
        setRows(r as ActivityRow[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    objects.budget
      .get()
      .then((b) => {
        setBudget(b);
        setBudgetInput(String(b.monthlyUsd));
      })
      .catch(() => {
        /* chưa đăng nhập / lỗi mạng */
      });
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const saveBudget = async () => {
    const v = Number(budgetInput);
    if (!Number.isFinite(v) || v < 0) return;
    await objects.budget.save(v).catch(() => {});
    reload();
  };
  const overBudget = budget.monthlyUsd > 0 && budget.usedUsd >= budget.monthlyUsd;

  const totalCost = rows.reduce((s, e) => s + (e.cost ?? 0), 0);
  const tokIn = rows.reduce((s, e) => s + (e.tokensInput ?? 0), 0);
  const tokOut = rows.reduce((s, e) => s + (e.tokensOutput ?? 0), 0);
  const withTokens = rows.filter((e) => e.tokensInput || e.tokensOutput).length;
  const kinds = [...new Set(rows.map((e) => e.kind))];
  const shown = filter === "all" ? rows : rows.filter((e) => e.kind === filter);

  const handleClear = async () => {
    const ok = await dialog.confirm(t("activity.clear_confirm"), {
      title: t("activity.clear_title"),
      confirmText: t("activity.clear_confirm_btn"),
      danger: true,
    });
    if (!ok) return;
    await objects.activity.clear().catch(() => {});
    reload();
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1000px] mx-auto p-8">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold">{t("activity.title")}</h1>
          {rows.length > 0 && (
            <Button variant="danger" icon={<I.Trash size={13} />} onClick={handleClear}>
              {t("activity.clear_btn")}
            </Button>
          )}
        </div>
        <div className="text-sm text-muted mb-5">
          {t("activity.subtitle")}
        </div>

        <div className="flex gap-3 mb-5">
          <Stat
            label={t("activity.stat_cost")}
            value={formatUsd(totalCost)}
            sub={t("activity.stat_tokens_used", { count: String(withTokens) })}
          />
          <Stat label={t("activity.stat_token_in")} value={tokIn.toLocaleString("vi-VN")} />
          <Stat label={t("activity.stat_token_out")} value={tokOut.toLocaleString("vi-VN")} />
          <Stat label={t("activity.stat_events")} value={rows.length.toLocaleString("vi-VN")} />
        </div>

        {/* Ngân sách tháng — chặn cứng khi vượt */}
        <Card className="mb-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs text-muted uppercase tracking-wide">{t("activity.budget_label")}</div>
              <div className="text-sm mt-1">
                {t("activity.budget_used")} <b>{formatUsd(budget.usedUsd)}</b>
                {budget.monthlyUsd > 0 ? (
                  <>
                    {" "}
                    {" / "} {t("activity.budget_limit")} <b>{formatUsd(budget.monthlyUsd)}</b>
                  </>
                ) : (
                  <>
                    {" "}
                    {" · "}
                    <span className="text-muted">{t("activity.budget_no_limit")}</span>
                  </>
                )}
              </div>
              {overBudget && (
                <div className="mt-1">
                  <Chip variant="danger">{t("activity.budget_over")}</Chip>
                </div>
              )}
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="text-xs text-muted block mb-1">
                  {t("activity.budget_field_label")}
                </label>
                <Input
                  type="number"
                  min="0"
                  className="w-40"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                />
              </div>
              <Button variant="primary" onClick={saveBudget}>
                {t("activity.budget_save_btn")}
              </Button>
            </div>
          </div>
        </Card>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm text-muted">{t("activity.filter_label")}</span>
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-48">
            <option value="all">{t("activity.filter_all")}</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {kindLabel(t, k)}
              </option>
            ))}
          </Select>
        </div>

        {shown.length === 0 ? (
          <Card>
            <div className="text-center text-muted py-12 text-sm">
              {loading ? t("activity.loading") : t("activity.empty")}
            </div>
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-xs uppercase tracking-wide border-b border-border">
                  <th className="text-left py-2 px-3 font-semibold">{t("activity.col_time")}</th>
                  <th className="text-left py-2 px-3 font-semibold">{t("activity.col_type")}</th>
                  <th className="text-left py-2 px-3 font-semibold">{t("activity.col_detail")}</th>
                  <th className="text-right py-2 px-3 font-semibold">{t("activity.col_token")}</th>
                  <th className="text-right py-2 px-3 font-semibold">{t("activity.col_cost")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0 hover:bg-hover/40">
                    <td className="py-2 px-3 text-muted whitespace-nowrap font-mono text-xs">
                      {fmtTime(e.at)}
                    </td>
                    <td className="py-2 px-3">
                      <Chip variant={kindVariant(e.kind)}>{kindLabel(t, e.kind)}</Chip>
                    </td>
                    <td className="py-2 px-3">
                      <div>{e.detail}</div>
                      {e.target && (
                        <div className="text-xs text-muted">
                          {e.objectType ? `${e.objectType}: ` : ""}
                          {e.target}
                          {e.model ? ` · ${e.model}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs text-muted whitespace-nowrap">
                      {e.tokensInput || e.tokensOutput
                        ? `${e.tokensInput ?? 0}/${e.tokensOutput ?? 0}`
                        : "—"}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-xs whitespace-nowrap">
                      {e.cost != null ? formatUsd(e.cost) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/activity")({ component: ActivityDashboard });
