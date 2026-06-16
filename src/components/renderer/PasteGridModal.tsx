/* ==========================================================
   PasteGridModal — DÁN dữ liệu dạng bảng (TSV copy từ Excel/Sheets) vào
   DataGrid: ánh xạ từng cột dán → cột (field) của grid, khớp dòng theo CỘT
   KHÓA, rồi cập nhật lại data (gọi onApply với danh sách {rowId, changes}).

   - Tự ánh xạ cột theo header (nếu dòng đầu là tiêu đề) hoặc theo vị trí;
     user chỉnh lại được từng cột.
   - Khớp dòng: giá trị cột-khóa của dòng dán === giá trị cùng field ở grid.
     Không khớp → bỏ qua (không tạo mới). Cột khóa KHÔNG nằm trong changes.
   ========================================================== */
import { useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Modal, Select, Switch } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface PasteColumn {
  name: string;
  label: string;
}
export interface PasteUpdate {
  rowId: string;
  changes: Record<string, string>;
}
type Mode = "update" | "create" | "upsert";
interface Props {
  open: boolean;
  onClose: () => void;
  /** Cột (field) của grid hiện tại để ánh xạ. */
  columns: PasteColumn[];
  /** Dòng hiện tại của grid (phải có `id`) để khớp theo cột khóa. */
  rows: Record<string, unknown>[];
  /** Cập nhật dòng khớp cột khóa (chế độ "update"/"upsert"). */
  onApply: (updates: PasteUpdate[]) => Promise<void> | void;
  /** Tạo dòng mới (chế độ "create"/"upsert"). Có → bật chế độ thêm mới. */
  onCreate?: (records: Array<Record<string, string>>) => Promise<void> | void;
  /** Field cố định gắn vào mọi dòng TẠO MỚI (vd masp = sản phẩm đang chọn).
   *  Giá trị dán (nếu có map) ghi đè default này. */
  createDefaults?: Record<string, string>;
}

/** Bỏ dấu + thường hoá để so khớp tiêu đề cột. */
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();

