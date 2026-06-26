/* ==========================================================
   report-widget.tsx — Widget "report": nguồn dữ liệu là 1 read-proc
   Tier D (module-procs) thay vì entity/datasource. Dùng cho các BÁO
   CÁO cần AGGREGATE server-side (tồn kho, nhập-xuất-tồn, tổng hợp chi
   tiết) mà list/DataSource không biểu diễn được (DS không groupBy
   server-side; list chỉ đọc row-level).

   Luồng: render thanh filter (ngày/select/text) → người dùng bấm "Xem"
   (hoặc auto khi đủ điều kiện) → gọi `procs.invokeModule(procName, args)`
   → proc trả MẢNG object đã tính sẵn → render qua DataGrid (client-side
   sort/lọc/phân trang/xuất). Proc tự cô lập tenant qua company_id +
   gate run/procedure ở endpoint.

   Cấu hình (cfg):
   - procName   : tên export camelCase của module-proc (vd "trTonkhoThanhphamGetall").
   - title?     : tiêu đề.
   - autoLoad?  : true → nạp ngay khi mở (báo cáo không cần tham số / dùng default).
   - filters[]  : {key,label,type:"date"|"month"|"text"|"select",options?,
                   default?,required?,reloadOnChange?} — value gửi làm proc arg `key`.
                   default token: "$today"/"$firstOfMonth"/"$lastOfMonth".
   - staticArgs?: object hằng trộn vào args (vd cờ cố định).
   - columns[]  : {field,label,type?,align?,summary?,decimals?,width?} — cột hiển thị.
                  Thiếu columns → tự suy từ key dòng đầu.
   - pageSize?  : số dòng/trang (DataGrid).
   - emptyText? : chữ khi rỗng.
   ========================================================== */
import { createProceduresClient } from "@erp-framework/client";
import type { ColumnDef } from "@tanstack/react-table";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { DataGrid } from "@/components/renderer/DataGrid";
import { fmtDateCell } from "@/components/renderer/date-cell-utils";
import { usePageState } from "@/components/renderer/page-data";
import { Button, EmptyState, Input, Select } from "@/components/ui";

const procs = createProceduresClient("");

type FilterType = "date" | "month" | "text" | "select";
interface ReportFilter {
  key: string;
  label: string;
  type: FilterType;
  options?: Array<{ value: string; label: string }>;
  default?: string;
  required?: boolean;
  /** Đổi giá trị → tự nạp lại (mặc định: date/month/select = true, text = false). */
  reloadOnChange?: boolean;
  /** Rộng input (px). */
  width?: number;
}
type ColType = "text" | "number" | "date" | "datetime" | "boolean";
interface ReportColumn {
  field: string;
  label?: string;
  type?: ColType;
  align?: "left" | "right" | "center";
  summary?: "sum" | "avg" | "count" | false;
  decimals?: number;
  width?: number;
}

/** YYYY-MM-DD theo LOCAL date (input type=date dùng định dạng này). */
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function resolveDefault(raw: string | undefined): string {
  if (!raw) return "";
  const now = new Date();
  switch (raw) {
    case "$today":
      return isoDate(now);
    case "$firstOfMonth":
      return isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
    case "$lastOfMonth":
      return isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    default:
      return raw;
  }
}
/** Filter tự nạp lại khi đổi: date/month/select mặc định true, text false. */
function isAutoReload(f: ReportFilter): boolean {
  return f.reloadOnChange ?? f.type !== "text";
}

const numFmt = (decimals: number) =>
  new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

