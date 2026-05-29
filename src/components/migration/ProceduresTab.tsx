/* ==========================================================
   ProceduresTab — Tab "Procedures" trong settings.migration.
   Liệt kê proc lọc theo bảng đã migrate + filter + AI classify
   + per-proc codegen Tier B (procedure) / C (workflow) / D (plugin).
   ========================================================== */
import { createMigrationClient } from "@erp-framework/client";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Input, Select } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { toast } from "@/lib/toast";

const migration = createMigrationClient("");

type FilterMode = "all" | "reads-only";
type SortBy = "complexity-asc" | "complexity-desc" | "name";

type ProcRow = Awaited<ReturnType<typeof migration.listProcsToMigrate>>["rows"][number];

const CATEGORY_LABELS: Record<string, string> = {
  create: "Tạo (Create)",
  read: "Đọc (Read)",
  update: "Sửa (Update)",
  delete: "Xoá (Delete)",
  report: "Báo cáo",
  validation: "Kiểm tra (Validation)",
  calculation: "Tính toán",
  workflow: "Workflow",
  trigger: "Trigger",
  batch: "Batch",
  unknown: "Chưa rõ",
};

const TIER_COLORS: Record<string, string> = {
  B: "bg-accent/15 text-accent border-accent/30",
  C: "bg-warning/15 text-warning border-warning/30",
  D: "bg-danger/15 text-danger border-danger/30",
};

interface Props {
  moduleName: string;
  onChanged: () => void;
}

type ClassifyMode = "skip-existing" | "if-stale" | "force";

