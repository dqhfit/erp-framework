/* ==========================================================
   DataSourceSqlPanel — "Tạo nguồn dữ liệu bằng SQL" cho người quen
   viết T-SQL. Viết SELECT/JOIN/WHERE/ORDER BY quen thuộc → parse →
   DataSourceConfig (qua compileDataSourceDsl) → lưu store. KHÔNG chạy
   SQL thô lên DB: engine vẫn batch-stitch an toàn (multi-tenant +
   RBAC theo field + giải mã). Round-trip 2 chiều với Cấu hình/Canvas/DSL.

   - "Đồng bộ": sinh SQL từ cấu hình hiện tại (dataSourceToSql).
   - "Áp dụng": sqlToDataSource → setContent. Cột tính toán (formula)
     KHÔNG biểu diễn được bằng SQL → GIỮ NGUYÊN từ cấu hình cũ.
   ========================================================== */

import { createObjectsClient } from "@erp-framework/client";
import {
  type DataSourceConfig,
  type DataSourceRow,
  type DslEntity,
  dataSourceToSql,
  sqlToDataSource,
} from "@erp-framework/core";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { SqlEditor, type SqlEditorHandle } from "@/components/designer/SqlEditor";
import { I } from "@/components/Icons";
import { Button, Card, SearchableSelect } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import type { MockEntity } from "@/lib/object-types";
import { slugify, useUserObjects } from "@/stores/userObjects";

const dsApi = createObjectsClient("");
const EMPTY: DataSourceConfig = { baseEntityId: "", relations: [], fields: [] };

/** Giải mã nội dung file .sql — tự dò BOM (SSMS hay lưu UTF-16 LE), fallback UTF-8. */
function decodeSqlBuffer(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
    return new TextDecoder("utf-8").decode(b.subarray(3));
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff)
    return new TextDecoder("utf-16be").decode(b.subarray(2));
  return new TextDecoder("utf-8").decode(b);
}

/** Cột phẳng (key) của 1 config — cho header bảng kết quả. */
function previewKeys(cfg: DataSourceConfig): string[] {
  const keys = [
    ...cfg.fields.map((f) => f.key),
    ...(cfg.aggregates ?? []).map((a) => a.key),
    ...(cfg.computed ?? []).map((c) => c.key),
  ];
  return keys.length ? keys : ["id"];
}

/** Hiển thị 1 ô kết quả (object → JSON gọn, null/undefined → rỗng). */
function fmtCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** MockEntity[] → DslEntity[] (catalog cho parser: nhãn + TÊN KỸ THUẬT + field). */
function toDslEntities(entities: MockEntity[]): DslEntity[] {
  const nameById = new Map(entities.map((e) => [e.id, e.name]));
  return entities.map((e) => ({
    id: e.id,
    name: e.name,
    techName: e.techName, // tham chiếu bền vững qua đổi nhãn
    primaryKey: e.primaryKey
      ? (e.fields.find((f) => f.id === e.primaryKey)?.name ?? undefined)
      : undefined,
    fields: e.fields.map((f) => ({
      name: f.name,
      type: f.type,
      ref: f.ref ? (nameById.get(f.ref) ?? f.ref) : undefined,
    })),
  }));
}

const SAMPLE = `-- Ví dụ: gộp Đơn hàng + Khách hàng + đếm số dòng
SELECT
  base.ma,
  base.tong_tien,
  kh.ten AS ten_kh,
  (SELECT COUNT(*) FROM dong_hang c WHERE c.don_id = base.id) AS so_dong
FROM don_hang AS base
LEFT JOIN khach_hang AS kh ON base.khach_id = kh.id
WHERE base.tong_tien > 0
ORDER BY base.tong_tien DESC
LIMIT 100`;

/** Split DỌC kéo được: pane trên (editor) / pane dưới (kết quả). Lưu chiều cao
 *  pane trên vào localStorage để giữ qua các lần mở. */