export function ReportWidget({ cfg }: { cfg: Record<string, unknown> }) {
  const procName = (cfg.procName as string) || "";
  const title = cfg.title as string | undefined;
  const filters = useMemo(() => (cfg.filters as ReportFilter[] | undefined) ?? [], [cfg.filters]);
  const staticArgs = (cfg.staticArgs as Record<string, unknown> | undefined) ?? undefined;
  const autoLoad = cfg.autoLoad === true;
  const pageSize = (cfg.pageSize as number | undefined) ?? 50;
  const emptyText = (cfg.emptyText as string | undefined) ?? "Chưa có dữ liệu.";
  const uid = useId();
  const pageState = usePageState();

  // Giá trị filter khởi tạo từ default (token $today...).
  const initialValues = useMemo(() => {
    const v: Record<string, string> = {};
    for (const f of filters) v[f.key] = resolveDefault(f.default);
    return v;
  }, [filters]);
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  // Reset khi cấu hình filter đổi (đổi trang/đổi widget).
  useEffect(() => setValues(initialValues), [initialValues]);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Đủ điều kiện nạp: mọi filter required phải có giá trị.
  const missingRequired = useMemo(
    () => filters.some((f) => f.required && !String(values[f.key] ?? "").trim()),
    [filters, values],
  );

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!procName || missingRequired) return;
    setLoading(true);
    setErr("");
    try {
      const args: Record<string, unknown> = { ...staticArgs };
      for (const f of filters) {
        const v = values[f.key];
        if (v != null && String(v).trim() !== "") args[f.key] = v;
      }
      const { output } = await procs.invokeModule(procName, args);
      if (!aliveRef.current) return;
      setRows(Array.isArray(output) ? (output as Record<string, unknown>[]) : []);
      setLoaded(true);
    } catch (e) {
      if (aliveRef.current) setErr((e as Error).message);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [procName, filters, values, staticArgs, missingRequired]);

  // Nạp lần đầu: autoLoad (hoặc không có filter required) → tự gọi 1 lần khi đủ điều kiện.
  const didInit = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: cố ý chỉ chạy 1 lần khi đủ điều kiện; load/filters đọc qua closure mới nhất, didInit chặn lặp
  useEffect(() => {
    if (didInit.current || missingRequired) return;
    if (autoLoad || filters.every((f) => !f.required)) {
      didInit.current = true;
      void load();
    }
  }, [autoLoad, missingRequired, load]);

  // Auto nạp lại khi filter date/month/select đổi (text chỉ qua nút/Enter).
  const autoSig = useMemo(() => {
    const o: Record<string, string> = {};
    for (const f of filters) if (isAutoReload(f)) o[f.key] = values[f.key] ?? "";
    return JSON.stringify(o);
  }, [filters, values]);
  const autoInit = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ bám autoSig (chuỗi ổn định); bỏ lần đầu vì init load lo; load đọc values mới qua closure
  useEffect(() => {
    if (!autoInit.current) {
      autoInit.current = true;
      return;
    }
    if (!missingRequired) void load();
  }, [autoSig]);

  // Tín hiệu refresh ngoài (nút actionbar set __refresh:report:<procName>).
  const refreshTag = pageState.get(`__refresh:report:${procName}`) as number | undefined;
  const prevRefresh = useRef<number | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ phản ứng tín hiệu refreshTag; load/loaded đọc qua closure mới nhất
  useEffect(() => {
    if (refreshTag !== undefined && refreshTag !== prevRefresh.current) {
      prevRefresh.current = refreshTag;
      if (loaded) void load();
    }
  }, [refreshTag]);

  // Cột DataGrid từ cfg.columns (hoặc suy từ dòng đầu).
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    let cols = cfg.columns as ReportColumn[] | undefined;
    const first = rows[0];
    if ((!cols || cols.length === 0) && first) {
      cols = Object.keys(first).map((k) => ({ field: k }));
    }
    if (!cols) return [];
    return cols.map((c) => {
      const isNum = c.type === "number";
      const fmt = isNum ? numFmt(c.decimals ?? 0) : null;
      const align = c.align ?? (isNum ? "right" : "left");
      return {
        id: c.field,
        accessorKey: c.field,
        header: c.label ?? c.field,
        enableGrouping: true,
        meta: {
          techName: c.field,
          ...(c.summary
            ? { summary: c.summary }
            : isNum
              ? { summary: "sum" as const }
              : { noSummary: true }),
        },
        cell: (ctx) => {
          const raw = ctx.getValue();
          let disp: string;
          if (raw == null || raw === "") disp = "";
          else if (isNum && fmt) {
            const n = Number(raw);
            disp = Number.isNaN(n) ? String(raw) : fmt.format(n);
          } else if (c.type === "date" || c.type === "datetime") {
            disp = fmtDateCell(String(raw), c.type === "datetime");
          } else if (c.type === "boolean") {
            const sv = String(raw).toLowerCase();
            disp = raw === true || sv === "true" || sv === "1" || sv === "có" ? "✓" : "";
          } else disp = String(raw);
          return (
            <span
              className="block truncate"
              style={{ textAlign: align === "center" ? "center" : align }}
            >
              {disp}
            </span>
          );
        },
      };
    });
  }, [cfg.columns, rows]);

  if (!procName) {
    return (
      <div className="p-3 text-xs text-muted">
        Báo cáo chưa cấu hình — đặt <code>procName</code> ở trình thiết kế.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-2 gap-2">
      {(title || filters.length > 0) && (
        <div className="flex flex-wrap items-end gap-2">
          {title ? <div className="text-sm font-medium mr-2 self-center">{title}</div> : null}
          {filters.map((f) => {
            const id = `${uid}-${f.key}`;
            const style = f.width ? { width: f.width } : undefined;
            return (
              <div key={f.key} className="flex flex-col gap-0.5">
                <label htmlFor={id} className="text-[11px] text-muted">
                  {f.label}
                  {f.required ? <span className="text-danger"> *</span> : null}
                </label>
                {f.type === "select" ? (
                  <Select
                    id={id}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                    style={style}
                  >
                    <option value="">{f.required ? "— Chọn —" : "— Tất cả —"}</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={id}
                    type={f.type === "date" ? "date" : f.type === "month" ? "month" : "text"}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void load();
                    }}
                    style={style}
                  />
                )}
              </div>
            );
          })}
          <Button
            variant="primary"
            size="sm"
            onClick={() => void load()}
            disabled={loading || missingRequired}
          >
            <I.Search size={13} /> Xem
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0">
        {err ? (
          <div className="p-3 text-xs text-danger whitespace-pre-wrap">Lỗi: {err}</div>
        ) : loading ? (
          <div className="p-3 text-xs text-muted flex items-center gap-2">
            <I.Loader size={14} className="animate-spin" /> Đang tải báo cáo…
          </div>
        ) : missingRequired && !loaded ? (
          <EmptyState
            icon={<I.Filter size={20} />}
            title="Chọn điều kiện lọc"
            hint="Điền các ô bắt buộc (*) rồi bấm Xem."
          />
        ) : rows.length === 0 && loaded ? (
          <EmptyState icon={<I.Archive size={20} />} title={emptyText} />
        ) : (
          <DataGrid
            columns={columns}
            data={rows}
            label={title}
            pageSize={pageSize}
            stateKey={`report:${procName}`}
            emptyText={emptyText}
          />
        )}
      </div>
    </div>
  );
}