export function PasteGridModal({
  open,
  onClose,
  columns,
  rows,
  onApply,
  onCreate,
  createDefaults,
}: Props) {
  const [text, setText] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  // Override ánh xạ của user theo CHỈ SỐ cột dán → field name ("" = bỏ qua).
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [keyField, setKeyField] = useState("");
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState("");
  // Chế độ: chỉ cập nhật / chỉ thêm mới / cập nhật + thêm. "create" cần onCreate.
  const [mode, setMode] = useState<Mode>(onCreate ? "upsert" : "update");

  // Parse TSV → mảng 2 chiều (tách dòng \n, ô \t).
  const grid = useMemo(() => {
    const norml = text.replace(/\r\n?/g, "\n");
    return norml
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => l.split("\t"));
  }, [text]);
  const colCount = useMemo(() => grid.reduce((m, r) => Math.max(m, r.length), 0), [grid]);
  const headerRow = hasHeader ? grid[0] : undefined;
  const dataRows = useMemo(() => (hasHeader ? grid.slice(1) : grid), [grid, hasHeader]);

  // Ánh xạ TỰ ĐỘNG: header khớp label/name, else theo vị trí cột.
  const autoMap = useMemo(() => {
    const m: Record<number, string> = {};
    for (let i = 0; i < colCount; i++) {
      if (hasHeader && headerRow) {
        const h = norm(headerRow[i] ?? "");
        const col = h ? columns.find((c) => norm(c.label) === h || norm(c.name) === h) : undefined;
        if (col) m[i] = col.name;
      } else {
        const col = columns[i];
        if (col) m[i] = col.name;
      }
    }
    return m;
  }, [colCount, hasHeader, headerRow, columns]);

  // Ánh xạ hiệu lực = override của user (nếu có) > tự động.
  const effMap = useMemo(() => {
    const m: Record<number, string> = {};
    for (let i = 0; i < colCount; i++)
      m[i] = i in mapping ? (mapping[i] ?? "") : (autoMap[i] ?? "");
    return m;
  }, [colCount, mapping, autoMap]);

  const mappedFields = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (let i = 0; i < colCount; i++) {
      const f = effMap[i];
      if (f && !seen.has(f)) {
        seen.add(f);
        out.push(f);
      }
    }
    return out;
  }, [effMap, colCount]);
  const effKeyField =
    keyField && mappedFields.includes(keyField) ? keyField : (mappedFields[0] ?? "");

  const labelOf = (name: string) => columns.find((c) => c.name === name)?.label ?? name;

  // Dựng record từ mỗi dòng dán theo ánh xạ.
  const recs = useMemo<Record<string, string>[]>(
    () =>
      dataRows.map((dr) => {
        const rec: Record<string, string> = {};
        for (let i = 0; i < colCount; i++) {
          const f = effMap[i];
          if (f) rec[f] = (dr[i] ?? "").trim();
        }
        return rec;
      }),
    [dataRows, effMap, colCount],
  );

  // Phân loại theo chế độ: update (khớp khóa → sửa) / create (mọi dòng → tạo) /
  // upsert (khớp → sửa, lệch → tạo). Tạo mới = default cố định + giá trị dán.
  const { updates, creates, matched, created, skipped } = useMemo(() => {
    if (mode === "create") {
      const cr = recs.map((r) => ({ ...createDefaults, ...r }));
      return {
        updates: [] as PasteUpdate[],
        creates: cr,
        matched: 0,
        created: cr.length,
        skipped: 0,
      };
    }
    if (!effKeyField)
      return {
        updates: [] as PasteUpdate[],
        creates: [] as Array<Record<string, string>>,
        matched: 0,
        created: 0,
        skipped: recs.length,
      };
    const byKey = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const k = String(r[effKeyField] ?? "").trim();
      if (k && !byKey.has(k)) byKey.set(k, r);
    }
    const ups: PasteUpdate[] = [];
    const cr: Array<Record<string, string>> = [];
    let miss = 0;
    for (const rec of recs) {
      const keyVal = String(rec[effKeyField] ?? "").trim();
      const match = keyVal ? byKey.get(keyVal) : undefined;
      if (match) {
        const changes: Record<string, string> = {};
        for (const [f, v] of Object.entries(rec)) if (f !== effKeyField) changes[f] = v;
        if (Object.keys(changes).length) ups.push({ rowId: String(match.id), changes });
      } else if (mode === "upsert") {
        cr.push({ ...createDefaults, ...rec });
      } else {
        miss++;
      }
    }
    return { updates: ups, creates: cr, matched: ups.length, created: cr.length, skipped: miss };
  }, [mode, recs, effKeyField, rows, createDefaults]);
  const totalOps = updates.length + creates.length;

  const reset = () => {
    setText("");
    setMapping({});
    setKeyField("");
    setErr("");
  };
  const close = () => {
    reset();
    onClose();
  };
  const apply = async () => {
    if (totalOps === 0) return;
    setApplying(true);
    setErr("");
    try {
      if (updates.length && onApply) await onApply(updates);
      if (creates.length && onCreate) await onCreate(creates);
      close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  // Chế độ khả dụng: create/upsert cần onCreate.
  const MODES: Array<{ v: Mode; label: string }> = onCreate
    ? [
        { v: "update", label: "Chỉ cập nhật" },
        { v: "create", label: "Chỉ thêm mới" },
        { v: "upsert", label: "Cập nhật + thêm" },
      ]
    : [{ v: "update", label: "Chỉ cập nhật" }];
  const needKey = mode !== "create";

  return (
    <Modal open={open} onClose={close} title="Dán dữ liệu hàng loạt" width={760}>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-muted">
          Copy vùng dữ liệu từ Excel/Sheets (gồm cả tiêu đề) rồi dán vào ô dưới, ánh xạ cột, chọn
          chế độ rồi áp.
        </p>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          {onCreate && (
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {MODES.map((m) => (
                <button
                  key={m.v}
                  type="button"
                  onClick={() => setMode(m.v)}
                  className={cn(
                    "px-2.5 h-7 text-xs border-r border-border last:border-r-0 transition-colors",
                    mode === m.v
                      ? "bg-accent text-white"
                      : "text-muted hover:text-text hover:bg-hover/40",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
          <Switch checked={hasHeader} onChange={setHasHeader} label="Dòng đầu là tiêu đề" />
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Dán dữ liệu (TSV) vào đây…\nstt\tdày\trộng\n1\t18\t600\n2\t18\t450"}
          className="input w-full font-mono text-xs h-28 leading-relaxed"
          spellCheck={false}
        />

        {colCount > 0 && (
          <>
            {needKey && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted">Cột khóa (để khớp dòng):</span>
                <Select
                  value={effKeyField}
                  onChange={(e) => setKeyField(e.target.value)}
                  className="h-7! text-xs! w-48"
                >
                  {mappedFields.length === 0 ? (
                    <option value="">— chưa ánh xạ cột nào —</option>
                  ) : (
                    mappedFields.map((f) => (
                      <option key={f} value={f}>
                        {labelOf(f)}
                      </option>
                    ))
                  )}
                </Select>
              </div>
            )}
            {mode !== "update" && createDefaults && Object.keys(createDefaults).length > 0 && (
              <p className="text-xs text-muted">
                Dòng thêm mới tự gắn:{" "}
                {Object.entries(createDefaults).map(([k, v]) => (
                  <span key={k} className="text-text/80">
                    {labelOf(k)}=<b>{v}</b>{" "}
                  </span>
                ))}
              </p>
            )}

            {/* Ánh xạ từng cột dán → field grid */}
            <div className="border border-border rounded-md overflow-hidden">
              <div className="max-h-44 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-panel-2 sticky top-0">
                    <tr className="text-left text-muted">
                      <th className="px-2 py-1.5 font-medium">Cột dán</th>
                      <th className="px-2 py-1.5 font-medium">Mẫu</th>
                      <th className="px-2 py-1.5 font-medium">→ Cập nhật field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: colCount }, (_, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: cột dán theo VỊ TRÍ cố định, index là id ổn định
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-2 py-1 whitespace-nowrap text-muted">
                          {hasHeader && headerRow?.[i] ? headerRow[i] : `Cột ${i + 1}`}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap text-text/70 max-w-[160px] truncate">
                          {dataRows[0]?.[i] ?? ""}
                        </td>
                        <td className="px-2 py-1">
                          <Select
                            value={effMap[i] ?? ""}
                            onChange={(e) => setMapping((m) => ({ ...m, [i]: e.target.value }))}
                            className="h-6! text-xs! w-full"
                          >
                            <option value="">— bỏ qua —</option>
                            {columns.map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.label}
                              </option>
                            ))}
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs flex-wrap">
              {mode !== "create" && (
                <span className="inline-flex items-center gap-1 text-success">
                  <I.Check size={13} /> Cập nhật: <b>{matched}</b>
                </span>
              )}
              {mode !== "update" && (
                <span className="inline-flex items-center gap-1 text-accent">
                  <I.Plus size={13} /> Thêm mới: <b>{created}</b>
                </span>
              )}
              {skipped > 0 && (
                <span className="inline-flex items-center gap-1 text-warning">
                  <I.AlertCircle size={13} /> Bỏ qua: <b>{skipped}</b>
                </span>
              )}
            </div>
          </>
        )}

        {err && <div className="text-xs text-danger">{err}</div>}
      </div>

      <div className="flex justify-end gap-2 pt-3">
        <Button variant="ghost" onClick={close} disabled={applying}>
          Huỷ
        </Button>
        <Button
          variant="primary"
          onClick={apply}
          disabled={applying || totalOps === 0 || (needKey && !effKeyField)}
          icon={<I.Check size={14} />}
        >
          {applying
            ? "Đang xử lý…"
            : `Áp dụng${updates.length ? ` · cập nhật ${updates.length}` : ""}${
                creates.length ? ` · thêm ${creates.length}` : ""
              }`}
        </Button>
      </div>
    </Modal>
  );
}
