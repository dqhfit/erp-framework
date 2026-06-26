/* ==========================================================
   LookupPicker — Dropdown chọn bản ghi từ entity khác.
   Dùng cho field type "lookup" (single) và "multi-lookup"
   trong WizardModal, StepWidget, FormWidget, ô lưới ConsumerPage.

   - Tải sẵn batch đầu (PRELOAD) + tổng số. Entity NHỎ (≤ PRELOAD) →
     lọc client như cũ (zero regression).
   - Entity LỚN (vd tr_material 36k) → TÌM SERVER-SIDE: gõ để ILIKE
     trên field hiển thị + field mã (valueField), debounce. Nhãn ghép
     "mã — tên" cho dễ nhận. Giá trị đang chọn được nạp riêng để hiện nhãn.
   - Hiển thị field text đầu tiên (không phải lookup/id) làm tên.
   - Multi=true → checkbox list, value là mảng JSON string.
   ========================================================== */
import { createApiDataSource } from "@erp-framework/client";
import { useEffect, useRef, useState } from "react";
import { SearchableSelect } from "@/components/ui";
import { useUserObjects } from "@/stores/userObjects";

const api = createApiDataSource("");
/** Tải sẵn tối đa; total lớn hơn → bật tìm server-side. */
const PRELOAD = 300;

interface Props {
  refEntityId: string;
  value: string;
  onChange: (v: string) => void;
  multi?: boolean;
  className?: string;
  /** Mở dropdown ngay (sửa ô lưới). */
  autoOpen?: boolean;
  /** Gọi khi dropdown đóng (thoát chế độ sửa ô lưới). */
  onClose?: () => void;
  /** Lookup theo GIÁ TRỊ field này (vd "nguyenlieu"/"mavt") thay vì record.id —
   *  value lưu/khớp theo field đó (giữ tương thích data lưu tên/mã). */
  valueField?: string;
  readOnly?: boolean;
  reloadKey?: number;
}

