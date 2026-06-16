/* ==========================================================
   LookupPicker — Dropdown chọn bản ghi từ entity khác.
   Dùng cho field type "lookup" (single) và "multi-lookup"
   trong WizardModal, StepWidget, FormWidget.

   Tải records của refEntityId (giới hạn 300), hiển thị field
   text đầu tiên làm label. Multi=true → <select multiple>,
   value là mảng ID dạng JSON string.
   ========================================================== */
import { createApiDataSource } from "@erp-framework/client";
import { useEffect, useState } from "react";
import { SearchableSelect } from "@/components/ui";
import { useUserObjects } from "@/stores/userObjects";

const api = createApiDataSource("");

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
  /** Lookup theo GIÁ TRỊ field này (vd "nguyenlieu") thay vì record.id —
   *  value lưu/khớp theo field đó (giữ tương thích data lưu tên/mã). */
  valueField?: string;
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
}: Props) {
  const entities = useUserObjects((s) => s.entities);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const refEnt = entities.find((e) => e.id === refEntityId);
  const displayField = refEnt?.fields.find(
    (f) => !["lookup", "multi-lookup", "formula", "collection"].includes(f.type) && f.name !== "id",
  );

  useEffect(() => {
    if (!refEntityId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr("");
    api
      .getRecords(refEntityId, { limit: 300 })
      .then((res) => {
        if (alive) {
          setRows(res.rows.map((r) => r.data));
          setLoading(false);
        }
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
  }, [refEntityId]);

  const cls = className ?? "input w-full";

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

  const rowLabel = (row: Record<string, unknown>) => {
    const id = String(row.id ?? "");
    return displayField ? String(row[displayField.name] ?? id) : id;
  };
  // Giá trị lưu xuống: theo field chỉ định (lookup-theo-tên) hoặc record.id.
  const optValue = (row: Record<string, unknown>) =>
    valueField ? String(row[valueField] ?? "") : String(row.id ?? "");

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
  const options = rows.map((row) => ({ value: optValue(row), label: rowLabel(row) }));
  // Giá trị hiện tại trỏ tới record KHÔNG còn tồn tại → giữ lại làm option (đánh
  // dấu) thay vì mất giá trị cũ; user vẫn chọn lại được từ danh sách đầy đủ.
  if (value && !options.some((o) => o.value === value)) {
    options.unshift({ value, label: `${value} (không tồn tại)` });
  }
  return (
    <SearchableSelect
      className={className ? className : "w-full"}
      value={value}
      onChange={onChange}
      options={options}
      emptyOption={`— chọn ${refEnt?.name ?? "bản ghi"} —`}
      searchPlaceholder={`Tìm ${refEnt?.name ?? "bản ghi"}…`}
      wrapOptions
      autoOpen={autoOpen}
      onClose={onClose}
    />
  );
}
