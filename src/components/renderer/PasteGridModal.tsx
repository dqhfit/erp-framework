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

export interface PasteColumn {
  name: string;
  label: string;
}
export interface PasteUpdate {
  rowId: string;
  changes: Record<string, string>;
}
interface Props {
  open: boolean;
  onClose: () => void;
  /** Cột (field) của grid hiện tại để ánh xạ. */
  columns: PasteColumn[];
  /** Dòng hiện tại của grid (phải có `id`) để khớp theo cột khóa. */
  rows: Record<string, unknown>[];
  onApply: (updates: PasteUpdate[]) => Promise<void> | void;
}

/** Bỏ dấu + thường hoá để so khớp tiêu đề cột. */
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").trim();

export function PasteGridModal({ open, onClose, columns, rows, onApply }: Props) {
  const [text, setText] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  // Override ánh xạ của user theo CHỈ SỐ cột dán → field name ("" = bỏ qua).
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [keyField, setKeyField] = useState("");
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState("");

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

  // Tính updates: khớp dòng dán với grid theo cột khóa.
  const { updates, matched, unmatched } = useMemo(() => {
    if (!effKeyField || dataRows.length === 0)
      return { updates: [] as PasteUpdate[], matched: 0, unmatched: 0 };
    const byKey = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const k = String(r[effKeyField] ?? "").trim();
      if (k && !byKey.has(k)) byKey.set(k, r);
    }
    const ups: PasteUpdate[] = [];
    let miss = 0;
    for (const dr of dataRows) {
      const rec: Record<string, string> = {};
      for (let i = 0; i < colCount; i++) {
        const f = effMap[i];
        if (f) rec[f] = (dr[i] ?? "").trim();
      }
      const keyVal = String(rec[effKeyField] ?? "").trim();
      const match = keyVal ? byKey.get(keyVal) : undefined;
      if (!match) {
        miss++;
        continue;
      }
      const changes: Record<string, string> = {};
      for (const [f, v] of Object.entries(rec)) if (f !== effKeyField) changes[f] = v;
      if (Object.keys(changes).length) ups.push({ rowId: String(match.id), changes });
    }
    return { updates: ups, matched: ups.length, unmatched: miss };
  }, [dataRows, effMap, effKeyField, rows, colCount]);

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
    if (!updates.length) return;
    setApplying(true);
    setErr("");
    try {
      await onApply(updates);
      close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Dán dữ liệu cập nhật" width={760}>
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">
            Copy vùng dữ liệu từ Excel/Sheets (gồm cả tiêu đề) rồi dán vào ô dưới. Khớp dòng theo{" "}
            <b>cột khóa</b> → cập nhật các cột còn lại.
          </p>
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

            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1 text-success">
                <I.Check size={13} /> Khớp: <b>{matched}</b> dòng
              </span>
              {unmatched > 0 && (
                <span className="inline-flex items-center gap-1 text-warning">
                  <I.AlertCircle size={13} /> Không khớp: <b>{unmatched}</b> (bỏ qua)
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
          disabled={applying || updates.length === 0 || !effKeyField}
          icon={<I.Check size={14} />}
        >
          {applying ? "Đang cập nhật…" : `Cập nhật ${updates.length} dòng`}
        </Button>
      </div>
    </Modal>
  );
}
