/* ==========================================================
   RunAllProcsScreen — Screen "Migrate proc".
   Liệt kê proc đã sẵn sàng migrate (reads/writes ⊆ bảng đã
   migrate) trên TẤT CẢ module YAML. Bulk classify + bulk
   codegen Tier C workflow theo lựa chọn.

   Idempotent: tận dụng classifyMode + overwriteIfExists của
   các endpoint per-module, chạy lại không drift kết quả.
   ========================================================== */
import { createMigrationClient } from "@erp-framework/client";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Input, Modal, Select, Textarea } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { toast } from "@/lib/toast";

const migration = createMigrationClient("");

type ListData = Awaited<ReturnType<typeof migration.listAllProcsToMigrate>>;
type ProcRow = ListData["rowsByModule"][string][number];
type ClassifyMode = "skip-existing" | "if-stale" | "force";

/** Nhật ký 1 dòng — append vào runLogs trong suốt session. */
interface RunLogEntry {
  id: string;
  at: string;
  /** Bước trong flow runMigrateAll. "info" cho header/footer phụ. */
  step: "1/3" | "2/3" | "3/3" | "info";
  /** Hành động: classify proc, codegen workflow, apply FK, hoặc info. */
  action: "classify" | "workflow" | "fk" | "info";
  /** Target text: tên module, tên proc, hoặc entity.field. */
  target: string;
  /** Kết quả: started/success/skipped/cached/noop/failed. */
  result: "started" | "success" | "skipped" | "cached" | "noop" | "failed";
  /** Mô tả thêm — vd error message hay counts. */
  detail?: string;
}

const RESULT_COLORS: Record<RunLogEntry["result"], string> = {
  started: "text-accent",
  success: "text-success",
  skipped: "text-muted",
  cached: "text-muted italic",
  noop: "text-muted italic",
  failed: "text-danger",
};

const RESULT_BADGE: Record<RunLogEntry["result"], string> = {
  started: "▶",
  success: "✓",
  skipped: "↷",
  cached: "⟲",
  noop: "≡",
  failed: "✗",
};

const TIER_COLORS: Record<string, string> = {
  B: "bg-accent/15 text-accent border-accent/30",
  C: "bg-warning/15 text-warning border-warning/30",
  D: "bg-danger/15 text-danger border-danger/30",
};

interface Props {
  onClose: () => void;
}

