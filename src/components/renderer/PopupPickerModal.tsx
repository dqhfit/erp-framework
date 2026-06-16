/* ==========================================================
   PopupPickerModal — Modal chọn / nhập dữ liệu được kích hoạt
   bởi ActionStep "open-popup".

   3 chế độ:
   - list   : Hiển thị bảng record, click hàng → trả về object
   - detail : Hiển thị chi tiết 1 record (theo recordId), "Chọn" → trả về
   - form   : Form trống, người dùng nhập, "Xác nhận" → trả về object
   ========================================================== */
import { createApiDataSource } from "@erp-framework/client";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Input, Modal, SearchableSelect } from "@/components/ui";
import { toast } from "@/lib/toast";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionStepOpenPopup } from "@/types/page";

const api = createApiDataSource("");

interface Props {
  step: ActionStepOpenPopup;
  recordId?: unknown;
  onSelect: (value: Record<string, unknown>) => void;
  onCancel: () => void;
}

export function PopupPickerModal({ step, recordId, onSelect, onCancel }: Props) {
  const entities = useUserObjects((s) => s.entities);
  const entity = entities.find((e) => e.id === step.entity);

  const selectableFields = (entity?.fields ?? []).filter(
    (f) => f.type !== "formula" && f.type !== "collection",
  );
  // step.fields (nếu có) → đúng tập + thứ tự đó (ẩn field tự sinh như id);
  // không có → mặc định 7 field đầu (hành vi cũ).
  const visibleFields =
    step.fields && step.fields.length > 0
      ? (step.fields
          .map((n) => selectableFields.find((f) => f.name === n))
          .filter(Boolean) as typeof selectableFields)
      : selectableFields.slice(0, 7);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [detailRow, setDetailRow] = useState<Record<string, unknown> | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  /* Fetch records: list (chọn) hoặc record đơn (detail + form-sửa theo recordId). */
  useEffect(() => {
    if (!step.entity) return;

    if (step.popupMode === "list") {
      setLoading(true);
      api
        .getRecords(step.entity, { limit: 300 })
        .then((res) => setRows(res.rows.map((r) => r.data)))
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
      return;
    }
    // detail HOẶC form-sửa (có recordId) → tải record để xem/điền sẵn.
    if ((step.popupMode === "detail" || step.popupMode === "form") && recordId != null) {
      setLoading(true);
      api
        .getRecord(String(recordId))
        .then((rec) => setDetailRow(rec ? (rec.data as Record<string, unknown>) : null))
        .catch(() => setDetailRow(null))
        .finally(() => setLoading(false));
    }
  }, [step.entity, step.popupMode, recordId]);

  /* Khởi tạo form: rỗng (tạo mới) hoặc điền sẵn từ detailRow (sửa). */
  // biome-ignore lint/correctness/useExhaustiveDependencies: bám detailRow để điền sẵn khi sửa; KHÔNG bám visibleFields để khỏi xoá input đang nhập
  useEffect(() => {
    if (step.popupMode !== "form") return;
    const init: Record<string, string> = {};
    for (const f of visibleFields) {
      const v = detailRow ? detailRow[f.name] : undefined;
      if (v == null) {
        init[f.name] = "";
      } else if (f.type === "boolean" || f.type === "bool") {
        init[f.name] = v === true || v === "true" ? "true" : "false";
      } else {
        init[f.name] = String(v);
      }
    }
    setFormValues(init);
  }, [step.entity, step.popupMode, detailRow]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Gom giá trị form → payload (boolean về bool). */
  const buildPayload = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of visibleFields) {
      const v = formValues[f.name];
      if (v === undefined) continue;
      if (f.type === "boolean" || f.type === "bool") {
        out[f.name] = v === "true";
      } else {
        out[f.name] = v;
      }
    }
    return out;
  };

  /* Xác nhận form: persist=true → tạo/sửa thật; ngược lại trả giá trị về state. */
  const onConfirmForm = async () => {
    if (saving) return;
    const payload = buildPayload();
    if (!step.persist) {
      onSelect(payload);
      return;
    }
    setSaving(true);
    try {
      const saved =
        recordId != null
          ? await api.updateRecord(String(recordId), payload)
          : await api.createRecord(step.entity, payload);
      toast.success(recordId != null ? "Đã cập nhật" : "Đã thêm mới");
      onSelect((saved.data as Record<string, unknown>) ?? payload);
    } catch (e) {
      toast.error((e as Error).message || "Lỗi lưu dữ liệu");
    } finally {
      setSaving(false);
    }
  };

  const defaultTitle =
    step.popupMode === "list"
      ? `Chọn ${entity?.name ?? "bản ghi"}`
      : step.popupMode === "detail"
        ? `Chi tiết ${entity?.name ?? ""}`
        : `Nhập ${entity?.name ?? ""}`;
  const title = step.title || defaultTitle;

  const filteredRows = search
    ? rows.filter((r) =>
        visibleFields.some((f) =>
          String(r[f.name] ?? "")
            .toLowerCase()
            .includes(search.toLowerCase()),
        ),
      )
    : rows;

  // Form rộng hơn để chứa 2 cột trên màn lớn; list 760; detail 520.
  // Modal cap theo viewport (w-full + maxWidth) nên màn nhỏ tự co lại.
  const modalWidth = step.popupMode === "list" ? 760 : step.popupMode === "form" ? 720 : 520;

  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      width={modalWidth}
      footer={
        step.popupMode === "form" ? (
          <>
            <Button variant="ghost" onClick={onCancel} disabled={saving}>
              Huỷ
            </Button>
            <Button variant="primary" onClick={onConfirmForm} disabled={saving || loading}>
              {saving ? "Đang lưu..." : step.persist ? "Lưu" : "Xác nhận"}
            </Button>
          </>
        ) : step.popupMode === "detail" ? (
          <>
            <Button variant="ghost" onClick={onCancel}>
              Huỷ
            </Button>
            <Button
              variant="primary"
              disabled={!detailRow}
              onClick={() => detailRow && onSelect(detailRow)}
            >
              Chọn
            </Button>
          </>
        ) : null
      }
    >
      {/* ── LIST ─────────────────────────────────────────────── */}
      {step.popupMode === "list" && (
        <div className="space-y-3">
          <div className="relative">
            <I.Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm kiếm..."
              className="pl-7!"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted text-sm gap-2">
              <I.Loader size={16} className="animate-spin" />
              Đang tải...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-12 text-muted text-sm">Không có dữ liệu</div>
          ) : (
            <div className="border border-border rounded-md overflow-hidden">
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-panel-2 border-b border-border">
                    <tr>
                      {visibleFields.map((f) => (
                        <th
                          key={f.id}
                          className="px-3 py-2 text-left text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap"
                        >
                          {f.label}
                        </th>
                      ))}
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, i) => (
                      <tr
                        // biome-ignore lint/suspicious/noArrayIndexKey: row la Record dong, khong dam bao co id on dinh; chi so hang la danh tinh hien thi
                        key={i}
                        className="border-t border-border hover:bg-hover cursor-pointer group/row"
                        onClick={() => onSelect(row)}
                      >
                        {visibleFields.map((f) => (
                          <td key={f.id} className="px-3 py-2 max-w-[180px] truncate">
                            {String(row[f.name] ?? "")}
                          </td>
                        ))}
                        <td className="pr-2 text-right">
                          <span className="text-[10px] text-accent opacity-0 group-hover/row:opacity-100">
                            Chọn →
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-1.5 text-[11px] text-muted border-t border-border bg-panel-2">
                {filteredRows.length} bản ghi
                {search && rows.length !== filteredRows.length && ` (${rows.length} tổng)`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── DETAIL ───────────────────────────────────────────── */}
      {step.popupMode === "detail" && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted text-sm gap-2">
              <I.Loader size={16} className="animate-spin" />
              Đang tải...
            </div>
          ) : !detailRow ? (
            <div className="text-center py-12 text-muted text-sm">Không tìm thấy bản ghi</div>
          ) : (
            <div className="divide-y divide-border">
              {visibleFields.map((f) => (
                <div key={f.id} className="grid grid-cols-[160px_1fr] gap-3 py-2.5 text-sm">
                  <span className="text-muted text-xs pt-0.5">{f.label}</span>
                  <span className="font-medium break-words">
                    {String(detailRow[f.name] ?? "—")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── FORM ─────────────────────────────────────────────── */}
      {step.popupMode === "form" && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted text-sm gap-2">
              <I.Loader size={16} className="animate-spin" />
              Đang tải...
            </div>
          ) : visibleFields.length === 0 ? (
            <div className="text-center py-8 text-muted text-sm">Entity chưa có field nào</div>
          ) : (
            // Màn lớn (≥lg) LUÔN 2 cột; màn nhỏ tự về 1 cột.
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4 gap-y-3">
              {visibleFields.map((f) => (
                <div key={f.id} className="space-y-1">
                  <label className="text-xs font-medium">
                    {f.label}
                    {f.required && <span className="text-danger ml-0.5">*</span>}
                  </label>
                  {f.type === "boolean" || f.type === "bool" ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={formValues[f.name] === "true"}
                        onChange={(e) =>
                          setFormValues((v) => ({
                            ...v,
                            [f.name]: e.target.checked ? "true" : "false",
                          }))
                        }
                      />
                      {f.label}
                    </label>
                  ) : f.options && f.options.length > 0 ? (
                    <SearchableSelect
                      className="w-full"
                      value={formValues[f.name] ?? ""}
                      onChange={(val) => setFormValues((v) => ({ ...v, [f.name]: val }))}
                      options={f.options.map((opt) => ({ value: opt, label: opt }))}
                      emptyOption="— chọn —"
                    />
                  ) : f.type === "text" || f.type === "longtext" ? (
                    <textarea
                      className="input w-full resize-none"
                      rows={f.type === "longtext" ? 3 : 1}
                      value={formValues[f.name] ?? ""}
                      onChange={(e) => setFormValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      placeholder={f.label}
                    />
                  ) : (
                    <Input
                      type={
                        f.type === "number" || f.type === "integer"
                          ? "number"
                          : f.type === "date"
                            ? "date"
                            : "text"
                      }
                      value={formValues[f.name] ?? ""}
                      onChange={(e) => setFormValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      placeholder={f.label}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
