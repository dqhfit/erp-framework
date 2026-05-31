/* ==========================================================
   settings.cockpit — Cockpit menu-driven: hiển thị cây menu app cũ
   DQHF (SYS_MENU_NEW), trạng thái port từng mục, và port theo menu.

   Luồng: Import (SYS_MENU_NEW) → Resolve (form .cs → proc/bảng) →
   chọn 1 mục → "Port mục này" (discover scoped) → page mới.
   ========================================================== */

import {
  createLegacyMenuClient,
  type LegacyMenuNode,
  type LegacyMenuNodeDetail,
  type LegacyMenuStats,
} from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const api = createLegacyMenuClient("");

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

function CockpitPage() {
  const [tree, setTree] = useState<LegacyMenuNode[]>([]);
  const [stats, setStats] = useState<LegacyMenuStats | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<LegacyMenuNode | null>(null);
  const [detail, setDetail] = useState<LegacyMenuNodeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.listTree(), api.stats()])
      .then(([t, s]) => {
        setTree(t);
        setStats(s);
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
    } catch (e) {
      await dialog.alert(`Lỗi resolve: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  }, [reload]);

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
          <Button variant="default" size="sm" onClick={doImport} disabled={busy != null}>
            <I.Download size={14} /> {busy === "import" ? "Đang import…" : "Import menu"}
          </Button>
          <Button variant="default" size="sm" onClick={doResolve} disabled={busy != null}>
            <I.RefreshCw size={14} /> {busy === "resolve" ? "Đang resolve…" : "Resolve form→proc"}
          </Button>
        </div>
      </div>

      {stats && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span>
            <b>{stats.total}</b> node
          </span>
          <span>
            <b>{stats.forms}</b> mục có form
          </span>
          <StatusBadge status="chua" /> <b>{stats.byStatus.chua ?? 0}</b>
          <StatusBadge status="dang" /> <b>{stats.byStatus.dang ?? 0}</b>
          <StatusBadge status="xong" /> <b>{stats.byStatus.xong ?? 0}</b>
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
            tree.map((n) => (
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
                  {detail.resolved.repos.length > 0 && (
                    <div className="text-xs text-slate-500">
                      Repo: {detail.resolved.repos.join(", ")}
                    </div>
                  )}
                </div>
              ) : selected.winId ? (
                <div className="text-sm text-slate-400">
                  {detail === null ? "Đang tải resolve…" : "Chưa resolve — bấm Resolve form→proc."}
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