function VSplit({
  top,
  bottom,
  storageKey,
  defaultTop = 240,
  // Cho kéo co nhỏ nhiều: editor xuống ~44px (1-2 dòng), kết quả ~56px (vẫn thấy
  // header + 1 dòng) — đủ nhỏ mà không co về 0 (mất bảng kết quả).
  minTop = 44,
  minBottom = 56,
}: {
  top: ReactNode;
  bottom: ReactNode;
  storageKey?: string;
  defaultTop?: number;
  minTop?: number;
  minBottom?: number;
}) {
  const [topH, setTopH] = useState<number>(() => {
    if (storageKey) {
      const s = localStorage.getItem(storageKey);
      if (s) return Number(s);
    }
    return defaultTop;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = topH;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const h = containerRef.current.offsetHeight;
      const delta = e.clientY - startY.current;
      setTopH(Math.max(minTop, Math.min(h - minBottom - 6, startH.current + delta)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (storageKey) localStorage.setItem(storageKey, String(topH));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [topH, minTop, minBottom, storageKey]);

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      {/* Pane trên (editor) — KHÔNG overflow-hidden để popup gợi ý tràn ra được. */}
      <div className="flex flex-col" style={{ height: topH, minHeight: minTop }}>
        {top}
      </div>
      {/* Thanh kéo dọc */}
      {/* biome-ignore lint/a11y/useSemanticElements: div separator cho thao tác kéo */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={topH}
        aria-valuemin={minTop}
        aria-valuemax={9999}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 50 : 10;
          if (e.key === "ArrowUp") setTopH((v) => Math.max(minTop, v - step));
          else if (e.key === "ArrowDown") setTopH((v) => v + step);
        }}
        className="group relative z-10 my-1 flex h-[6px] shrink-0 cursor-row-resize items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="h-px w-full bg-border transition-colors group-hover:bg-accent group-active:bg-accent" />
        <div className="absolute flex h-[6px] w-8 items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100">
          <div className="h-[3px] w-4 rounded-full bg-accent" />
        </div>
      </div>
      {/* Pane dưới (kết quả) — fill phần còn lại; minHeight để KHÔNG bị co về 0
          (flex-basis 0 + hết chỗ trống → mất bảng kết quả). */}
      <div className="flex flex-1 flex-col overflow-hidden" style={{ minHeight: minBottom }}>
        {bottom}
      </div>
    </div>
  );
}

/** id có thể bỏ trống → màn hình SQL độc lập (mở từ menu): soạn rồi LƯU thành
 *  nguồn dữ liệu mới hoặc ÁP DỤNG vào nguồn dữ liệu hiện có. */
export function DataSourceSqlPanel({ id }: { id?: string }) {
  const entities = useUserObjects((s) => s.entities);
  const dataSources = useUserObjects((s) => s.dataSources);
  const cfg = useUserObjects((s) => (id ? s.dataSourceContent[id] : undefined)) ?? EMPTY;
  const setContent = useUserObjects((s) => s.setDataSourceContent);
  const addDataSource = useUserObjects((s) => s.addDataSource);
  const dsName = id ? (dataSources.find((d) => d.id === id)?.name ?? "") : "";
  const navigate = useNavigate();

  const dslEntities = useMemo(() => toDslEntities(entities), [entities]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [code, setCode] = useState(() =>
    cfg.baseEntityId ? dataSourceToSql(cfg, toDslEntities(entities)) : SAMPLE,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // Đích lưu: id NDL hiện có, hoặc "__new__" = tạo mới. Mặc định = NDL đang mở.
  const [target, setTarget] = useState<string>(id ?? "__new__");

  const editorRef = useRef<SqlEditorHandle>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    cols: string[];
    rows: DataSourceRow[];
    total: number;
    selection: boolean;
  } | null>(null);

  // Esc thoát fullscreen (popup gợi ý đã stopPropagation nên không đụng nhau).
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const syncFromConfig = () => {
    setCode(cfg.baseEntityId ? dataSourceToSql(cfg, dslEntities) : SAMPLE);
    setErrors([]);
    setWarnings([]);
    setStatus(null);
  };

  /* Lưu SQL hiện tại ra file .sql (tải xuống). */
  const exportSql = () => {
    const blob = new Blob([code], { type: "application/sql;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(dsName) || "nguon-du-lieu"}.sql`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus({ kind: "ok", text: `Đã lưu ${a.download}.` });
  };

  /* Nhập (import) file .sql từ máy — giải mã BOM (kể cả UTF-16 từ SSMS), nạp vào editor. */
  const importSql = async (file: File) => {
    try {
      const text = decodeSqlBuffer(await file.arrayBuffer());
      setCode(text);
      setResult(null);
      setErrors([]);
      setWarnings([]);
      setStatus({
        kind: "ok",
        text: `Đã nhập "${file.name}" (${text.length} ký tự). Bấm Chạy / Áp dụng để dùng.`,
      });
    } catch (e) {
      setStatus({ kind: "err", text: `Không đọc được file: ${(e as Error).message}` });
    }
  };

  /* Chạy SQL (vùng chọn / câu tại con trỏ) — compile rồi preview KHÔNG lưu. */
  const runSql = async (sql: string, isSelection: boolean) => {
    const res = sqlToDataSource(sql, dslEntities);
    setErrors(res.errors);
    setWarnings(res.warnings);
    if (res.errors.length > 0) {
      setStatus({ kind: "err", text: `${res.errors.length} lỗi — chưa chạy được.` });
      return;
    }
    if (!res.config.baseEntityId) {
      setStatus({ kind: "err", text: "Thiếu FROM <đối tượng gốc> — không có gì để chạy." });
      return;
    }
    setRunning(true);
    setStatus(null);
    try {
      const limit = res.config.defaultLimit ?? 100;
      const out = await dsApi.dataSources.preview(res.config, { limit });
      setResult({
        cols: previewKeys(res.config),
        rows: out.rows as DataSourceRow[],
        total: out.total,
        selection: isSelection,
      });
      setStatus({
        kind: "ok",
        text: `Chạy ${isSelection ? "vùng chọn" : "câu lệnh"}: ${out.rows.length}/${out.total} dòng${
          res.warnings.length ? ` (${res.warnings.length} cảnh báo)` : ""
        }.`,
      });
    } catch (e) {
      setStatus({ kind: "err", text: `Lỗi chạy: ${(e as Error).message}` });
    } finally {
      setRunning(false);
    }
  };

  /* Lưu thành NDL mới (target="__new__") hoặc áp dụng vào NDL hiện có. */
  const saveOrApply = async () => {
    const res = sqlToDataSource(code, dslEntities);
    setErrors(res.errors);
    setWarnings(res.warnings);
    if (res.errors.length > 0) {
      setStatus({ kind: "err", text: `${res.errors.length} lỗi — chưa lưu được.` });
      return;
    }
    if (!res.config.baseEntityId) {
      setStatus({ kind: "err", text: "Thiếu FROM <đối tượng gốc> — chưa có gì để lưu." });
      return;
    }
    const summary = (c: DataSourceConfig) =>
      `${c.relations.length} join · ${c.fields.length} cột${
        c.aggregates?.length ? ` · ${c.aggregates.length} aggregate` : ""
      }${res.warnings.length ? ` (${res.warnings.length} cảnh báo)` : ""}`;

    if (target === "__new__") {
      const name = (
        await dialog.prompt("Tên nguồn dữ liệu mới", dsName || "", {
          title: "Lưu thành nguồn dữ liệu",
        })
      )?.trim();
      if (!name) return;
      const newId = crypto.randomUUID();
      addDataSource({ id: newId, name, icon: "Database" });
      setContent(newId, res.config);
      setStatus({ kind: "ok", text: `Đã tạo "${name}": ${summary(res.config)}.` });
      navigate({ to: "/datasources/$id", params: { id: newId } });
      return;
    }
    // Áp dụng vào NDL hiện có — giữ computed của ĐÍCH (SQL không biểu diễn formula).
    const targetCfg = useUserObjects.getState().dataSourceContent[target] ?? EMPTY;
    const next: DataSourceConfig = {
      ...res.config,
      ...(targetCfg.computed?.length ? { computed: targetCfg.computed } : {}),
    };
    setContent(target, next);
    const tname = dataSources.find((d) => d.id === target)?.name ?? "nguồn dữ liệu";
    setStatus({ kind: "ok", text: `Đã áp dụng vào "${tname}": ${summary(next)}.` });
  };

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-[60] bg-bg flex flex-col gap-2 p-4"
          : "flex h-full flex-col gap-2 p-3 overflow-hidden"
      }
    >
      {/* ── Editor SQL (chiếm trọn chiều cao) ── */}
      <Card className="p-3 space-y-2 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-2 flex-wrap gap-y-1.5">
          <div className="text-sm font-semibold text-text flex-1 min-w-[140px] flex items-center gap-1.5">
            <I.Database size={14} className="text-accent shrink-0" />
            Soạn SQL
            <span className="text-[10px] font-normal text-muted hidden md:inline">
              · bôi đen 1 câu rồi{" "}
              <kbd className="px-1 rounded bg-bg-soft border border-border">Ctrl/⌘</kbd>+
              <kbd className="px-1 rounded bg-bg-soft border border-border">Enter</kbd> chạy
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".sql,.txt,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importSql(f);
              e.target.value = ""; // cho phép chọn lại cùng file
            }}
          />
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            className="h-7 w-7 rounded-md hover:bg-hover/60 flex items-center justify-center text-muted hover:text-text shrink-0"
            title={fullscreen ? "Thu nhỏ (Esc)" : "Toàn màn hình"}
          >
            {fullscreen ? <I.Minimize size={14} /> : <I.Maximize size={14} />}
          </button>
          <Button
            variant="ghost"
            size="sm"
            icon={<I.FolderOpen size={12} />}
            onClick={() => fileRef.current?.click()}
            title="Mở file .sql từ máy (nhận cả file SSMS/MSSQL UTF-16)"
          >
            Mở .sql
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<I.Download size={12} />}
            onClick={exportSql}
            title="Lưu SQL hiện tại ra file .sql trên máy"
          >
            Lưu .sql
          </Button>
          <Button
            variant="default"
            size="sm"
            icon={running ? <I.Loader size={12} className="animate-spin" /> : <I.Play size={12} />}
            onClick={() => editorRef.current?.run()}
            disabled={running}
            title="Chạy vùng chọn (hoặc câu lệnh tại con trỏ) — Ctrl/⌘+Enter"
          >
            Chạy
          </Button>
          {id && (
            <Button
              variant="ghost"
              size="sm"
              icon={<I.Database size={12} />}
              onClick={syncFromConfig}
              title="Sinh SQL từ cấu hình hiện tại"
            >
              Đồng bộ
            </Button>
          )}
          <SearchableSelect
            className="w-44 shrink-0"
            value={target}
            onChange={setTarget}
            options={[
              { value: "__new__", label: "➕ Nguồn dữ liệu mới…" },
              ...dataSources.map((d) => ({ value: d.id, label: d.name })),
            ]}
            placeholder="Lưu vào…"
            searchPlaceholder="Tìm nguồn dữ liệu…"
          />
          <Button
            variant="primary"
            size="sm"
            icon={target === "__new__" ? <I.Save size={12} /> : <I.Check size={12} />}
            onClick={() => void saveOrApply()}
            title={
              target === "__new__"
                ? "Lưu SQL thành nguồn dữ liệu mới"
                : "Áp dụng SQL vào nguồn dữ liệu đã chọn"
            }
          >
            {target === "__new__" ? "Lưu thành NDL" : "Áp dụng"}
          </Button>
        </div>

        {/* Trạng thái + lỗi/cảnh báo — strip cố định, ngay dưới thanh công cụ. */}
        {status && (
          <div
            className={`text-xs ${status.kind === "ok" ? "text-success" : "text-danger"} flex items-center gap-1.5 shrink-0`}
          >
            {status.kind === "ok" ? <I.Check size={12} /> : <I.X size={12} />}
            {status.text}
          </div>
        )}
        {(errors.length > 0 || warnings.length > 0) && (
          <div className="shrink-0 max-h-24 overflow-auto">
            {errors.length > 0 && (
              <ul className="text-xs text-danger list-disc pl-5 space-y-0.5">
                {errors.map((er) => (
                  <li key={er}>{er}</li>
                ))}
              </ul>
            )}
            {warnings.length > 0 && (
              <ul className="text-[11px] text-warning list-disc pl-5 space-y-0.5">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Split dọc: editor (trên) ⇕ kết quả (dưới) — kéo thanh giữa để đổi tỉ lệ. */}
        <VSplit
          storageKey={`ds-sql-split-${id ?? "new"}`}
          top={
            <SqlEditor
              ref={editorRef}
              className="flex-1 min-h-0"
              value={code}
              onChange={setCode}
              entities={dslEntities}
              onRun={runSql}
              placeholder="SELECT base.ma FROM don_hang base …"
            />
          }
          bottom={
            result ? (
              <div className="flex h-full flex-col rounded-lg border border-border overflow-hidden">
                <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border bg-bg-soft shrink-0">
                  <I.Table size={12} className="text-accent shrink-0" />
                  <span className="text-xs font-semibold">
                    Kết quả {result.selection ? "(vùng chọn)" : ""} · {result.rows.length}/
                    {result.total} dòng
                  </span>
                  <button
                    type="button"
                    onClick={() => setResult(null)}
                    className="ml-auto w-5 h-5 rounded hover:bg-hover/60 flex items-center justify-center text-muted"
                    title="Đóng kết quả"
                  >
                    <I.X size={12} />
                  </button>
                </div>
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-panel border-b border-border text-muted sticky top-0">
                        {result.cols.map((k) => (
                          <th
                            key={k}
                            className="px-2 py-1 text-left whitespace-nowrap font-mono"
                            title={k}
                          >
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row) => (
                        <tr key={row.id} className="border-b border-border/50 last:border-0">
                          {result.cols.map((k) => (
                            <td key={k} className="px-2 py-1 whitespace-nowrap">
                              {fmtCell(row[k])}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {result.rows.length === 0 && (
                        <tr>
                          <td
                            className="px-2 py-2 text-muted italic"
                            colSpan={Math.max(1, result.cols.length)}
                          >
                            Không có dòng nào khớp.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1.5 text-muted rounded-lg border border-dashed border-border">
                <I.Table size={22} className="opacity-40" />
                <p className="text-xs">
                  Bôi đen 1 câu rồi <b>Chạy</b> (Ctrl/⌘+Enter) để xem kết quả ở đây.
                </p>
              </div>
            )
          }
        />
      </Card>

      {/* ── Cú pháp hỗ trợ (thu gọn) ── */}
      <Card className="p-2.5 shrink-0">
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className="w-full flex items-center gap-1.5 text-xs font-semibold text-text"
        >
          <I.ChevronDown
            size={13}
            className={`text-muted transition-transform ${showHelp ? "" : "-rotate-90"}`}
          />
          Cú pháp hỗ trợ
        </button>
        {showHelp && (
          <>
            <ul className="mt-2 text-[11px] text-muted space-y-1 list-disc pl-5">
              <li>
                <code>FROM &lt;ĐốiTượngGốc&gt; [AS] base</code> — đối tượng gốc (gốc ghi).
              </li>
              <li>
                <code>LEFT|INNER JOIN &lt;ĐốiTượng&gt; alias ON cha.cột = alias.cột</code> — quan hệ
                many-to-one. <code>LEFT</code>=giữ dòng gốc, <code>INNER</code>=lọc thiếu. Lồng
                nhiều tầng: <code>ON</code> trỏ alias của join trước.
              </li>
              <li>
                <code>SELECT node.cột [AS khoá]</code>, <code>node.*</code>, hoặc <code>*</code> (=
                toàn bộ field gốc).
              </li>
              <li>
                Aggregate 1-N bằng subquery tương quan:{" "}
                <code>(SELECT COUNT(*) FROM Con c WHERE c.fk = base.id) AS so_con</code> — đổi COUNT
                thành SUM/AVG/MIN/MAX(c.cột) để gom giá trị.
              </li>
              <li>
                <code>WHERE base.cột =/&gt;/&lt;/LIKE/IN …</code> — CHỈ field gốc (lọc server-side,
                nối bằng <code>AND</code>). Điều kiện trên field join để lọc ở widget.
              </li>
              <li>
                <code>ORDER BY cột [ASC|DESC]</code> · <code>LIMIT n</code> hoặc{" "}
                <code>SELECT TOP n</code>.
              </li>
            </ul>
            <p className="mt-1.5 text-[11px] text-muted">
              Round-trip 2 chiều với tab <b>Cấu hình</b> / <b>Canvas</b> / <b>Code &amp; AI</b>. Cột
              tính toán (formula) quản ở những tab đó — áp dụng SQL sẽ GIỮ NGUYÊN chúng. Muốn AI
              sinh giúp thì dùng tab Code &amp; AI.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
