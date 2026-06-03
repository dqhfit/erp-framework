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

  const visibleFields = (entity?.fields ?? [])
    .filter((f) => f.type !== "formula" && f.type !== "collection")
    .slice(0, 7);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [detailRow, setDetailRow] = useState<Record<string, unknown> | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  /* Fetch records (list) hoặc record đơn (detail) */
  useEffect(() => {
    if (!step.entity) return;
    if (step.popupMode === "form") return;

    setLoading(true);
    if (step.popupMode === "list") {
      api
        .getRecords(step.entity, { limit: 300 })
        .then((res) => setRows(res.rows.map((r) => r.data)))
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    } else if (step.popupMode === "detail" && recordId != null) {
      api
        .getRecord(String(recordId))
        .then((rec) => setDetailRow(rec ? (rec.data as Record<string, unknown>) : null))
        .catch(() => setDetailRow(null))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [step.entity, step.popupMode, recordId]);

  /* Khởi tạo form trống */
  // biome-ignore lint/correctness/useExhaustiveDependencies: chu y chi reset form khi doi popupMode/entity, khong reset khi visibleFields thay doi de tranh xoa input dang nhap
  useEffect(() => {
    if (step.popupMode !== "form") return;
    const init: Record<string, string> = {};
    for (const f of visibleFields) init[f.name] = "";
    setFormValues(init);
  }, [step.entity, step.popupMode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const modalWidth = step.popupMode === "list" ? 760 : 520;

  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      width={modalWidth}
      footer={
        step.popupMode === "form" ? (
          <>
            <Button variant="ghost" onClick={onCancel}>
              Huỷ
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                onSelect(Object.fromEntries(Object.entries(formValues).map(([k, v]) => [k, v])))
              }
            >
              Xác nhận
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
        <div className="space-y-3">
          {visibleFields.length === 0 ? (
            <div className="text-center py-8 text-muted text-sm">Entity chưa có field nào</div>
          ) : (
            visibleFields.map((f) => (
              <div key={f.id} className="space-y-1">
                <label className="text-xs font-medium">
                  {f.label}
                  {f.required && <span className="text-danger ml-0.5">*</span>}
                </label>
                {f.type === "boolean" ? (
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
            ))
          )}
        </div>
      )}
    </Modal>
  );
}