export function LookupPicker({
  refEntityId,
  value,
  onChange,
  multi = false,
  className,
  autoOpen,
  onClose,
  valueField,
  readOnly = false,
  reloadKey,
}: Props) {
  const entities = useUserObjects((s) => s.entities);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [serverMode, setServerMode] = useState(false);
  const [err, setErr] = useState("");

  const refEnt = entities.find((e) => e.id === refEntityId);
  const displayField = refEnt?.fields.find(
    (f) => !["lookup", "multi-lookup", "formula", "collection"].includes(f.type) && f.name !== "id",
  );
  const dispName = displayField?.name;
  // Field mã (giá trị lưu) khác field hiển thị → nhãn ghép "mã — tên".
  const codeField = valueField && valueField !== dispName ? valueField : undefined;
  // Cột hiển thị trong dropdown (NHIỀU CỘT): mã (valueField) + tên (displayField)
  // + vài field text/số nữa của entity (bỏ field hệ thống + mô tả dài). ≥2 cột →
  // bật chế độ lưới nhiều cột.
  const cellFields = (() => {
    const usable = (refEnt?.fields ?? []).filter(
      (f) =>
        !["lookup", "multi-lookup", "formula", "collection"].includes(f.type) &&
        f.name !== "id" &&
        !/(^|_)(create_by|create_date|update_by|update_date|ngaytao|ngaysua|nguoitao|nguoisua|deleted)/.test(
          f.name,
        ) &&
        !/(mota|ghichu|note|description)/.test(f.name),
    );
    const out: typeof usable = [];
    const add = (name?: string, pool = usable) => {
      const f = name ? pool.find((x) => x.name === name) : undefined;
      if (f && !out.some((x) => x.name === f.name)) out.push(f);
    };
    // valueField (cột MÃ) luôn hiện — kể cả khi field đó type "lookup" (vd
    // tr_material.mavt) → tìm trong TOÀN BỘ field, không chỉ usable đã lọc.
    add(valueField, refEnt?.fields ?? []);
    add(dispName);
    for (const f of usable) {
      if (out.length >= 4) break;
      if (!out.some((x) => x.name === f.name)) out.push(f);
    }
    return out;
  })();
  const multiCol = cellFields.length >= 2;

  // Nhãn 1 dòng: ghép "mã — tên" nếu có field mã, ngược lại chỉ tên.
  const rowLabel = (row: Record<string, unknown>) => {
    if (valueField === "name") {
      return String(row.name ?? row.ten ?? "");
    }
    const name = dispName ? String(row[dispName] ?? "") : "";
    const base = name || String(row.id ?? "");
    if (codeField) {
      const code = String(row[codeField] ?? "");
      if (code) return name ? `${code} — ${name}` : code;
    }
    return base;
  };
  // Giá trị lưu xuống: theo field chỉ định (lookup-theo-tên/mã) hoặc record.id.
  const optValue = (row: Record<string, unknown>) =>
    valueField ? String(row[valueField] ?? "") : String(row.id ?? "");

  const seq = useRef(0);
  const debRef = useRef<number | null>(null);

  // Tải sẵn batch đầu + tổng. total > đã tải (single) → bật tìm server-side;
  // value hiện tại chưa nằm trong batch → nạp riêng record để hiện nhãn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại theo refEntityId/multi; value resolve 1 lần lúc mở
  useEffect(() => {
    if (!refEntityId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr("");
    setServerMode(false);
    api
      .getRecords(refEntityId, { limit: PRELOAD })
      .then(async (res) => {
        if (!alive) return;
        let loaded = res.rows.map((r) => r.data);
        const big = !multi && res.total > loaded.length;
        if (
          big &&
          value &&
          valueField &&
          !loaded.some((d) => String(d[valueField] ?? "") === value)
        ) {
          try {
            const cur = await api.getRecords(refEntityId, {
              filters: { [valueField]: { op: "=", value } },
              limit: 1,
            });
            if (cur.rows[0]) loaded = [cur.rows[0].data, ...loaded];
          } catch {
            /* không nạp được nhãn value → fallback hiện mã thô */
          }
        }
        if (!alive) return;
        setRows(loaded);
        setServerMode(big);
        setLoading(false);
      })
      .catch((e) => {
        if (alive) {
          setErr((e as Error).message);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [refEntityId, multi, reloadKey]);

  // Tìm server-side (entity lớn): ILIKE trên field hiển thị + field mã, gộp.
  const doSearch = (raw: string) => {
    seq.current += 1;
    const my = seq.current;
    const term = raw.trim();
    setSearching(true);
    const queries = term
      ? [
          dispName
            ? api.getRecords(refEntityId, {
                filters: { [dispName]: { op: "contains", value: term } },
                limit: 40,
              })
            : null,
          codeField
            ? api.getRecords(refEntityId, {
                filters: { [codeField]: { op: "contains", value: term } },
                limit: 40,
              })
            : null,
        ]
      : [api.getRecords(refEntityId, { limit: PRELOAD }), null];
    Promise.all(queries.map((p) => p ?? Promise.resolve({ rows: [], total: 0 })))
      .then((reslist) => {
        if (my !== seq.current) return;
        const map = new Map<string, Record<string, unknown>>();
        for (const res of reslist) for (const r of res.rows) map.set(r.id, r.data);
        setRows([...map.values()]);
        setSearching(false);
      })
      .catch(() => {
        if (my === seq.current) setSearching(false);
      });
  };
  const onSearch = (q: string) => {
    if (debRef.current) window.clearTimeout(debRef.current);
    debRef.current = window.setTimeout(() => doSearch(q), 250);
  };

  const cls = className ?? "input w-full";

  if (readOnly) {
    if (loading) {
      return (
        <div className="w-full min-h-[30px] flex items-center px-3 py-1 bg-panel-2/30 border border-border/40 rounded text-muted/40 text-sm animate-pulse">
          Đang tải dữ liệu…
        </div>
      );
    }
    if (err) {
      return (
        <div className="w-full min-h-[30px] flex items-center px-3 py-1 bg-panel-2/30 border border-border/40 rounded text-danger text-sm">
          Lỗi tải: {value || "—"}
        </div>
      );
    }
    if (multi) {
      let selected: string[] = [];
      try {
        const parsed = value ? JSON.parse(value) : [];
        selected = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        selected = value ? [value] : [];
      }
      const selectedRows = rows.filter((r) => selected.includes(optValue(r)));
      const labels = selectedRows.map(rowLabel);

      return (
        <div className="flex flex-wrap gap-1.5 p-1 border border-border/40 rounded bg-panel-2/30 min-h-[30px] items-center">
          {labels.map((lbl) => (
            <span key={lbl} className="chip chip-accent text-xs">
              {lbl}
            </span>
          ))}
        </div>
      );
    }

    const selectedRow = rows.find((r) => optValue(r) === value);
    const displayVal = selectedRow ? rowLabel(selectedRow) : value;
    return (
      <div className="w-full min-h-[30px] flex items-center px-3 py-1 bg-panel-2/30 border border-border/40 rounded text-fg select-text text-sm min-w-0">
        {displayVal || ""}
      </div>
    );
  }

  if (loading) {
    return (
      <select className={cls} disabled>
        <option>Đang tải {refEnt?.name ?? refEntityId}…</option>
      </select>
    );
  }
  if (err) {
    return (
      <input
        className={cls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Lỗi tải dữ liệu — nhập ID thủ công"
      />
    );
  }

  if (multi) {
    // Giá trị lưu dạng JSON array string: '["id1","id2"]'
    let selected: string[] = [];
    try {
      const parsed = value ? JSON.parse(value) : [];
      selected = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      selected = value ? [value] : [];
    }

    const toggle = (id: string) => {
      const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
      onChange(next.length ? JSON.stringify(next) : "");
    };

    return (
      <div className="border border-border rounded-md overflow-hidden max-h-40 overflow-y-auto bg-bg-soft">
        {rows.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted italic">Không có bản ghi</div>
        ) : (
          rows.map((row) => {
            const id = optValue(row);
            const checked = selected.includes(id);
            return (
              <label
                key={id}
                className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-hover/50 border-b border-border/50 last:border-0"
              >
                <input
                  type="checkbox"
                  className="accent-accent shrink-0"
                  checked={checked}
                  onChange={() => toggle(id)}
                />
                <span className="truncate">{rowLabel(row)}</span>
              </label>
            );
          })
        )}
      </div>
    );
  }

  // Single lookup
  const options = rows.map((row) => {
    const cells = multiCol ? cellFields.map((f) => String(row[f.name] ?? "")) : undefined;
    return cells
      ? { value: optValue(row), label: rowLabel(row), cells, searchText: cells.join(" ") }
      : { value: optValue(row), label: rowLabel(row) };
  });
  // Giá trị hiện tại không có trong danh sách hiện → giữ lại làm option để không
  // mất giá trị cũ. Entity lớn (đang tìm) chỉ hiện mã (có thể chưa nạp); entity
  // nhỏ đã nạp đủ mà vẫn thiếu → đánh dấu "(không tồn tại)".
  if (value && !options.some((o) => o.value === value)) {
    options.unshift({ value, label: serverMode ? String(value) : `${value} (không tồn tại)` });
  }
  return (
    <SearchableSelect
      className={className ? className : "w-full"}
      value={value}
      onChange={onChange}
      options={options}
      emptyOption={`chọn ${refEnt?.name ?? "bản ghi"}`}
      searchPlaceholder={
        serverMode ? `Gõ tìm ${refEnt?.name ?? "bản ghi"}…` : `Tìm ${refEnt?.name ?? "bản ghi"}…`
      }
      wrapOptions
      autoOpen={autoOpen}
      onClose={onClose}
      onSearch={serverMode ? onSearch : undefined}
      loading={searching}
      columnHeaders={multiCol ? cellFields.map((f) => f.label ?? f.name) : undefined}
    />
  );
}
