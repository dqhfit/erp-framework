/* ==========================================================
   settings.cockpit — Cockpit menu-driven: hiển thị cây menu app cũ
   DQHF (SYS_MENU_NEW), trạng thái port từng mục, và port theo menu.

   Luồng: Import (SYS_MENU_NEW) → Resolve (form .cs → proc/bảng) →
   chọn 1 mục → "Port mục này" (discover scoped) → page mới.
   ========================================================== */

import {
  createLegacyMenuClient,
  createPrintTemplatesClient,
  type LegacyMenuNode,
  type LegacyMenuNodeDetail,
  type LegacyMenuStats,
  type LegacyReport,
} from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { Button } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { buildDqhfIndex, resolveFormProcs as resolveFormProcsBrowser } from "@/lib/dqhf-resolver";

const api = createLegacyMenuClient("");
const printApi = createPrintTemplatesClient("");

/** Cấp tối đa hiển thị trên menu giao diện. Cấp > NAV_MAX_LEVEL dùng cho RBAC. */
const NAV_MAX_LEVEL = 3;

/** Loại bỏ node cấp > NAV_MAX_LEVEL khỏi cây (chỉ dùng cho display). */
function pruneNavTree(nodes: LegacyMenuNode[]): LegacyMenuNode[] {
  return nodes
    .filter((n) => n.level === null || n.level <= NAV_MAX_LEVEL)
    .map((n) => ({ ...n, children: pruneNavTree(n.children) }));
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  chua: { label: "Chưa port", cls: "bg-slate-100 text-slate-600" },
  dang: { label: "Đang port", cls: "bg-amber-100 text-amber-700" },
  xong: { label: "Đã port", cls: "bg-emerald-100 text-emerald-700" },
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
        className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-slate-50 ${
          isSel ? "bg-sky-50 ring-1 ring-sky-200" : ""
        }`}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        {hasChildren ? (
          isOpen ? (
            <I.ChevronDown size={14} className="shrink-0 text-slate-400" />
          ) : (
            <I.ChevronRight size={14} className="shrink-0 text-slate-400" />
          )
        ) : (
          <span className="inline-block w-[14px]" />
        )}
        {hasChildren ? (
          <I.Folder size={14} className="shrink-0 text-amber-500" />
        ) : (
          <I.File size={14} className="shrink-0 text-sky-500" />
        )}
        <span className={`flex-1 truncate ${node.active ? "" : "text-slate-400 line-through"}`}>
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

function CockpitPage() {
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
  const [dirInput, setDirInput] = useState("");
  const [localResolveProgress, setLocalResolveProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const refreshSetup = useCallback(() => {
    api
      .checkSetup()
      .then(setSetup)
      .catch(() => setSetup(null));
  }, []);

  const doSetSourceDir = useCallback(async () => {
    const dir = dirInput.trim();
    if (!dir) return;
    setBusy("setdir");
    try {
      await api.setSourceDir(dir);
      refreshSetup();
    } catch (e) {
      await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [dirInput, refreshSetup]);

  // Kiểm tra config 1 lần khi mount + pre-fill dirInput nếu đã có
  useEffect(() => {
    api
      .checkSetup()
      .then((s) => {
        setSetup(s);
        if (s.dqhfDir) setDirInput(s.dqhfDir);
      })
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
      .catch((e) => dialog.alert(`Lỗi tải menu: ${e?.message ?? e}`))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  const onToggle = useCallback((code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const onSelect = useCallback((node: LegacyMenuNode) => {
    setSelected(node);
    setDetail(null);
    api
      .getResolved(node.sourceCode)
      .then(setDetail)
      .catch((e) => dialog.alert(`Lỗi tải chi tiết: ${e?.message ?? e}`));
  }, []);

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
          await dialog.alert("Chưa có dữ liệu menu — hãy Import menu trước.");
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
        await dialog.alert(
          `Resolve xong: ${summary.withProcs}/${summary.totalForms} form có proc, ${summary.noForm} không thấy file. (${idx.fileCount} .cs đã đọc)`,
        );
        reload();
        if (selected) onSelect(selected);
      } catch (e) {
        await dialog.alert(`Lỗi resolve local: ${(e as Error)?.message ?? e}`);
      } finally {
        setBusy(null);
        setLocalResolveProgress(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [tree, selected, onSelect, reload],
  );

  const doImport = useCallback(async () => {
    setBusy("import");
    try {
      const r = await api.importFromMssql();
      await dialog.alert(
        `Import xong: ${r.imported} mới, ${r.updated} cập nhật (tổng ${r.total}).`,
      );
      reload();
    } catch (e) {
      await dialog.alert(`Lỗi import: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [reload]);

  const doResolve = useCallback(async () => {
    setBusy("resolve");
    try {
      const r = await api.resolveFromSource();
      await dialog.alert(
        `Resolve xong: ${r.withProcs}/${r.totalForms} form có proc, ${r.noForm} không thấy file.`,
      );
      reload();
      if (selected) onSelect(selected);
    } catch (e) {
      await dialog.alert(`Lỗi resolve: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [reload, selected, onSelect]);

  const doParseReports = useCallback(async () => {
    setBusy("reports");
    try {
      const r = await api.parseReports();
      await dialog.alert(
        `Phân tích báo cáo xong: ${r.parsed} report (${r.table} dạng bảng, ${r.document} chứng từ in).`,
      );
      reload();
    } catch (e) {
      await dialog.alert(`Lỗi phân tích báo cáo: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [reload]);

  const doScaffoldReport = useCallback(async (reportClass: string) => {
    setBusy(`tpl:${reportClass}`);
    try {
      const t = await printApi.scaffoldFromReport(reportClass);
      const { html } = await printApi.renderPreview(t.id);
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      window.open(url, "_blank");
    } catch (e) {
      await dialog.alert(`Lỗi tạo template in: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const doPort = useCallback(async () => {
    if (!selected) return;
    const ok = await dialog.confirm(
      `Port mục "${selected.name}"? Sẽ chạy discover scoped theo các bảng form này dùng.`,
    );
    if (!ok) return;
    setBusy("port");
    try {
      const r = await api.portNode(selected.sourceCode);
      await dialog.alert(
        `Đã tạo module "${r.module}" + discover ${r.seedTables.length} bảng (job ${r.jobId.slice(0, 8)}). Tiếp tục enrich/generate ở Settings → Migration.`,
      );
      reload();
      onSelect(selected);
    } catch (e) {
      await dialog.alert(`Lỗi port: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [selected, reload, onSelect]);

  const setStatus = useCallback(
    async (status: "chua" | "dang" | "xong") => {
      if (!selected) return;
      try {
        await api.setPortStatus(selected.sourceCode, status);
        reload();
        onSelect(selected);
      } catch (e) {
        await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
      }
    },
    [selected, reload, onSelect],
  );

  const navTree = useMemo(() => pruneNavTree(tree), [tree]);

  const pct = useMemo(() => {
    if (!stats) return 0;
    const xong = stats.byStatus.xong ?? 0;
    return stats.forms ? Math.round((xong / stats.forms) * 100) : 0;
  }, [stats]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Cockpit — Port theo menu app cũ</h1>
          <p className="text-sm text-slate-500">
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
            disabled={busy != null || !setup?.dqhfDirSet}
            title={
              !setup?.dqhfDirSet
                ? "Cần đặt env DQHF_SOURCE_DIR trỏ vào thư mục source C# DQHF"
                : !setup?.dqhfDirExists
                  ? `Thư mục không tồn tại: ${setup.dqhfDir}`
                  : undefined
            }
          >
            <I.RefreshCw size={14} /> {busy === "resolve" ? "Đang resolve…" : "Resolve form→proc"}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy != null}
            title="Chọn thư mục source C# DQHF trên máy local để phân tích"
          >
            <I.FolderOpen size={14} />
            {busy === "local-resolve" ? (localResolveProgress ?? "Đang resolve…") : "Resolve local"}
          </Button>
          <Button variant="default" size="sm" onClick={doParseReports} disabled={busy != null}>
            <I.File size={14} /> {busy === "reports" ? "Đang phân tích…" : "Phân tích báo cáo"}
          </Button>
          {/* Hidden folder picker — chỉ nhận .cs files */}
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

      {/* Banner cảnh báo cấu hình */}
      {setup && (!setup.dqhfDirSet || !setup.dqhfDirExists || !setup.mssqlOk) && (
        <div className="flex flex-col gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <div className="font-medium flex items-center gap-1.5">
            <I.AlertCircle size={14} className="shrink-0" />
            Cấu hình chưa đủ — một số chức năng bị vô hiệu:
          </div>
          <ul className="ml-5 list-disc space-y-1.5 text-xs">
            {!setup.mssqlOk && (
              <li>
                <b>MSSQL chưa kết nối</b> — nút "Import menu" bị tắt. Kiểm tra connection ở{" "}
                <span className="font-mono">Settings → Migration</span>.
              </li>
            )}
            {(!setup.dqhfDirSet || !setup.dqhfDirExists) && (
              <li className="list-none -ml-4">
                <div className="mb-1">
                  {!setup.dqhfDirSet ? (
                    <>
                      <b>Thư mục source C# DQHF chưa đặt</b> — nút "Resolve form→proc" bị tắt.
                    </>
                  ) : (
                    <>
                      <b>Thư mục không tồn tại:</b>{" "}
                      <span className="font-mono">{setup.dqhfDir}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={dirInput}
                    onChange={(e) => setDirInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && doSetSourceDir()}
                    placeholder="VD: D:\code\DotNET\DQHF"
                    className="flex-1 rounded border border-amber-300 bg-white px-2 py-1 font-mono text-xs text-slate-700 focus:border-sky-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={doSetSourceDir}
                    disabled={busy === "setdir" || !dirInput.trim()}
                    className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {busy === "setdir" ? "Đang đặt…" : "Đặt thư mục"}
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-amber-600">
                  Chỉ lưu trong session hiện tại — restart server cần đặt lại hoặc thêm vào{" "}
                  <span className="font-mono">.env</span>.
                </div>
              </li>
            )}
          </ul>
        </div>
      )}

      {stats && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
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
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500">
              +{stats.rbacNodes} thao tác RBAC (cấp &gt;3, ẩn trên menu)
            </span>
          )}
          <span className="ml-auto text-slate-500">Tiến độ: {pct}%</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_360px] gap-3">
        {/* Cây menu */}
        <div className="min-h-0 overflow-auto rounded border border-slate-200 p-1.5">
          {loading ? (
            <div className="p-4 text-sm text-slate-400">Đang tải…</div>
          ) : tree.length === 0 ? (
            <div className="p-4 text-sm text-slate-400">
              Chưa có dữ liệu — bấm "Import menu" để nạp SYS_MENU_NEW.
            </div>
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

        {/* Chi tiết node */}
        <div className="min-h-0 overflow-auto rounded border border-slate-200 p-3">
          {!selected ? (
            <div className="text-sm text-slate-400">Chọn 1 mục menu có form để xem chi tiết.</div>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">{selected.name}</h2>
                  <StatusBadge status={selected.portStatus} />
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  [{selected.sourceCode}] {selected.winId ?? "(không có form)"}
                  {selected.namespace ? ` · ${selected.namespace}` : ""}
                </div>
                {selected.module && (
                  <div className="mt-0.5 text-xs text-slate-500">module: {selected.module}</div>
                )}
              </div>

              {detail?.resolved ? (
                <div className="flex flex-col gap-2 text-sm">
                  <div>
                    <span className="text-slate-500">Proc ({detail.resolved.procs.length}):</span>
                    <div className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 font-mono text-[11px] leading-relaxed">
                      {detail.resolved.procs.length
                        ? detail.resolved.procs.join(", ")
                        : "(không có — form dùng pattern khác; seed bảng thủ công ở Migration)"}
                    </div>
                  </div>
                  {detail.resolved.controls.length > 0 && (
                    <div className="text-xs text-slate-500">
                      Control: {detail.resolved.controls.join(", ")}
                    </div>
                  )}
                  {(detail.resolved.reports?.length ?? 0) > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-violet-700">
                        Báo cáo ({detail.resolved.reports!.length}) — port DỮ LIỆU; in pixel-perfect
                        làm template riêng:
                      </span>
                      {detail.resolved.reports!.map((rc) => {
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
                              <div className="mt-0.5 text-slate-600">
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
                              <div className="mt-0.5 text-slate-400">
                                Chưa phân tích — bấm "Phân tích báo cáo".
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {detail.resolved.repos.length > 0 && (
                    <div className="text-xs text-slate-500">
                      Repo: {detail.resolved.repos.join(", ")}
                    </div>
                  )}
                </div>
              ) : selected.winId ? (
                <div className="flex items-center gap-1.5 text-sm text-slate-400">
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
                <div className="text-sm text-slate-400">Mục này không mở form (nhóm menu).</div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
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
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/cockpit")({
  component: CockpitPage,
});
