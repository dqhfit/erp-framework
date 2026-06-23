/* ==========================================================
   settings.cockpit — Cockpit menu-driven: hiển thị cây menu app cũ
   DQHF (SYS_MENU_NEW), trạng thái port từng mục, và port theo menu.

   Luồng: Import (SYS_MENU_NEW) → Resolve (form .cs → proc/bảng) →
   chọn 1 mục → "Port mục này" (discover scoped) → page mới.
   ========================================================== */

import {
  createLegacyMenuClient,
  createMigrationClient,
  createPrintTemplatesClient,
  type LegacyMenuNode,
  type LegacyMenuNodeDetail,
  type LegacyMenuStats,
  type LegacyReport,
  type MigrationJobRow,
} from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Modal, SplitPane } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { buildDqhfIndex, resolveFormProcs as resolveFormProcsBrowser } from "@/lib/dqhf-resolver";

const api = createLegacyMenuClient("");
const printApi = createPrintTemplatesClient("");
const migApi = createMigrationClient("");

/** Cấp tối đa hiển thị trên menu giao diện. Cấp > NAV_MAX_LEVEL dùng cho RBAC. */
const NAV_MAX_LEVEL = 3;

/** Loại bỏ node cấp > NAV_MAX_LEVEL khỏi cây (chỉ dùng cho display). */
function pruneNavTree(nodes: LegacyMenuNode[]): LegacyMenuNode[] {
  return nodes
    .filter((n) => n.level === null || n.level <= NAV_MAX_LEVEL)
    .map((n) => ({ ...n, children: pruneNavTree(n.children) }));
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  chua: { label: "Chưa port", cls: "bg-panel-2 text-muted" },
  dang: { label: "Đang port", cls: "bg-warning/20 text-warning" },
  xong: { label: "Đã port", cls: "bg-success/20 text-success" },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.chua!;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${m.cls}`}>{m.label}</span>
  );
}

/** 1 dòng cây menu (đệ quy). */
function TreeRow({
  node,
  depth,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  node: LegacyMenuNode;
  depth: number;
  selected: string | null;
  expanded: Set<string>;
  onToggle: (code: string) => void;
  onSelect: (node: LegacyMenuNode) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.sourceCode);
  const isSel = selected === node.sourceCode;
  return (
    <>
      <button
        type="button"
        onClick={() => (hasChildren ? onToggle(node.sourceCode) : onSelect(node))}
        className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-hover/50 ${
          isSel ? "bg-accent/10 ring-1 ring-accent/30" : ""
        }`}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        {hasChildren ? (
          isOpen ? (
            <I.ChevronDown size={14} className="shrink-0 text-muted" />
          ) : (
            <I.ChevronRight size={14} className="shrink-0 text-muted" />
          )
        ) : (
          <span className="inline-block w-[14px]" />
        )}
        {hasChildren ? (
          <I.Folder size={14} className="shrink-0 text-amber-500" />
        ) : (
          <I.File size={14} className="shrink-0 text-sky-500" />
        )}
        <span className={`flex-1 truncate ${node.active ? "" : "text-muted line-through"}`}>
          {node.name ?? node.sourceCode}
        </span>
        {node.winId && <StatusBadge status={node.portStatus} />}
      </button>
      {hasChildren &&
        isOpen &&
        node.children.map((c) => (
          <TreeRow
            key={c.sourceCode}
            node={c}
            depth={depth + 1}
            selected={selected}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

type SetupStatus = {
  dqhfDir: string | null;
  dqhfDirSet: boolean;
  dqhfDirExists: boolean;
  mssqlOk: boolean;
} | null;

const JOB_STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Chờ", cls: "bg-panel-2 text-muted" },
  running: { label: "Đang chạy", cls: "bg-accent/20 text-accent" },
  completed: { label: "Xong", cls: "bg-success/20 text-success" },
  failed: { label: "Lỗi", cls: "bg-danger/20 text-danger" },
  canceled: { label: "Huỷ", cls: "bg-panel-2 text-muted" },
};

function formatDur(ms: number | null): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/** Node phẳng cho kết quả tìm kiếm — kèm đường dẫn tên cha. */
type FlatNode = { node: LegacyMenuNode; path: string[] };

function flattenTree(nodes: LegacyMenuNode[], path: string[] = []): FlatNode[] {
  const out: FlatNode[] = [];
  for (const n of nodes) {
    out.push({ node: n, path });
    if (n.children.length) out.push(...flattenTree(n.children, [...path, n.name ?? n.sourceCode]));
  }
  return out;
}

/** 1 dòng kết quả tìm kiếm (phẳng, có breadcrumb). */
function SearchRow({
  item,
  selected,
  onSelect,
}: {
  item: FlatNode;
  selected: string | null;
  onSelect: (n: LegacyMenuNode) => void;
}) {
  const { node, path } = item;
  const isSel = selected === node.sourceCode;
  return (
    <button
      type="button"
      onClick={() => onSelect(node)}
      className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-sm hover:bg-hover/50 ${
        isSel ? "bg-accent/10 ring-1 ring-accent/30" : ""
      }`}
    >
      {path.length > 0 && <div className="text-[10px] text-muted truncate">{path.join(" › ")}</div>}
      <div className="flex items-center gap-1.5">
        {node.children.length > 0 ? (
          <I.Folder size={12} className="shrink-0 text-amber-500" />
        ) : (
          <I.File size={12} className="shrink-0 text-accent" />
        )}
        <span className={`flex-1 truncate ${node.active ? "" : "text-muted line-through"}`}>
          {node.name ?? node.sourceCode}
        </span>
        <span className="text-[10px] text-muted font-mono shrink-0">{node.sourceCode}</span>
        {node.winId && <StatusBadge status={node.portStatus} />}
      </div>
    </button>
  );
}

export function CockpitPage() {
  const [tree, setTree] = useState<LegacyMenuNode[]>([]);
  const [stats, setStats] = useState<LegacyMenuStats | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<LegacyMenuNode | null>(null);
  const [detail, setDetail] = useState<LegacyMenuNodeDetail | null>(null);
  const [reportMap, setReportMap] = useState<Record<string, LegacyReport>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [setup, setSetup] = useState<SetupStatus>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [jobs, setJobs] = useState<MigrationJobRow[]>([]);
  const [localResolveProgress, setLocalResolveProgress] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<Awaited<
    ReturnType<typeof migApi.verifyModuleProcs>
  > | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const alertResolveRef = useRef<(() => void) | null>(null);
  const stopFixRef = useRef(false); // cờ dừng vòng "Tự sửa" giữa các proc

  const showAlert = useCallback((msg: string): Promise<void> => {
    return new Promise((resolve) => {
      alertResolveRef.current = resolve;
      setAlertMsg(msg);
    });
  }, []);

  const closeAlert = useCallback(() => {
    alertResolveRef.current?.();
    alertResolveRef.current = null;
    setAlertMsg(null);
  }, []);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Kiểm tra MSSQL 1 lần khi mount
  useEffect(() => {
    api
      .checkSetup()
      .then(setSetup)
      .catch(() => setSetup(null));
  }, []); // mount-only

  // biome-ignore lint/correctness/useExhaustiveDependencies: api + dialog là module singleton, không thay đổi
  useEffect(() => {
    setLoading(true);
    Promise.all([api.listTree(), api.stats(), api.listReports()])
      .then(([t, s, reps]) => {
        setTree(t);
        setStats(s);
        setReportMap(Object.fromEntries(reps.map((r) => [r.reportClass, r])));
      })
      .catch((e) => showAlert(`Lỗi tải menu: ${e?.message ?? e}`))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  // prevStatus + cờ active để TRONG ref — sống sót qua các lần effect re-run.
  // Trước đây prevStatus là local trong effect và effect phụ thuộc reloadKey;
  // reload() bump reloadKey → effect teardown → prevStatus reset rỗng → job thứ
  // 2+ xong KHÔNG được phát hiện (prev=undefined) → cây/stats không reload.
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const jobsActiveRef = useRef(false);

  // Tải jobs, tự refresh 4s khi có job đang active. Phát hiện job running/queued
  // → completed/failed thì reload() để cây/stats cập nhật. Deps CHỈ [reload]
  // (stable) — KHÔNG đưa reloadKey vào, nếu không polling bị tái tạo mỗi reload.
  // biome-ignore lint/correctness/useExhaustiveDependencies: migApi singleton; reload ổn định
  useEffect(() => {
    const fetchJobs = async () => {
      let newJobs: MigrationJobRow[];
      try {
        newJobs = await migApi.listJobs({ limit: 20 });
      } catch {
        return;
      }

      const prevStatus = prevStatusRef.current;
      const justDone = newJobs.some((j) => {
        const prev = prevStatus.get(j.id);
        return (
          (prev === "running" || prev === "queued") &&
          (j.status === "completed" || j.status === "failed")
        );
      });

      for (const j of newJobs) prevStatus.set(j.id, j.status);
      jobsActiveRef.current = newJobs.some((j) => j.status === "queued" || j.status === "running");
      setJobs(newJobs);
      if (justDone) reload(); // cập nhật cây + stats + portStatus
    };

    fetchJobs();
    // Đọc cờ active từ ref — KHÔNG gọi fetchJobs trong updater setJobs (side
    // effect trong reducer → StrictMode chạy 2× = gấp đôi request).
    const id = setInterval(() => {
      if (jobsActiveRef.current) fetchJobs();
    }, 4_000);
    return () => clearInterval(id);
  }, [reload]);

  const onToggle = useCallback((code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const onSelect = useCallback(
    (node: LegacyMenuNode) => {
      setSelected(node);
      setDetail(null);
      api
        .getResolved(node.sourceCode)
        .then(setDetail)
        .catch((e) => showAlert(`Lỗi tải chi tiết: ${e?.message ?? e}`));
    },
    [showAlert],
  );

  /** Phân tích source C# từ thư mục user chọn trên máy local, gửi kết quả lên server. */
  const doLocalResolve = useCallback(
    async (files: FileList) => {
      if (!files.length) return;
      setBusy("local-resolve");
      setLocalResolveProgress("Đang đọc file…");
      try {
        setLocalResolveProgress(`Đang lập chỉ mục ${files.length} file…`);
        const idx = await buildDqhfIndex(files);

        const forms: Array<{ sourceCode: string; winId: string }> = [];
        const walk = (nodes: typeof tree): void => {
          for (const n of nodes) {
            if (n.winId) forms.push({ sourceCode: n.sourceCode, winId: n.winId });
            walk(n.children);
          }
        };
        walk(tree);

        if (!forms.length) {
          await showAlert("Chưa có dữ liệu menu — hãy Import menu trước.");
          return;
        }

        const results = [];
        for (let i = 0; i < forms.length; i++) {
          const f = forms[i];
          if (!f) continue;
          results.push({ sourceCode: f.sourceCode, ...resolveFormProcsBrowser(idx, f.winId) });
          if (i % 5 === 0) setLocalResolveProgress(`Đang phân tích ${i + 1}/${forms.length} form…`);
        }

        setLocalResolveProgress(`Đang lưu ${results.length} kết quả…`);
        const summary = await api.bulkResolve(results);
        await showAlert(
          `Resolve xong: ${summary.withProcs}/${summary.totalForms} form có proc, ${summary.noForm} không thấy file. (${idx.fileCount} .cs đã đọc)`,
        );
        reload();
        if (selected) onSelect(selected);
      } catch (e) {
        await showAlert(`Lỗi resolve local: ${(e as Error)?.message ?? e}`);
      } finally {
        setBusy(null);
        setLocalResolveProgress(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [tree, selected, onSelect, reload, showAlert],
  );

  const doImport = useCallback(async () => {
    setBusy("import");
    try {
      const r = await api.importFromMssql();
      await showAlert(`Import xong: ${r.imported} mới, ${r.updated} cập nhật (tổng ${r.total}).`);
      reload();
    } catch (e) {
      await showAlert(`Lỗi import: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [reload, showAlert]);

  const doResolve = useCallback(async () => {
    setBusy("resolve");
    try {
      const r = await api.resolveFromSource();
      await showAlert(
        `Resolve xong: ${r.withProcs}/${r.totalForms} form có proc, ${r.noForm} không thấy file.`,
      );
      reload();
      if (selected) onSelect(selected);
    } catch (e) {
      await showAlert(`Lỗi resolve: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [reload, selected, onSelect, showAlert]);

  const doParseReports = useCallback(async () => {
    setBusy("reports");
    try {
      const r = await api.parseReports();
      await showAlert(
        `Phân tích báo cáo xong: ${r.parsed} report (${r.table} dạng bảng, ${r.document} chứng từ in).`,
      );
      reload();
    } catch (e) {
      await showAlert(`Lỗi phân tích báo cáo: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [reload, showAlert]);

  /** Chạy bước tiếp theo trong pipeline (enrich hoặc generate) cho module đang chọn. */
  const doRunStep = useCallback(
    async (action: "enrich" | "generate", module: string, overwrite = false) => {
      // overwrite=true (chỉ generate): sinh lại + ghi đè proc/file đã có — để
      // SỬA proc đã sinh sai. Mặc định skipExisting (idempotent, bỏ đã xong).
      const defaultArgs: Record<string, unknown> =
        action === "enrich"
          ? { apply: true, skipEnriched: true }
          : overwrite
            ? { skipExisting: false, overwriteFiles: true }
            : { skipExisting: true };
      setBusy(`step:${action}:${module}`);
      try {
        const { jobId } = await migApi.startJob(action, module, defaultArgs);
        // Refresh jobs ngay để hiện job mới trong panel
        const newJobs = await migApi.listJobs({ limit: 20 });
        setJobs(newJobs);
        await showAlert(
          `Đã tạo job ${action} cho module "${module}" (${jobId.slice(0, 8)}…). Theo dõi ở panel "Tác vụ nền".`,
        );
      } catch (e) {
        await showAlert(`Lỗi khởi chạy ${action}: ${(e as Error)?.message ?? e}`);
      } finally {
        setBusy(null);
      }
    },
    [showAlert],
  );

  /** Dừng (huỷ) 1 job nền đang chạy/chờ — cooperative stop: dừng sau bước
   *  hiện tại, giữ tiến độ (resume được). */
  const doCancelJob = useCallback(
    async (jobId: string) => {
      const ok = await dialog.confirm(
        "Dừng tác vụ đang chạy? Sẽ dừng sau bước hiện tại — giữ tiến độ, resume được.",
      );
      if (!ok) return;
      setBusy(`cancel:${jobId}`);
      try {
        await migApi.cancelJob(jobId);
        setJobs(await migApi.listJobs({ limit: 20 }));
      } catch (e) {
        await showAlert(`Lỗi dừng: ${(e as Error)?.message ?? e}`);
      } finally {
        setBusy(null);
      }
    },
    [showAlert],
  );

  /** Phase A — verify mọi proc active của module so với golden baseline.
   *  Sync (không qua queue) — trả pass/fail ngay để hiện. */
  const doVerify = useCallback(
    async (module: string) => {
      setBusy(`verify:${module}`);
      setVerifyResult(null);
      try {
        const r = await migApi.verifyModuleProcs(module);
        setVerifyResult(r);
        if (r.total === 0) {
          await showAlert(
            "Không có proc nào để verify (proc active đã generate + có golden). Capture golden + generate trước.",
          );
        }
      } catch (e) {
        await showAlert(`Lỗi verify: ${(e as Error)?.message ?? e}`);
      } finally {
        setBusy(null);
      }
    },
    [showAlert],
  );

  /** Phase A — Tự sửa proc lỗi: với mỗi proc fail (có golden), lấy diff →
   *  codegen lại VỚI feedback → apply ghi đè → verify lại. 1 lượt. */
  const doFixVerifyFails = useCallback(
    async (module: string) => {
      const fails = (verifyResult?.procs ?? []).filter(
        (p) => !p.verified && !p.error, // có golden, đã generate, nhưng output sai
      );
      if (fails.length === 0) {
        await showAlert("Không có proc lỗi (có golden) để sửa. Verify trước hoặc capture golden.");
        return;
      }
      setBusy(`fix:${module}`);
      stopFixRef.current = false;
      let fixed = 0;
      let still = 0;
      try {
        for (const f of fails) {
          if (stopFixRef.current) break; // user nhấn Dừng → dừng sau proc hiện tại
          // 1) lấy feedback chi tiết (diff golden vs output)
          const v = await migApi.verifyProc(module, f.procName);
          if (v.verified) {
            fixed++;
            continue;
          }
          // 2) sinh lại với feedback
          const dry = await migApi.codegenProcDryRun(module, f.procName, undefined, v.feedback);
          if (!dry.output) {
            still++;
            continue;
          }
          // 3) apply ghi đè
          if (dry.output.tier === "B") {
            await migApi.codegenProcApply({
              module,
              tier: "B",
              procName: f.procName,
              name: dry.output.name,
              label: dry.output.label,
              description: dry.output.description,
              paramsSchema: dry.output.paramsSchema,
              code: dry.output.code,
              overwrite: true,
            });
          } else {
            await migApi.codegenProcApply({
              module,
              tier: "D",
              procName: f.procName,
              fileName: dry.output.fileName,
              code: dry.output.code,
              overwrite: true,
            });
            await migApi.refreshModuleProcs(); // reload registry để verify gọi code mới
          }
          // 4) verify lại
          const v2 = await migApi.verifyProc(module, f.procName);
          if (v2.verified) fixed++;
          else still++;
        }
        const r = await migApi.verifyModuleProcs(module);
        setVerifyResult(r);
        await showAlert(`Tự sửa xong: ${fixed} pass, ${still} vẫn lỗi (cần xem tay / Tier A).`);
      } catch (e) {
        await showAlert(`Lỗi tự sửa: ${(e as Error)?.message ?? e}`);
      } finally {
        setBusy(null);
      }
    },
    [verifyResult, showAlert],
  );

  const doScaffoldReport = useCallback(
    async (reportClass: string) => {
      setBusy(`tpl:${reportClass}`);
      try {
        const t = await printApi.scaffoldFromReport(reportClass);
        const { html } = await printApi.renderPreview(t.id);
        const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        window.open(url, "_blank");
      } catch (e) {
        await showAlert(`Lỗi tạo template in: ${(e as Error)?.message ?? e}`);
      } finally {
        setBusy(null);
      }
    },
    [showAlert],
  );

  const doPort = useCallback(async () => {
    if (!selected) return;
    const ok = await dialog.confirm(
      `Port mục "${selected.name}"? Sẽ chạy discover scoped theo các bảng form này dùng.`,
    );
    if (!ok) return;
    setBusy("port");
    try {
      const r = await api.portNode(selected.sourceCode);
      await showAlert(
        `Đã tạo module "${r.module}" + discover ${r.seedTables.length} bảng (job ${r.jobId.slice(0, 8)}). Tiếp tục enrich/generate ở Settings → Migration.`,
      );
      reload();
      onSelect(selected);
    } catch (e) {
      await showAlert(`Lỗi port: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [selected, reload, onSelect, showAlert]);

  const setStatus = useCallback(
    async (status: "chua" | "dang" | "xong") => {
      if (!selected) return;
      try {
        await api.setPortStatus(selected.sourceCode, status);
        reload();
        onSelect(selected);
      } catch (e) {
        await showAlert(`Lỗi: ${(e as Error)?.message ?? e}`);
      }
    },
    [selected, reload, onSelect, showAlert],
  );

  const navTree = useMemo(() => pruneNavTree(tree), [tree]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null; // null = không search
    return flattenTree(tree).filter(
      ({ node }) =>
        (node.name ?? "").toLowerCase().includes(q) ||
        node.sourceCode.toLowerCase().includes(q) ||
        (node.winId ?? "").toLowerCase().includes(q),
    );
  }, [searchQuery, tree]);

  const pct = useMemo(() => {
    if (!stats) return 0;
    const xong = stats.byStatus.xong ?? 0;
    return stats.forms ? Math.round((xong / stats.forms) * 100) : 0;
  }, [stats]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold">Migrate DQHF — Menu cũ</h1>
          <p className="text-sm text-muted">
            Cây menu DQHF (SYS_MENU_NEW). Bấm mục có form để xem proc/bảng và port.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={doImport}
            disabled={busy != null || setup?.mssqlOk === false}
            title={
              setup?.mssqlOk === false
                ? "MSSQL chưa kết nối được — kiểm tra Settings → Migration"
                : undefined
            }
          >
            <I.Download size={14} /> {busy === "import" ? "Đang import…" : "Import menu"}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={doResolve}
            disabled={busy != null || !setup?.dqhfDirSet || !setup?.dqhfDirExists}
            title="Cần DQHF_SOURCE_DIR trên server — dùng Resolve local nếu source ở máy dev"
          >
            <I.RefreshCw size={14} /> {busy === "resolve" ? "Đang resolve…" : "Resolve form→proc"}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy != null}
            title="Chọn thư mục source C# DQHF trên máy local"
          >
            <I.FolderOpen size={14} />
            {busy === "local-resolve" ? (localResolveProgress ?? "Đang resolve…") : "Resolve local"}
          </Button>
          <Button variant="default" size="sm" onClick={doParseReports} disabled={busy != null}>
            <I.File size={14} /> {busy === "reports" ? "Đang phân tích…" : "Phân tích báo cáo"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            // @ts-expect-error webkitdirectory không có trong types chuẩn
            webkitdirectory=""
            accept=".cs"
            onChange={(e) => e.target.files && doLocalResolve(e.target.files)}
          />
        </div>
      </div>

      {/* Banner cảnh báo — chỉ hiện khi MSSQL không kết nối được */}
      {setup && !setup.mssqlOk && (
        <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <I.AlertCircle size={13} className="shrink-0" />
          <span>
            <b>MSSQL chưa kết nối</b> — nút "Import menu" bị tắt. Kiểm tra connection ở{" "}
            <span className="font-mono">Settings → Migration</span>.
          </span>
        </div>
      )}

      {stats && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-bg-soft px-3 py-2 text-sm">
          <span>
            <b>{stats.total - stats.rbacNodes}</b> mục menu (cấp 1–3)
          </span>
          <span>
            <b>{stats.forms}</b> mục có form
          </span>
          <StatusBadge status="chua" /> <b>{stats.byStatus.chua ?? 0}</b>
          <StatusBadge status="dang" /> <b>{stats.byStatus.dang ?? 0}</b>
          <StatusBadge status="xong" /> <b>{stats.byStatus.xong ?? 0}</b>
          {stats.rbacNodes > 0 && (
            <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted">
              +{stats.rbacNodes} thao tác RBAC (cấp &gt;3, ẩn trên menu)
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="w-32 rounded-full bg-panel-2 h-2 overflow-hidden">
              <div
                className="h-2 rounded-full bg-success transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-muted text-xs tabular-nums">{pct}%</span>
          </div>
        </div>
      )}

      {/* Panel tác vụ */}
      {jobs.length > 0 && (
        <details className="rounded border border-border">
          <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-xs text-muted hover:bg-hover/30">
            <I.Clock size={13} />
            <span className="font-medium">Tác vụ nền</span>
            {jobs.some((j) => j.status === "running") && (
              <I.Loader size={12} className="animate-spin text-accent" />
            )}
            {jobs.some((j) => j.status === "queued") && (
              <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] text-warning">
                {jobs.filter((j) => j.status === "queued").length} chờ
              </span>
            )}
            {jobs.some((j) => j.status === "failed") && (
              <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[10px] text-danger">
                {jobs.filter((j) => j.status === "failed").length} lỗi
              </span>
            )}
            <span className="ml-auto">{jobs.length} tác vụ gần đây ▾</span>
          </summary>
          <div className="max-h-52 overflow-auto border-t border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-bg-soft text-muted">
                  <th className="px-3 py-1.5 text-left font-medium">Module</th>
                  <th className="px-2 py-1.5 text-left font-medium">Tác vụ</th>
                  <th className="px-2 py-1.5 text-left font-medium">Trạng thái</th>
                  <th className="px-2 py-1.5 text-right font-medium">Thời gian</th>
                  <th className="px-3 py-1.5 text-left font-medium">Thông tin</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const sm = JOB_STATUS[j.status] ?? JOB_STATUS.canceled!;
                  return (
                    <tr key={j.id} className="border-t border-border/50 hover:bg-hover/20">
                      <td className="px-3 py-1 font-mono">{j.module}</td>
                      <td className="px-2 py-1 text-muted">{j.action}</td>
                      <td className="px-2 py-1">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${sm.cls}`}>
                          {sm.label}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-muted">
                        {j.status === "running" ? (
                          <I.Loader size={11} className="animate-spin inline text-accent" />
                        ) : (
                          formatDur(j.durationMs)
                        )}
                      </td>
                      <td className="px-3 py-1 max-w-[240px] truncate text-muted">
                        {j.error ? <span className="text-danger">{j.error}</span> : j.message}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <SplitPane
        defaultLeftWidth={460}
        minLeft={260}
        minRight={280}
        storageKey="cockpit-split"
        left={
          <div className="flex min-h-0 h-full flex-col gap-1.5 pr-1.5">
            {/* Search */}
            <div className="relative">
              <I.Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên, mã, form…"
                className="w-full rounded border border-border bg-panel pl-7 pr-7 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                >
                  <I.X size={13} />
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded border border-border p-1.5">
              {loading ? (
                <div className="p-4 text-sm text-muted">Đang tải…</div>
              ) : tree.length === 0 ? (
                <div className="p-4 text-sm text-muted">
                  Chưa có dữ liệu — bấm "Import menu" để nạp SYS_MENU_NEW.
                </div>
              ) : searchResults !== null ? (
                searchResults.length === 0 ? (
                  <div className="p-4 text-sm text-muted">Không tìm thấy kết quả.</div>
                ) : (
                  <>
                    <div className="mb-1 px-1 text-[11px] text-muted">
                      {searchResults.length} kết quả
                    </div>
                    {searchResults.map(({ node, path }) => (
                      <SearchRow
                        key={node.sourceCode}
                        item={{ node, path }}
                        selected={selected?.sourceCode ?? null}
                        onSelect={onSelect}
                      />
                    ))}
                  </>
                )
              ) : (
                navTree.map((n) => (
                  <TreeRow
                    key={n.sourceCode}
                    node={n}
                    depth={0}
                    selected={selected?.sourceCode ?? null}
                    expanded={expanded}
                    onToggle={onToggle}
                    onSelect={onSelect}
                  />
                ))
              )}
            </div>
          </div>
        }
        right={
          <div className="min-h-0 h-full overflow-auto rounded border border-border p-3">
            {!selected ? (
              <div className="text-sm text-muted">Chọn 1 mục menu có form để xem chi tiết.</div>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">{selected.name}</h2>
                    <StatusBadge status={selected.portStatus} />
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    [{selected.sourceCode}] {selected.winId ?? "(không có form)"}
                    {selected.namespace ? ` · ${selected.namespace}` : ""}
                  </div>
                  {selected.module && (
                    <div className="mt-0.5 text-xs text-muted">module: {selected.module}</div>
                  )}
                </div>

                {/* Pipeline tiến trình port (chỉ hiện khi đã có module) */}
                {selected.module &&
                  (() => {
                    const modJobs = jobs
                      .filter((j) => j.module === selected.module)
                      .sort(
                        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                      );
                    const lastOf = (action: string) => modJobs.find((j) => j.action === action);
                    // Job đang chạy/chờ của module này → để hiện nút Dừng.
                    const activeJob = modJobs.find(
                      (j) => j.status === "running" || j.status === "queued",
                    );
                    const STEPS = ["discover", "enrich", "generate"] as const;
                    const stepStatus = (a: string) => {
                      const j = lastOf(a);
                      if (!j) return "pending";
                      if (j.status === "running" || j.status === "queued") return "active";
                      if (j.status === "completed") return "done";
                      if (j.status === "failed") return "error";
                      return "pending";
                    };
                    const canRun = (s: string): s is "enrich" | "generate" =>
                      (s === "enrich" || s === "generate") &&
                      (stepStatus(s) === "pending" || stepStatus(s) === "error") &&
                      busy == null;
                    return (
                      <div className="rounded border border-border bg-bg-soft px-3 py-2">
                        <div className="mb-1.5 text-[11px] font-medium text-muted uppercase tracking-wide">
                          Tiến trình port
                        </div>
                        <div className="flex items-center gap-1">
                          {STEPS.map((step, i) => {
                            const st = stepStatus(step);
                            const j = lastOf(step);
                            const isRunning = busy === `step:${step}:${selected.module}`;
                            const runnable = canRun(step);
                            const cls = `flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-opacity ${
                              st === "done"
                                ? "bg-success/20 text-success"
                                : st === "active" || isRunning
                                  ? "bg-accent/20 text-accent"
                                  : st === "error"
                                    ? "bg-danger/20 text-danger"
                                    : "bg-panel-2 text-muted"
                            } ${runnable ? "cursor-pointer hover:opacity-80 ring-1 ring-border hover:ring-accent" : ""}`;
                            return (
                              <div key={step} className="flex items-center gap-1">
                                {i > 0 && <div className="h-px w-4 bg-border" />}
                                {runnable ? (
                                  <button
                                    type="button"
                                    title={`Chạy ${step} ngay`}
                                    className={cls}
                                    onClick={() => doRunStep(step, selected.module!)}
                                  >
                                    <I.Play size={9} className="shrink-0" />
                                    {step}
                                  </button>
                                ) : (
                                  <div title={j?.error ?? j?.message ?? step} className={cls}>
                                    {st === "active" || isRunning ? (
                                      <I.Loader size={10} className="animate-spin shrink-0" />
                                    ) : st === "done" ? (
                                      <I.Check size={10} className="shrink-0" />
                                    ) : st === "error" ? (
                                      <I.X size={10} className="shrink-0" />
                                    ) : null}
                                    {step}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="text-[11px] text-muted">
                            Nhấn bước chưa chạy để thực hiện. discover qua "Port mục này".
                          </span>
                          <div className="ml-auto flex shrink-0 items-center gap-1.5">
                            {activeJob && (
                              <button
                                type="button"
                                disabled={busy != null}
                                title="Dừng tác vụ đang chạy (sau bước hiện tại — giữ tiến độ, resume được)"
                                onClick={() => doCancelJob(activeJob.id)}
                                className="rounded border border-danger/40 px-1.5 py-0.5 text-[10px] text-danger hover:bg-danger/10 disabled:opacity-50"
                              >
                                ⏹ Dừng {activeJob.action}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busy != null}
                              title="Sinh lại proc/file ĐÃ có (ghi đè) — để sửa proc sinh sai"
                              onClick={() => doRunStep("generate", selected.module!, true)}
                              className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                              ↻ Sinh lại (ghi đè)
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                {/* Phase A — Verify proc đã migrate so với golden baseline */}
                {selected.module && (
                  <div className="rounded border border-border bg-bg-soft px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-medium text-muted uppercase tracking-wide">
                        Verify golden
                      </div>
                      <div className="flex items-center gap-1.5">
                        {busy === `fix:${selected.module}` && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => {
                              stopFixRef.current = true;
                            }}
                            icon={<I.X size={11} />}
                          >
                            Dừng
                          </Button>
                        )}
                        {verifyResult &&
                          verifyResult.failed > 0 &&
                          busy !== `fix:${selected.module}` && (
                            <Button
                              size="sm"
                              variant="default"
                              disabled={busy != null}
                              onClick={() => doFixVerifyFails(selected.module!)}
                              icon={<I.Wand size={11} />}
                            >
                              Tự sửa ({verifyResult.failed})
                            </Button>
                          )}
                        <Button
                          size="sm"
                          variant="default"
                          disabled={busy != null}
                          onClick={() => doVerify(selected.module!)}
                          icon={
                            busy === `verify:${selected.module}` ? (
                              <I.Loader size={11} className="animate-spin" />
                            ) : (
                              <I.Check size={11} />
                            )
                          }
                        >
                          Verify proc
                        </Button>
                      </div>
                    </div>
                    {verifyResult && (
                      <div className="mt-1.5 text-[11px]">
                        <span className="text-success font-medium">{verifyResult.verified} ✓</span>
                        {" · "}
                        <span className="text-danger font-medium">{verifyResult.failed} ✗</span>
                        {verifyResult.noGolden > 0 && (
                          <span className="text-muted">
                            {" "}
                            · {verifyResult.noGolden} thiếu golden
                          </span>
                        )}
                        <span className="text-muted"> / {verifyResult.total} proc</span>
                        {verifyResult.procs.filter((p) => !p.verified).length > 0 && (
                          <div className="mt-1 max-h-32 overflow-auto rounded bg-bg p-1.5 font-mono leading-relaxed">
                            {verifyResult.procs
                              .filter((p) => !p.verified)
                              .map((p) => (
                                <div key={p.procName} className="text-danger">
                                  {p.procName}: {p.passedCases}/{p.totalCases}
                                  {p.error ? ` — ${p.error}` : ""}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-1 text-[11px] text-muted">
                      Chạy proc đã port với input golden, so output. Cần capture-golden + generate
                      trước.
                    </div>
                  </div>
                )}

                {detail?.resolved ? (
                  <div className="flex flex-col gap-2 text-sm">
                    <div>
                      <span className="text-muted">Proc ({detail.resolved.procs.length}):</span>
                      <div className="mt-1 max-h-40 overflow-auto rounded bg-bg-soft p-2 font-mono text-[11px] leading-relaxed">
                        {detail.resolved.procs.length
                          ? detail.resolved.procs.join(", ")
                          : "(không có — form dùng pattern khác; seed bảng thủ công ở Migration)"}
                      </div>
                    </div>
                    {detail.resolved.controls.length > 0 && (
                      <div className="text-xs text-muted">
                        Control: {detail.resolved.controls.join(", ")}
                      </div>
                    )}
                    {(detail.resolved.reports?.length ?? 0) > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-violet-700">
                          Báo cáo ({detail.resolved.reports?.length}) — port DỮ LIỆU; in
                          pixel-perfect làm template riêng:
                        </span>
                        {detail.resolved.reports?.map((rc) => {
                          const bp = reportMap[rc];
                          return (
                            <div
                              key={rc}
                              className="rounded border border-violet-100 bg-violet-50/50 p-1.5 text-[11px]"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono">{rc}</span>
                                {bp && (
                                  <span
                                    className={`rounded px-1 ${bp.kind === "table" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
                                  >
                                    {bp.kind === "table"
                                      ? "bảng (auto được)"
                                      : "chứng từ in (template tay)"}
                                  </span>
                                )}
                                {bp && (
                                  <button
                                    type="button"
                                    className="ml-auto rounded bg-violet-600 px-1.5 py-0.5 text-white disabled:opacity-50"
                                    disabled={busy != null}
                                    onClick={() => doScaffoldReport(rc)}
                                  >
                                    {busy === `tpl:${rc}` ? "Đang tạo…" : "Tạo template in"}
                                  </button>
                                )}
                              </div>
                              {bp ? (
                                <div className="mt-0.5 text-muted">
                                  {bp.title && <div>Tiêu đề: {bp.title}</div>}
                                  {bp.dataProcs.length > 0 && (
                                    <div>Proc: {bp.dataProcs.join(", ")}</div>
                                  )}
                                  {bp.columns.length > 0 && (
                                    <div>
                                      Cột ({bp.columns.length}): {bp.columns.join(" · ")}
                                    </div>
                                  )}
                                  {bp.groups.length > 0 && <div>Group: {bp.groups.join(", ")}</div>}
                                </div>
                              ) : (
                                <div className="mt-0.5 text-muted">
                                  Chưa phân tích — bấm "Phân tích báo cáo".
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {detail.resolved.repos.length > 0 && (
                      <div className="text-xs text-muted">
                        Repo: {detail.resolved.repos.join(", ")}
                      </div>
                    )}
                  </div>
                ) : selected.winId ? (
                  <div className="flex items-center gap-1.5 text-sm text-muted">
                    {busy === "resolve" ? (
                      <>
                        <I.Loader size={14} className="animate-spin shrink-0" />
                        Đang resolve…
                      </>
                    ) : detail === null ? (
                      "Đang tải…"
                    ) : (
                      "Chưa resolve — bấm Resolve form→proc."
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-muted">Mục này không mở form (nhóm menu).</div>
                )}

                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={doPort}
                    disabled={busy != null || !detail?.resolved?.procs.length}
                  >
                    <I.Play size={14} /> {busy === "port" ? "Đang port…" : "Port mục này"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setStatus("xong")}>
                    <I.Check size={14} /> Đánh dấu đã port
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setStatus("chua")}>
                    Đặt lại
                  </Button>
                </div>
              </div>
            )}
          </div>
        }
      />
      <Modal
        open={alertMsg !== null}
        onClose={closeAlert}
        title="Thông báo"
        footer={
          <Button variant="primary" onClick={closeAlert}>
            OK
          </Button>
        }
      >
        <p className="text-sm whitespace-pre-wrap">{alertMsg}</p>
      </Modal>
    </div>
  );
}

export const Route = createFileRoute("/settings/cockpit")({
  component: CockpitPage,
});