export function RunAllProcsScreen({ onClose }: Props) {
  const [filterMode, setFilterMode] = useState<"all" | "reads-only">("all");
  const [activeDays, setActiveDays] = useState(0);
  const [sortBy, setSortBy] = useState<"complexity-asc" | "complexity-desc" | "name">(
    "complexity-asc",
  );
  const [moduleFilter, setModuleFilter] = useState("");
  const [procNameFilter, setProcNameFilter] = useState("");
  const [classifyMode, setClassifyMode] = useState<ClassifyMode>("skip-existing");
  const [data, setData] = useState<ListData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  /** key = "module::procName" */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [runStatus, setRunStatus] = useState<{
    busy: boolean;
    label: string;
    current: number;
    total: number;
  }>({ busy: false, label: "", current: 0, total: 0 });

  /** Modal xem nội dung proc. */
  const [viewProc, setViewProc] = useState<{ module: string; name: string } | null>(null);
  const [viewProcData, setViewProcData] = useState<{
    loading: boolean;
    body: string | null;
    params: Array<{ name: string; dataType: string; isOutput: boolean }> | null;
    error: string | null;
  }>({ loading: false, body: null, params: null, error: null });

  const openViewProc = (module: string, name: string) => {
    setViewProc({ module, name });
    setViewProcData({ loading: true, body: null, params: null, error: null });
    migration
      .previewProc(name)
      .then((res) => {
        if (!res.proc) {
          setViewProcData({
            loading: false,
            body: null,
            params: null,
            error: "Không tìm thấy proc trong MSSQL.",
          });
        } else {
          setViewProcData({
            loading: false,
            body: res.proc.body,
            params: res.proc.parameters,
            error: null,
          });
        }
      })
      .catch((e: Error) => {
        setViewProcData({ loading: false, body: null, params: null, error: e.message });
      });
  };

  /** Panel tạo quan hệ từ SQL. */
  type SqlRelHint = {
    sourceEntityId: string;
    sourceEntityName: string;
    sourceEntityLabel: string;
    sourceField: string;
    sourceFieldLabel: string;
    targetEntityId: string;
    targetEntityName: string;
    targetEntityLabel: string;
    targetField: string;
    applied: boolean;
  };
  const [sqlRelPanel, setSqlRelPanel] = useState(false);
  const [sqlRelInput, setSqlRelInput] = useState("");
  const [sqlRelLoading, setSqlRelLoading] = useState(false);
  const [sqlRelResult, setSqlRelResult] = useState<{
    joinPairsTotal: number;
    hints: SqlRelHint[];
    unmappedTables: string[];
  } | null>(null);
  const [sqlRelErr, setSqlRelErr] = useState("");
  const [sqlRelSelected, setSqlRelSelected] = useState<Set<string>>(new Set());
  const [sqlRelApplying, setSqlRelApplying] = useState(false);

  const sqlRelKey = (h: SqlRelHint) => `${h.sourceEntityId}|${h.sourceField}|${h.targetEntityId}`;

  const runAnalyzeSql = () => {
    if (!sqlRelInput.trim()) return;
    setSqlRelLoading(true);
    setSqlRelErr("");
    setSqlRelResult(null);
    setSqlRelSelected(new Set());
    migration
      .analyzeRelationsFromSql(sqlRelInput)
      .then((res) => {
        setSqlRelResult(res);
        // Tự chọn sẵn những hint chưa apply.
        setSqlRelSelected(new Set(res.hints.filter((h) => !h.applied).map(sqlRelKey)));
      })
      .catch((e: Error) => setSqlRelErr(e.message))
      .finally(() => setSqlRelLoading(false));
  };

  const toggleSqlRelHint = (key: string) => {
    setSqlRelSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const applySqlRelHints = async () => {
    if (!sqlRelResult) return;
    const toApply = sqlRelResult.hints.filter((h) => sqlRelSelected.has(sqlRelKey(h)));
    if (toApply.length === 0) return;
    setSqlRelApplying(true);
    let ok = 0;
    let fail = 0;
    for (const h of toApply) {
      try {
        await migration.applyRelationHint({
          sourceEntityId: h.sourceEntityId,
          sourceField: h.sourceField,
          targetEntityId: h.targetEntityId,
        });
        ok++;
      } catch {
        fail++;
      }
    }
    setSqlRelApplying(false);
    toast.success(`Đã áp dụng ${ok} quan hệ${fail > 0 ? `, ${fail} lỗi` : ""}.`);
    // Re-analyze để cập nhật trạng thái applied.
    runAnalyzeSql();
  };

  /** Nhật ký chạy — append-only trong session, giữ lại sau khi runMigrateAll
   *  hoàn thành để user review từng bước (ngược với progress bar chỉ hiện
   *  bước CURRENT). */
  const [runLogs, setRunLogs] = useState<RunLogEntry[]>([]);
  const appendLog = (entry: Omit<RunLogEntry, "id" | "at">) => {
    setRunLogs((cur) => [
      ...cur,
      {
        ...entry,
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        at: new Date().toISOString(),
      },
    ]);
  };
  const clearLogs = () => setRunLogs([]);
  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(runLogs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `migration-log-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reload = () => {
    setLoading(true);
    setErr("");
    migration
      .listAllProcsToMigrate({
        filterMode,
        activeWithinDays: activeDays,
        sortBy,
        includeBlocked: false,
        moduleFilter: moduleFilter.trim() || undefined,
      })
      .then(setData)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps đủ
  useEffect(() => {
    reload();
  }, [filterMode, activeDays, sortBy, moduleFilter]);

  const allRows = useMemo<Array<{ module: string; row: ProcRow }>>(() => {
    if (!data) return [];
    const out: Array<{ module: string; row: ProcRow }> = [];
    for (const m of data.modules) {
      for (const row of data.rowsByModule[m] ?? []) {
        out.push({ module: m, row });
      }
    }
    return out;
  }, [data]);

  const keyOf = (module: string, name: string) => `${module}::${name}`;

  /** allRows sau khi lọc thêm theo tên proc (client-side). */
  const filteredRows = useMemo(() => {
    const term = procNameFilter.trim().toLowerCase();
    if (!term) return allRows;
    return allRows.filter(({ row }) => row.name.toLowerCase().includes(term));
  }, [allRows, procNameFilter]);

  /** Các keys hiển thị hiện tại (đã lọc). */
  const filteredKeys = useMemo(
    () => new Set(filteredRows.map(({ module, row }) => keyOf(module, row.name))),
    [filteredRows],
  );

  const toggleAll = () => {
    const allFilteredSelected = filteredRows.every(({ module, row }) =>
      selected.has(keyOf(module, row.name)),
    );
    if (allFilteredSelected) {
      setSelected((cur) => {
        const next = new Set(cur);
        for (const k of filteredKeys) next.delete(k);
        return next;
      });
    } else {
      setSelected((cur) => new Set([...cur, ...filteredKeys]));
    }
  };

  const toggleModule = (m: string, moduleRows: ProcRow[]) => {
    const allSel = moduleRows.every((r) => selected.has(keyOf(m, r.name)));
    setSelected((cur) => {
      const next = new Set(cur);
      if (allSel) for (const r of moduleRows) next.delete(keyOf(m, r.name));
      else for (const r of moduleRows) next.add(keyOf(m, r.name));
      return next;
    });
  };

  const toggle = (module: string, name: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      const k = keyOf(module, name);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  /** Group selected procs theo module để gọi classifyProcsAi per-module. */
  const selectedByModule = (): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const k of selected) {
      const [module, procName] = k.split("::");
      if (!module || !procName) continue;
      if (!out[module]) out[module] = [];
      out[module].push(procName);
    }
    return out;
  };

  const runClassifyAll = async () => {
    const groups = selectedByModule();
    const totalProcs = Object.values(groups).flat().length;
    const totalModules = Object.keys(groups).length;
    if (totalProcs === 0) {
      toast.info("Chưa chọn proc nào.");
      return;
    }
    const modeLabel =
      classifyMode === "skip-existing"
        ? "(bỏ qua proc đã phân loại)"
        : classifyMode === "if-stale"
          ? "(chỉ chạy nếu body MSSQL đổi)"
          : "(force — chạy lại tất cả)";
    const ok = await dialog.confirm(
      `Classify ${totalProcs} proc thuộc ${totalModules} module ${modeLabel}?`,
      { title: "AI phân loại all-modules" },
    );
    if (!ok) return;

    let succ = 0;
    let skipped = 0;
    let cached = 0;
    let failed = 0;
    const moduleNames = Object.keys(groups);
    setRunStatus({ busy: true, label: "Classify", current: 0, total: moduleNames.length });

    let i = 0;
    for (const m of moduleNames) {
      const names = groups[m] ?? [];
      i++;
      setRunStatus((s) => ({ ...s, current: i, label: `Classify ${m}` }));
      try {
        const res = await migration.classifyProcsAi({
          module: m,
          names,
          mode: classifyMode,
        });
        succ += res.classified;
        skipped += res.skipped;
        cached += (res as { cached?: number }).cached ?? 0;
      } catch (e) {
        failed += names.length;
        console.warn(`Classify module ${m} fail:`, (e as Error).message);
      }
    }
    setRunStatus({ busy: false, label: "", current: 0, total: 0 });

    const parts: string[] = [];
    if (succ > 0) parts.push(`${succ} mới`);
    if (skipped > 0) parts.push(`${skipped} bỏ qua`);
    if (cached > 0) parts.push(`${cached} cache`);
    if (failed > 0) parts.push(`${failed} lỗi`);
    toast.success(parts.length > 0 ? parts.join(", ") : "Không có proc nào được classify.");
    reload();
  };

  const runWorkflowAll = async () => {
    const groups = selectedByModule();
    const tierCprocs: Array<{ module: string; procName: string }> = [];
    for (const m of Object.keys(groups)) {
      const rows = data?.rowsByModule[m] ?? [];
      for (const procName of groups[m] ?? []) {
        const row = rows.find((r) => r.name === procName);
        if (!row) continue;
        // Chỉ codegen workflow những proc tier C (suggested hoặc user override).
        if (row.suggestedTier === "C") {
          tierCprocs.push({ module: m, procName });
        }
      }
    }
    if (tierCprocs.length === 0) {
      toast.info("Không proc nào được suggest Tier C trong số đã chọn.");
      return;
    }
    const ok = await dialog.confirm(
      `Codegen Workflow Tier C cho ${tierCprocs.length} proc? Workflow đã tồn tại sẽ được giữ nguyên (idempotent).`,
      { title: "Codegen Workflow all-modules" },
    );
    if (!ok) return;

    let succ = 0;
    let reused = 0;
    let failed = 0;
    setRunStatus({ busy: true, label: "Codegen workflow", current: 0, total: tierCprocs.length });

    let i = 0;
    for (const t of tierCprocs) {
      i++;
      setRunStatus((s) => ({ ...s, current: i, label: `Workflow ${t.procName}` }));
      try {
        const dry = await migration.codegenProcWorkflowDryRun({
          module: t.module,
          procName: t.procName,
        });
        if (!dry.ok || !dry.graph) {
          failed++;
          continue;
        }
        const apply = await migration.codegenProcWorkflowApply({
          module: t.module,
          procName: t.procName,
          graph: dry.graph as { nodes: unknown[]; edges: unknown[] },
        });
        if (apply.reused) reused++;
        else succ++;
      } catch (e) {
        failed++;
        console.warn(`Workflow ${t.procName} fail:`, (e as Error).message);
      }
    }
    setRunStatus({ busy: false, label: "", current: 0, total: 0 });

    const parts: string[] = [];
    if (succ > 0) parts.push(`${succ} mới tạo`);
    if (reused > 0) parts.push(`${reused} đã tồn tại (giữ nguyên)`);
    if (failed > 0) parts.push(`${failed} lỗi`);
    toast.success(parts.length > 0 ? parts.join(", ") : "Không có workflow nào được apply.");
    reload();
  };

  /** All-in-one: classify → codegen workflow → apply FK relations trong 1 click.
   *  - Bước 1/3: classify proc đã chọn (skip-existing/if-stale/force theo mode).
   *  - Bước 2/3: codegen workflow cho proc tier C trong selection.
   *  - Bước 3/3: apply FK hint từ proc joinPairs vào entities.fields[].ref.
   *  Tất cả idempotent — re-run không phá kết quả. */
  const runMigrateAll = async () => {
    const groups = selectedByModule();
    const totalProcs = Object.values(groups).flat().length;
    const totalModules = Object.keys(groups).length;
    if (totalProcs === 0) {
      toast.info("Chưa chọn proc nào.");
      return;
    }
    const modeLabel =
      classifyMode === "skip-existing"
        ? "(bỏ qua proc đã phân loại)"
        : classifyMode === "if-stale"
          ? "(chỉ chạy nếu body MSSQL đổi)"
          : "(force — chạy lại tất cả)";
    const ok = await dialog.confirm(
      `Chạy migrate ${totalProcs} proc thuộc ${totalModules} module:\n  1) AI phân loại nghiệp vụ ${modeLabel}\n  2) Codegen Workflow (Tier C) cho proc phù hợp\n  3) Áp dụng quan hệ FK suy ra từ joinPairs proc lên entity\n\nMọi bước đều idempotent — workflow đã có không bị ghi đè, FK đã đúng được bỏ qua.`,
      { title: "Chạy migrate đã chọn" },
    );
    if (!ok) return;

    appendLog({
      step: "info",
      action: "info",
      target: `Bắt đầu — ${totalProcs} proc · ${totalModules} module`,
      result: "started",
      detail: `mode=${classifyMode}`,
    });

    // ── Bước 1/3: classify ──
    let cSucc = 0;
    let cSkipped = 0;
    let cCached = 0;
    let cFailed = 0;
    const moduleNames = Object.keys(groups);
    setRunStatus({
      busy: true,
      label: "Bước 1/3: Classify",
      current: 0,
      total: moduleNames.length,
    });
    let i = 0;
    for (const m of moduleNames) {
      const names = groups[m] ?? [];
      i++;
      setRunStatus((s) => ({ ...s, current: i, label: `Bước 1/3: Classify ${m}` }));
      try {
        const res = await migration.classifyProcsAi({
          module: m,
          names,
          mode: classifyMode,
        });
        cSucc += res.classified;
        cSkipped += res.skipped;
        const cachedHere = (res as { cached?: number }).cached ?? 0;
        cCached += cachedHere;
        appendLog({
          step: "1/3",
          action: "classify",
          target: m,
          result: res.classified > 0 ? "success" : cachedHere > 0 ? "cached" : "skipped",
          detail: `${names.length} proc · classified=${res.classified}, skipped=${res.skipped}, cached=${cachedHere}`,
        });
      } catch (e) {
        cFailed += names.length;
        const msg = (e as Error).message;
        console.warn(`Classify ${m} fail:`, msg);
        appendLog({
          step: "1/3",
          action: "classify",
          target: m,
          result: "failed",
          detail: msg,
        });
      }
    }

    // ── Re-fetch để biết suggestedTier mới sau classify ──
    setRunStatus({ busy: true, label: "Đang tải kết quả classify…", current: 0, total: 0 });
    let fresh: ListData | null = null;
    try {
      fresh = await migration.listAllProcsToMigrate({
        filterMode,
        activeWithinDays: activeDays,
        sortBy,
        includeBlocked: false,
        moduleFilter: moduleFilter.trim() || undefined,
      });
      setData(fresh);
    } catch {
      /* fall back to current data */
    }

    // ── Bước 2/3: codegen workflow tier C ──
    const tierCprocs: Array<{ module: string; procName: string }> = [];
    for (const m of moduleNames) {
      const rows = (fresh ?? data)?.rowsByModule[m] ?? [];
      for (const procName of groups[m] ?? []) {
        const row = rows.find((r) => r.name === procName);
        if (!row) continue;
        if (row.suggestedTier === "C") tierCprocs.push({ module: m, procName });
      }
    }
    let wSucc = 0;
    let wReused = 0;
    let wFailed = 0;
    if (tierCprocs.length > 0) {
      setRunStatus({
        busy: true,
        label: "Bước 2/3: Codegen workflow",
        current: 0,
        total: tierCprocs.length,
      });
      let j = 0;
      for (const t of tierCprocs) {
        j++;
        setRunStatus((s) => ({ ...s, current: j, label: `Bước 2/3: Workflow ${t.procName}` }));
        try {
          const dry = await migration.codegenProcWorkflowDryRun({
            module: t.module,
            procName: t.procName,
          });
          if (!dry.ok || !dry.graph) {
            wFailed++;
            appendLog({
              step: "2/3",
              action: "workflow",
              target: `${t.module}/${t.procName}`,
              result: "failed",
              detail: (dry as { error?: string }).error ?? "DryRun fail (no graph returned)",
            });
            continue;
          }
          const apply = await migration.codegenProcWorkflowApply({
            module: t.module,
            procName: t.procName,
            graph: dry.graph as { nodes: unknown[]; edges: unknown[] },
          });
          if (apply.reused) {
            wReused++;
            appendLog({
              step: "2/3",
              action: "workflow",
              target: `${t.module}/${t.procName}`,
              result: "noop",
              detail: `workflow "${apply.workflowName}" đã tồn tại — giữ nguyên`,
            });
          } else {
            wSucc++;
            appendLog({
              step: "2/3",
              action: "workflow",
              target: `${t.module}/${t.procName}`,
              result: "success",
              detail: `workflow "${apply.workflowName}" tạo mới (id=${apply.workflowId.slice(0, 8)}…)`,
            });
          }
        } catch (e) {
          wFailed++;
          const msg = (e as Error).message;
          console.warn(`Workflow ${t.procName} fail:`, msg);
          appendLog({
            step: "2/3",
            action: "workflow",
            target: `${t.module}/${t.procName}`,
            result: "failed",
            detail: msg,
          });
        }
      }
    } else {
      appendLog({
        step: "2/3",
        action: "workflow",
        target: "(không có proc Tier C)",
        result: "skipped",
      });
    }

    // ── Bước 3/3: apply FK relations từ proc joinPairs ──
    // Mọi hint chưa apply (cross-module) đều được tự động áp dụng. Server-side
    // applyRelationHint trả {changed:false} nếu state đã đúng → idempotent.
    let rChanged = 0;
    let rNoop = 0;
    let rFailed = 0;
    let rTotalPending = 0;
    try {
      const rel = await migration.listMigratedRelations({});
      const pending = rel.hints.filter((h) => !h.applied);
      rTotalPending = pending.length;
      if (pending.length > 0) {
        setRunStatus({
          busy: true,
          label: "Bước 3/3: Áp dụng quan hệ FK",
          current: 0,
          total: pending.length,
        });
        let k = 0;
        for (const h of pending) {
          k++;
          setRunStatus((s) => ({
            ...s,
            current: k,
            label: `Bước 3/3: FK ${h.sourceEntityName}.${h.sourceField}`,
          }));
          try {
            const res = await migration.applyRelationHint({
              sourceEntityId: h.sourceEntityId,
              sourceField: h.sourceField,
              targetEntityId: h.targetEntityId,
            });
            const noChange = (res as { changed?: boolean }).changed === false;
            if (noChange) rNoop++;
            else rChanged++;
            appendLog({
              step: "3/3",
              action: "fk",
              target: `${h.sourceEntityName}.${h.sourceField} → ${h.targetEntityName}`,
              result: noChange ? "noop" : "success",
              detail: `từ proc ${h.fromProc} (module ${h.module})`,
            });
          } catch (e) {
            rFailed++;
            const msg = (e as Error).message;
            console.warn(`applyRelationHint ${h.sourceEntityName}.${h.sourceField} fail:`, msg);
            appendLog({
              step: "3/3",
              action: "fk",
              target: `${h.sourceEntityName}.${h.sourceField}`,
              result: "failed",
              detail: msg,
            });
          }
        }
      } else {
        appendLog({
          step: "3/3",
          action: "fk",
          target: "(không có gợi ý FK chưa apply)",
          result: "skipped",
        });
      }
    } catch (e) {
      const msg = (e as Error).message;
      console.warn("listMigratedRelations fail:", msg);
      appendLog({
        step: "3/3",
        action: "fk",
        target: "listMigratedRelations",
        result: "failed",
        detail: msg,
      });
    }

    setRunStatus({ busy: false, label: "", current: 0, total: 0 });

    const lines: string[] = [];
    lines.push(
      `Classify: ${cSucc} mới · ${cSkipped} bỏ qua · ${cCached} cache${cFailed > 0 ? ` · ${cFailed} lỗi` : ""}`,
    );
    lines.push(
      `Workflow: ${wSucc} mới · ${wReused} đã tồn tại${wFailed > 0 ? ` · ${wFailed} lỗi` : ""} (Tier C: ${tierCprocs.length})`,
    );
    if (rTotalPending > 0 || rChanged > 0 || rNoop > 0 || rFailed > 0) {
      lines.push(
        `FK: ${rChanged} mới · ${rNoop} đã đúng (bỏ qua)${rFailed > 0 ? ` · ${rFailed} lỗi` : ""}`,
      );
    } else {
      lines.push("FK: không có gợi ý nào cần áp dụng");
    }
    appendLog({
      step: "info",
      action: "info",
      target: "Hoàn tất",
      result: cFailed + wFailed + rFailed > 0 ? "failed" : "success",
      detail: lines.join(" | "),
    });
    toast.success(lines.join(" | "));
    reload();
  };

  return (
    <div className="p-4 space-y-4 overflow-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <I.Workflow size={16} /> Migrate proc
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Chạy 1 lần cho tất cả proc có reads/writes thuộc bảng đã migrate, không cần mở từng
            module. Mọi action đều idempotent — chạy lại nhiều lần không phá kết quả.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            icon={<I.Loader size={12} />}
            onClick={reload}
            disabled={loading || runStatus.busy}
          >
            {loading ? "Đang tải…" : "Tải lại"}
          </Button>
          <Button size="sm" variant="ghost" icon={<I.X size={12} />} onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card p-3 space-y-2">
        <div className="text-[11px] uppercase text-muted tracking-wider font-semibold">Bộ lọc</div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 text-sm">
          <label className="space-y-1">
            <div className="text-xs text-muted">Module</div>
            <Input
              placeholder="Lọc tên module…"
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted">Tên proc</div>
            <Input
              placeholder="Tìm tên proc…"
              value={procNameFilter}
              onChange={(e) => setProcNameFilter(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted">Chế độ migrate</div>
            <Select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as typeof filterMode)}
            >
              <option value="all">Đủ reads + writes</option>
              <option value="reads-only">Chỉ reads</option>
            </Select>
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted">Active (ngày)</div>
            <Input
              type="number"
              min="0"
              max="3650"
              value={String(activeDays)}
              onChange={(e) => setActiveDays(Number(e.target.value) || 0)}
              placeholder="0 = bỏ"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted">Sắp xếp</div>
            <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
              <option value="complexity-asc">Đơn giản → phức tạp</option>
              <option value="complexity-desc">Phức tạp → đơn giản</option>
              <option value="name">Tên A-Z</option>
            </Select>
          </label>
          <label className="space-y-1">
            <div className="text-xs text-muted">Mode classify</div>
            <Select
              value={classifyMode}
              onChange={(e) => setClassifyMode(e.target.value as ClassifyMode)}
            >
              <option value="skip-existing">Bỏ qua đã classify</option>
              <option value="if-stale">Chỉ nếu body đổi</option>
              <option value="force">Force chạy lại</option>
            </Select>
          </label>
        </div>
        {data && (
          <div className="text-[11px] text-muted flex items-center gap-3 flex-wrap pt-1 border-t border-border">
            <span>Tổng: {data.counts.total}</span>
            <span className="text-success">Ready: {data.counts.ready}</span>
            <span className="text-warning">Partial: {data.counts.partial}</span>
            <span className="text-danger">Blocked: {data.counts.blocked}</span>
            <span>Hiển thị: {data.counts.shown}</span>
            <span>Module: {data.modules.length}</span>
            <span>Bảng đã migrate: {data.migratedTableCount}</span>
          </div>
        )}
      </div>

      {err && <div className="card p-3 text-xs text-danger border-danger/40">{err}</div>}

      {/* Bulk action bar */}
      {data && allRows.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="default"
            icon={<I.CheckSq size={12} />}
            onClick={toggleAll}
            disabled={runStatus.busy}
          >
            {filteredRows.every(({ module, row }) => selected.has(keyOf(module, row.name))) &&
            filteredRows.length > 0
              ? "Bỏ chọn lọc"
              : "Chọn lọc"}{" "}
            ({[...filteredKeys].filter((k) => selected.has(k)).length}/{filteredRows.length})
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<I.Play size={12} />}
            onClick={runMigrateAll}
            disabled={selected.size === 0 || runStatus.busy}
            title="Classify + Codegen Workflow trong 1 click — idempotent"
          >
            ▶ Chạy migrate đã chọn
          </Button>
          <div className="w-px h-5 bg-border mx-1" />
          <Button
            size="sm"
            variant="default"
            icon={<I.Sparkles size={12} />}
            onClick={runClassifyAll}
            disabled={selected.size === 0 || runStatus.busy}
            title="Chỉ chạy bước Classify"
          >
            Chỉ Classify
          </Button>
          <Button
            size="sm"
            variant="default"
            icon={<I.Workflow size={12} />}
            onClick={runWorkflowAll}
            disabled={selected.size === 0 || runStatus.busy}
            title="Chỉ chạy bước Codegen Workflow (Tier C)"
          >
            Chỉ Workflow
          </Button>
        </div>
      )}

      {/* Progress */}
      {runStatus.busy && (
        <div className="card p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span>{runStatus.label}</span>
            <span className="font-mono">
              {runStatus.current}/{runStatus.total}
            </span>
          </div>
          <div className="h-2 bg-bg-soft rounded overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${runStatus.total > 0 ? (runStatus.current / runStatus.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Activity log — append-only, persist trong session để review từng bước */}
      {runLogs.length > 0 && (
        <details className="card p-0 overflow-hidden" open>
          <summary className="px-3 py-2 border-b border-border bg-bg-soft flex items-center gap-2 cursor-pointer select-none">
            <I.Activity size={12} className="text-accent" />
            <span className="font-semibold text-sm">Nhật ký chạy</span>
            <span className="text-[10px] text-muted">({runLogs.length} dòng)</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  exportLogs();
                }}
                className="text-[10px] text-muted hover:text-accent px-1.5 py-0.5 rounded hover:bg-accent/10"
                title="Tải JSON nhật ký"
              >
                ⬇ JSON
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  clearLogs();
                }}
                className="text-[10px] text-muted hover:text-danger px-1.5 py-0.5 rounded hover:bg-danger/10"
                title="Xoá nhật ký"
              >
                ✕ Xoá
              </button>
            </div>
          </summary>
          <div className="max-h-72 overflow-y-auto p-1 font-mono text-[11px] leading-snug">
            {[...runLogs].reverse().map((l) => (
              <div
                key={l.id}
                className="grid grid-cols-[60px_36px_44px_1fr] gap-1.5 px-2 py-0.5 hover:bg-bg-soft/40 border-b border-border/30 last:border-0"
              >
                <span className="text-muted">
                  {new Date(l.at).toLocaleTimeString("vi-VN", { hour12: false })}
                </span>
                <span className="text-[10px] text-muted uppercase">{l.step}</span>
                <span className={RESULT_COLORS[l.result]}>
                  {RESULT_BADGE[l.result]} {l.action}
                </span>
                <span className="truncate">
                  <span className="text-text">{l.target}</span>
                  {l.detail && <span className="text-muted ml-1.5 text-[10px]">— {l.detail}</span>}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Panel tạo quan hệ từ SQL */}
      <details
        className="card overflow-hidden"
        open={sqlRelPanel}
        onToggle={(e) => setSqlRelPanel((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="px-3 py-2 border-b border-border bg-bg-soft flex items-center gap-2 cursor-pointer select-none">
          <I.Link size={12} className="text-accent" />
          <span className="font-semibold text-sm">Tạo quan hệ từ SQL</span>
          <span className="text-[10px] text-muted ml-1">
            — dán câu SQL bất kỳ, phân tích JOIN để thiết lập ref entity
          </span>
        </summary>
        {sqlRelPanel && (
          <div className="p-3 space-y-3">
            <div className="space-y-1">
              <div className="text-xs text-muted">Câu SQL (SELECT / stored proc body…)</div>
              <Textarea
                value={sqlRelInput}
                onChange={(e) => setSqlRelInput(e.target.value)}
                placeholder={
                  "SELECT ...\nFROM dbo.Orders o\nJOIN dbo.Customers c ON o.CustomerID = c.ID\n..."
                }
                rows={6}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                icon={<I.Sparkles size={12} />}
                onClick={runAnalyzeSql}
                disabled={sqlRelLoading || !sqlRelInput.trim()}
              >
                {sqlRelLoading ? "Đang phân tích…" : "Phân tích SQL"}
              </Button>
              {sqlRelResult && (
                <span className="text-xs text-muted">
                  {sqlRelResult.joinPairsTotal} cặp JOIN · {sqlRelResult.hints.length} gợi ý
                  {sqlRelResult.unmappedTables.length > 0 && (
                    <span
                      className="ml-2 text-warning"
                      title={`Bảng chưa migrate: ${sqlRelResult.unmappedTables.join(", ")}`}
                    >
                      ⚠ {sqlRelResult.unmappedTables.length} bảng chưa map
                    </span>
                  )}
                </span>
              )}
            </div>

            {sqlRelErr && <div className="text-xs text-danger">{sqlRelErr}</div>}

            {sqlRelResult && sqlRelResult.hints.length === 0 && (
              <div className="text-xs text-muted py-2">
                Không phát hiện quan hệ nào có thể map sang entity đã migrate.
              </div>
            )}

            {sqlRelResult && sqlRelResult.hints.length > 0 && (
              <div className="space-y-2">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-bg-soft/60 border-b border-border">
                    <tr>
                      <th className="px-2 py-1 w-8">
                        <input
                          type="checkbox"
                          checked={sqlRelResult.hints.every((h) =>
                            sqlRelSelected.has(sqlRelKey(h)),
                          )}
                          ref={(el) => {
                            if (el) {
                              const allSel = sqlRelResult.hints.every((h) =>
                                sqlRelSelected.has(sqlRelKey(h)),
                              );
                              const someSel =
                                !allSel &&
                                sqlRelResult.hints.some((h) => sqlRelSelected.has(sqlRelKey(h)));
                              el.indeterminate = someSel;
                            }
                          }}
                          onChange={() => {
                            const allSel = sqlRelResult.hints.every((h) =>
                              sqlRelSelected.has(sqlRelKey(h)),
                            );
                            if (allSel) setSqlRelSelected(new Set());
                            else setSqlRelSelected(new Set(sqlRelResult.hints.map(sqlRelKey)));
                          }}
                        />
                      </th>
                      <th className="px-2 py-1 text-left">Nguồn (entity.field)</th>
                      <th className="px-2 py-1 text-left">Đích (entity)</th>
                      <th className="px-2 py-1 text-left">Cột đích</th>
                      <th className="px-2 py-1 text-left">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sqlRelResult.hints.map((h) => {
                      const key = sqlRelKey(h);
                      return (
                        <tr key={key} className="border-b border-border/40 hover:bg-bg-soft/40">
                          <td className="px-2 py-1">
                            <input
                              type="checkbox"
                              checked={sqlRelSelected.has(key)}
                              onChange={() => toggleSqlRelHint(key)}
                              disabled={h.applied}
                            />
                          </td>
                          <td className="px-2 py-1 font-mono">
                            <span className="text-accent">{h.sourceEntityName}</span>
                            <span className="text-muted">.</span>
                            <span>{h.sourceField}</span>
                            {h.sourceFieldLabel !== h.sourceField && (
                              <div className="text-[10px] text-muted">
                                {h.sourceEntityLabel} · {h.sourceFieldLabel}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1 font-mono">
                            <span className="text-success">{h.targetEntityName}</span>
                            <div className="text-[10px] text-muted">{h.targetEntityLabel}</div>
                          </td>
                          <td className="px-2 py-1 font-mono text-muted">{h.targetField}</td>
                          <td className="px-2 py-1">
                            {h.applied ? (
                              <span className="inline-flex items-center gap-1 text-success text-[10px]">
                                <I.Check size={10} /> Đã áp dụng
                              </span>
                            ) : (
                              <span className="text-[10px] text-warning">Chưa</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<I.Check size={12} />}
                  onClick={applySqlRelHints}
                  disabled={sqlRelSelected.size === 0 || sqlRelApplying}
                >
                  {sqlRelApplying ? "Đang áp dụng…" : `Áp dụng ${sqlRelSelected.size} quan hệ`}
                </Button>
              </div>
            )}
          </div>
        )}
      </details>

      {/* Group by module */}
      {data && data.modules.length === 0 && (
        <div className="card p-6 text-center text-sm text-muted">
          Không có proc ready ở bất kỳ module nào. Migrate bảng trước hoặc thử "Chỉ reads".
        </div>
      )}
      {data && data.modules.length > 0 && (
        <div className="space-y-4">
          {data.modules.map((m) => {
            const allModuleRows = data.rowsByModule[m] ?? [];
            // Chỉ hiện các proc khớp filter tên proc (nếu có).
            const rows = procNameFilter.trim()
              ? allModuleRows.filter((r) =>
                  r.name.toLowerCase().includes(procNameFilter.trim().toLowerCase()),
                )
              : allModuleRows;
            if (rows.length === 0) return null;
            const allModuleSel = rows.every((r) => selected.has(keyOf(m, r.name)));
            const someModuleSel = !allModuleSel && rows.some((r) => selected.has(keyOf(m, r.name)));
            return (
              <div key={m} className="card overflow-hidden">
                <div className="px-3 py-2 border-b border-border bg-bg-soft flex items-center gap-2">
                  <I.Folder size={12} className="text-accent" />
                  <span className="font-semibold text-sm">{m}</span>
                  <span className="text-[10px] text-muted">
                    {rows.length}/{allModuleRows.length} proc
                  </span>
                  <button
                    type="button"
                    disabled={runStatus.busy}
                    onClick={() => toggleModule(m, rows)}
                    className="ml-auto text-[10px] px-2 py-0.5 rounded border border-border hover:bg-hover disabled:opacity-50"
                  >
                    {allModuleSel ? "Bỏ hết" : "Chọn hết"}
                    {someModuleSel && (
                      <span className="ml-1 text-accent">
                        ({rows.filter((r) => selected.has(keyOf(m, r.name))).length})
                      </span>
                    )}
                  </button>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-bg-soft/40 border-b border-border">
                    <tr>
                      <th className="px-2 py-1 w-8">
                        <input
                          type="checkbox"
                          checked={allModuleSel}
                          ref={(el) => {
                            if (el) el.indeterminate = someModuleSel;
                          }}
                          onChange={() => toggleModule(m, rows)}
                          disabled={runStatus.busy}
                          title={allModuleSel ? "Bỏ hết module này" : "Chọn hết module này"}
                        />
                      </th>
                      <th className="px-2 py-1 text-left">Proc</th>
                      <th className="px-2 py-1 w-6" />
                      <th className="px-2 py-1 text-left">Nghiệp vụ</th>
                      <th className="px-2 py-1 text-left">Tier</th>
                      <th className="px-2 py-1 text-right">Cx</th>
                      <th className="px-2 py-1 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const k = keyOf(m, r.name);
                      const tierKlass =
                        TIER_COLORS[r.suggestedTier] ?? "bg-bg-soft text-muted border-border";
                      const partial = r.filterStatus === "partial";
                      return (
                        <tr key={k} className="border-b border-border/40 hover:bg-bg-soft/40">
                          <td className="px-2 py-1">
                            <input
                              type="checkbox"
                              checked={selected.has(k)}
                              onChange={() => toggle(m, r.name)}
                              disabled={runStatus.busy}
                            />
                          </td>
                          <td className="px-2 py-1 font-mono text-[11px]">
                            {r.name}
                            {r.label && (
                              <div className="text-[10px] text-muted mt-0.5">{r.label}</div>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            <button
                              type="button"
                              title="Xem nội dung proc"
                              onClick={() => openViewProc(m, r.name)}
                              className="text-muted hover:text-accent p-0.5 rounded hover:bg-accent/10"
                            >
                              <I.Eye size={12} />
                            </button>
                          </td>
                          <td className="px-2 py-1 text-[11px]">
                            {r.businessCategory ? (
                              <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px]">
                                {r.businessCategory}
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                            {r.businessCategoryConfidence != null && (
                              <span className="ml-1 text-[10px] text-muted">
                                {(r.businessCategoryConfidence * 100).toFixed(0)}%
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${tierKlass}`}
                            >
                              {r.suggestedTier}
                            </span>
                            {r.targetWorkflowId && (
                              <I.Check size={10} className="ml-1 text-success inline" />
                            )}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">{r.complexity}</td>
                          <td className="px-2 py-1">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${
                                partial
                                  ? "bg-warning/15 text-warning border-warning/30"
                                  : "bg-success/15 text-success border-success/30"
                              }`}
                            >
                              {r.filterStatus}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal xem nội dung proc */}
      {viewProc && (
        <Modal
          open={!!viewProc}
          onClose={() => setViewProc(null)}
          title={`Nội dung proc: ${viewProc.name}`}
          width={780}
        >
          {viewProcData.loading && (
            <div className="py-8 text-center text-sm text-muted">Đang tải…</div>
          )}
          {viewProcData.error && (
            <div className="py-4 text-sm text-danger">{viewProcData.error}</div>
          )}
          {!viewProcData.loading && !viewProcData.error && viewProcData.body !== null && (
            <div className="space-y-3">
              {viewProcData.params && viewProcData.params.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase text-muted tracking-wider font-semibold mb-1.5">
                    Tham số ({viewProcData.params.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {viewProcData.params.map((p) => (
                      <span
                        key={p.name}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-bg-soft text-[11px] font-mono"
                      >
                        <span className="text-accent">{p.name}</span>
                        <span className="text-muted">{p.dataType}</span>
                        {p.isOutput && (
                          <span className="text-warning text-[9px] uppercase">OUT</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[11px] uppercase text-muted tracking-wider font-semibold mb-1.5">
                  T-SQL body
                </div>
                <pre className="bg-bg-soft border border-border rounded p-3 text-[11px] font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap break-words leading-relaxed">
                  {viewProcData.body}
                </pre>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