export function ProceduresTab({ moduleName, onChanged }: Props) {
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [activeDays, setActiveDays] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("complexity-asc");
  const [includeBlocked, setIncludeBlocked] = useState(false);
  const [classifyMode, setClassifyMode] = useState<ClassifyMode>("skip-existing");
  const [data, setData] = useState<Awaited<ReturnType<typeof migration.listProcsToMigrate>> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [classifying, setClassifying] = useState(false);

  const reload = () => {
    setLoading(true);
    setErr("");
    migration
      .listProcsToMigrate({
        module: moduleName,
        filterMode,
        activeWithinDays: activeDays,
        sortBy,
        includeBlocked,
      })
      .then((d) => setData(d))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload deps đã đủ
  useEffect(() => {
    reload();
  }, [moduleName, filterMode, activeDays, sortBy, includeBlocked]);

  const toggleSelect = (name: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAllShown = () => {
    if (!data) return;
    if (selected.size === data.rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.rows.map((r) => r.name)));
    }
  };

  const runClassify = async () => {
    const target =
      selected.size > 0 ? `${selected.size} proc đã chọn` : "tất cả proc đang hiển thị";
    const modeLabel =
      classifyMode === "skip-existing"
        ? "(bỏ qua proc đã phân loại)"
        : classifyMode === "if-stale"
          ? "(chạy lại nếu body MSSQL đổi)"
          : "(force — chạy lại tất cả)";
    const ok = await dialog.confirm(`Classify ${target} ${modeLabel}?`, {
      title: "AI phân loại nghiệp vụ",
    });
    if (!ok) return;
    setClassifying(true);
    try {
      const res = await migration.classifyProcsAi({
        module: moduleName,
        names: selected.size > 0 ? Array.from(selected) : [],
        mode: classifyMode,
      });
      const parts: string[] = [];
      if (res.classified > 0) parts.push(`${res.classified} mới classify`);
      if (res.skipped > 0) parts.push(`${res.skipped} bỏ qua`);
      const cached = (res as { cached?: number }).cached ?? 0;
      if (cached > 0) parts.push(`${cached} từ cache`);
      toast.success(parts.length > 0 ? parts.join(", ") : "Không có proc nào được classify.");
      reload();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setClassifying(false);
    }
  };

  const setCategory = async (procName: string, category: string | null) => {
    try {
      await migration.setProcCategory({
        module: moduleName,
        procName,
        category: (category as Parameters<typeof migration.setProcCategory>[0]["category"]) ?? null,
      });
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="p-4 space-y-4 overflow-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold">Stored procedures</h2>
          <p className="text-xs text-muted mt-0.5">
            Lọc proc theo bảng đã migrate, AI phân loại nghiệp vụ, codegen sang procedure / workflow
            / plugin.
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          icon={<I.Loader size={12} />}
          onClick={reload}
          disabled={loading}
        >
          {loading ? "Đang tải…" : "Tải lại"}
        </Button>
      </div>

      <div className="card p-3 space-y-2">
        <div className="text-[11px] uppercase text-muted tracking-wider font-semibold">Bộ lọc</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
          <label className="space-y-1">
            <div className="text-xs text-muted">Chế độ migrate</div>
            <Select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as FilterMode)}
            >
              <option value="all">Đủ reads + writes đã migrate</option>
              <option value="reads-only">Chỉ cần reads đã migrate</option>
            </Select>
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted">Active trong (ngày)</div>
            <Input
              type="number"
              min="0"
              max="3650"
              value={String(activeDays)}
              onChange={(e) => setActiveDays(Number(e.target.value) || 0)}
              placeholder="0 = bỏ filter"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted">Sắp xếp</div>
            <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
              <option value="complexity-asc">Đơn giản → phức tạp</option>
              <option value="complexity-desc">Phức tạp → đơn giản</option>
              <option value="name">Tên A-Z</option>
            </Select>
          </label>
          <label className="flex items-center gap-2 mt-5">
            <input
              type="checkbox"
              checked={includeBlocked}
              onChange={(e) => setIncludeBlocked(e.target.checked)}
            />
            <span className="text-xs">Hiển thị proc blocked</span>
          </label>
        </div>
        {data && (
          <div className="text-[11px] text-muted flex items-center gap-3 flex-wrap pt-1 border-t border-border">
            <span>Tổng: {data.counts.total}</span>
            <span className="text-success">Ready: {data.counts.ready}</span>
            <span className="text-warning">Partial: {data.counts.partial}</span>
            <span className="text-danger">Blocked: {data.counts.blocked}</span>
            <span>Hiển thị: {data.counts.shown}</span>
            <span>Bảng đã migrate: {data.migratedTableCount}</span>
          </div>
        )}
      </div>

      {err && <div className="card p-3 text-xs text-danger border-danger/40">{err}</div>}

      {data && data.rows.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="default"
            icon={<I.CheckSq size={12} />}
            onClick={selectAllShown}
          >
            {selected.size === data.rows.length ? "Bỏ chọn" : "Chọn tất cả"}
          </Button>
          <Select
            value={classifyMode}
            onChange={(e) => setClassifyMode(e.target.value as ClassifyMode)}
            className="h-7! text-[11px]! py-0! w-auto!"
            title="Chế độ chạy AI khi click 'AI phân loại'"
          >
            <option value="skip-existing">Bỏ qua đã classify</option>
            <option value="if-stale">Chỉ chạy nếu body đổi</option>
            <option value="force">Force chạy lại tất cả</option>
          </Select>
          <Button
            size="sm"
            variant="primary"
            icon={<I.Sparkles size={12} />}
            onClick={runClassify}
            disabled={classifying}
          >
            {classifying ? "Đang phân loại…" : `AI phân loại (${selected.size || "tất cả"})`}
          </Button>
        </div>
      )}

      {data && data.rows.length === 0 && (
        <div className="card p-6 text-center text-sm text-muted">
          Không có proc nào thoả bộ lọc. Thử bật "Chỉ cần reads đã migrate" hoặc tắt filter Active.
        </div>
      )}

      {data && data.rows.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-bg-soft border-b border-border">
              <tr>
                <th className="px-2 py-1.5 text-left w-8" />
                <th className="px-2 py-1.5 text-left">Proc</th>
                <th className="px-2 py-1.5 text-left">Nghiệp vụ</th>
                <th className="px-2 py-1.5 text-left">Tier</th>
                <th className="px-2 py-1.5 text-right">Complexity</th>
                <th className="px-2 py-1.5 text-left">Reads/Writes</th>
                <th className="px-2 py-1.5 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <ProcRowDisplay
                  key={r.name}
                  row={r}
                  module={moduleName}
                  selected={selected.has(r.name)}
                  onToggle={() => toggleSelect(r.name)}
                  onSetCategory={(cat) => setCategory(r.name, cat)}
                  onAfterAction={() => {
                    reload();
                    onChanged();
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProcRowDisplay({
  row,
  module,
  selected,
  onToggle,
  onSetCategory,
  onAfterAction,
}: {
  row: ProcRow;
  module: string;
  selected: boolean;
  onToggle: () => void;
  onSetCategory: (category: string | null) => void;
  onAfterAction: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewGraph, setPreviewGraph] = useState<unknown>(null);
  const [previewErr, setPreviewErr] = useState("");

  const filterColor =
    row.filterStatus === "ready"
      ? "bg-success/15 text-success border-success/30"
      : row.filterStatus === "partial"
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-danger/15 text-danger border-danger/30";

  const tierKlass = TIER_COLORS[row.suggestedTier] ?? "bg-bg-soft text-muted border-border";

  const runWorkflowDryRun = async () => {
    setBusy(true);
    setPreviewErr("");
    setPreviewGraph(null);
    try {
      const res = await migration.codegenProcWorkflowDryRun({
        module,
        procName: row.name,
      });
      if (!res.ok) {
        setPreviewErr((res as { error?: string }).error ?? "Codegen workflow fail");
      } else {
        setPreviewGraph(res.graph);
      }
    } catch (e) {
      setPreviewErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runWorkflowApply = async (forceOverwrite = false) => {
    if (!previewGraph) return;
    setBusy(true);
    try {
      const res = await migration.codegenProcWorkflowApply({
        module,
        procName: row.name,
        graph: previewGraph as { nodes: unknown[]; edges: unknown[] },
        overwriteIfExists: forceOverwrite,
      });
      if (res.reused) {
        // Workflow đã tồn tại — hỏi user có muốn ghi đè không.
        const ok = await dialog.confirm(
          `Workflow "${res.workflowName}" đã tồn tại (có thể bạn đã sửa thủ công). Ghi đè graph mới sẽ MẤT các sửa đổi đó. Tiếp tục?`,
          { title: "Workflow đã tồn tại", danger: true },
        );
        if (!ok) {
          toast.info(`Giữ nguyên workflow "${res.workflowName}" cũ.`);
          onAfterAction();
          return;
        }
        // User chọn ghi đè → gọi lại với flag.
        const res2 = await migration.codegenProcWorkflowApply({
          module,
          procName: row.name,
          graph: previewGraph as { nodes: unknown[]; edges: unknown[] },
          overwriteIfExists: true,
        });
        toast.success(`Đã ghi đè workflow "${res2.workflowName}".`);
      } else {
        toast.success(`Workflow "${res.workflowName}" đã được tạo.`);
      }
      onAfterAction();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <tr
        className={`border-b border-border/40 hover:bg-bg-soft/50 ${
          row.filterStatus === "blocked" ? "opacity-60" : ""
        }`}
      >
        <td className="px-2 py-1.5">
          <input type="checkbox" checked={selected} onChange={onToggle} />
        </td>
        <td className="px-2 py-1.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 font-mono text-[11px] text-text hover:text-accent"
          >
            <I.ChevronRight
              size={10}
              className={`transition-transform ${expanded ? "rotate-90" : ""}`}
            />
            {row.name}
          </button>
          {row.label && <div className="text-[10px] text-muted mt-0.5">{row.label}</div>}
        </td>
        <td className="px-2 py-1.5">
          <Select
            value={row.businessCategory ?? ""}
            onChange={(e) => onSetCategory(e.target.value || null)}
            className="text-[11px]! h-7! py-0! px-1.5!"
          >
            <option value="">— chưa phân loại —</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          {row.businessCategoryConfidence != null && (
            <div className="text-[10px] text-muted mt-0.5">
              AI confidence: {(row.businessCategoryConfidence * 100).toFixed(0)}%
            </div>
          )}
        </td>
        <td className="px-2 py-1.5">
          <span
            className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${tierKlass}`}
          >
            {row.suggestedTier}
          </span>
        </td>
        <td className="px-2 py-1.5 text-right font-mono text-[11px]">{row.complexity}</td>
        <td className="px-2 py-1.5">
          <div className="text-[10px] text-muted">
            R: {row.reads.length}, W: {row.writes.length}
          </div>
          {row.missingTables.length > 0 && (
            <div className="text-[10px] text-danger mt-0.5">
              Missing: {row.missingTables.slice(0, 2).join(", ")}
              {row.missingTables.length > 2 ? ` +${row.missingTables.length - 2}` : ""}
            </div>
          )}
        </td>
        <td className="px-2 py-1.5">
          <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${filterColor}`}>
            {row.filterStatus}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-bg-soft/30 border-b border-border/40">
          <td colSpan={7} className="p-3">
            <div className="space-y-2">
              {row.description && (
                <div className="text-xs">
                  <span className="text-muted">Mô tả:</span> {row.description}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                <div>
                  <div className="text-muted mb-1">Reads</div>
                  <div className="font-mono">{row.reads.length ? row.reads.join(", ") : "—"}</div>
                </div>
                <div>
                  <div className="text-muted mb-1">Writes</div>
                  <div className="font-mono">{row.writes.length ? row.writes.join(", ") : "—"}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2 border-t border-border flex-wrap">
                <Button
                  size="sm"
                  variant="default"
                  icon={<I.Workflow size={12} />}
                  onClick={runWorkflowDryRun}
                  disabled={busy || row.filterStatus === "blocked"}
                  title="AI sinh workflow graph từ T-SQL"
                >
                  {busy ? "Đang sinh…" : "Codegen → Workflow (Tier C)"}
                </Button>
                {previewGraph != null && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<I.Check size={12} />}
                    onClick={() => runWorkflowApply()}
                    disabled={busy}
                  >
                    Áp dụng vào workflows
                  </Button>
                )}
              </div>
              {previewErr && <div className="text-xs text-danger">⚠ {previewErr}</div>}
              {previewGraph != null && (
                <details className="border border-border rounded p-2">
                  <summary className="text-xs cursor-pointer text-muted hover:text-text">
                    Preview workflow graph (JSON)
                  </summary>
                  <pre className="text-[10px] font-mono mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(previewGraph, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
