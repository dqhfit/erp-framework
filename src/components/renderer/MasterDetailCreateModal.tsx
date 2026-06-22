/* ==========================================================
   MasterDetailCreateModal — dialog TẠO MỚI record master-detail
   với 2 tab:
   - Tab "Thông tin đơn hàng": form field của entity cha (vd tr_order).
   - Tab "Chi tiết đơn hàng": bảng nhập nhiều dòng entity con
     (vd tr_order_detail), mỗi dòng tự gán linkField = giá trị
     parentKeyField của cha.
   Lưu: createRecord(cha) → createRecord(từng dòng con). Server tự
   coerce kiểu cột (coerceColumnValue) nên gửi string là đủ.
   ========================================================== */
import { createApiDataSource } from "@erp-framework/client";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Input, Modal, SearchableSelect, Tabs } from "@/components/ui";
import type { EntityField } from "@/lib/object-types";
import { toast } from "@/lib/toast";
import { useUserObjects } from "@/stores/userObjects";
import { MultiLookupPicker } from "./MultiLookupPicker";

const api = createApiDataSource("");

/** Liên kết 1 field con tới entity nguồn — picker chọn record, LƯU giá trị
 *  `valueField` (vd masp) chứ không phải uuid (giữ nhất quán dữ liệu code). */
export type FieldLookup = {
  /** Entity nguồn (vd tr_sanpham). */
  entity: string;
  /** Field nguồn dùng làm giá trị lưu vào record con (vd masp). */
  valueField: string;
  /** Field nguồn hiển thị trong dropdown (mặc định = valueField). */
  labelFields?: string[];
  multiple?: boolean;
  separator?: string;
  columnHeaders?: string[];
  /** Tìm SERVER-SIDE (bảng lớn, vd tr_material 36k): dùng LookupPicker
   *  (preload + ILIKE server khi gõ) thay vì nạp sẵn toàn bộ. Chỉ single. */
  serverSearch?: boolean;
};

export type CreateFormCfg = {
  title?: string;
  viewTitle?: string;
  editTitle?: string;
  subjectLabel?: string;
  layout?: "tabs" | "single";
  width?: number;
  masterLabel?: string;
  detailLabel?: string;
  /** Entity cha + cột nhập. fieldLookups: map fieldName → picker entity
   *  (vd customer → tr_khachhang) để field cha hiện combobox chọn. */
  master: {
    entity: string;
    fields?: string[];
    fieldLookups?: Record<string, FieldLookup>;
    fieldLabels?: Record<string, string>;
    requiredFields?: string[];
    fullWidthFields?: string[];
  };
  /** Entity con + cách nối với cha. */
  detail: {
    entity: string;
    /** Field trên record con để gán khoá cha (vd order_number). */
    linkField: string;
    /** Field trên record cha cung cấp giá trị khoá (vd order_number). */
    parentKeyField: string;
    fields?: string[];
    /** Map fieldName → liên kết entity (picker). Vd item_number → tr_sanpham. */
    fieldLookups?: Record<string, FieldLookup>;
    /** Field tự tính = TÍCH các field nguồn (vd amount = order_qty × price).
     *  Ô hiển thị read-only (tính live), giá trị ghi khi lưu. */
    computed?: Record<string, string[]>;
    /** Field hiển thị TỔNG ở footer bảng (vd order_qty, amount). */
    footerSums?: string[];
    fieldLabels?: Record<string, string>;
    requiredFields?: string[];
    autoSequenceField?: string;
    /** Dòng ĐÃ CÓ (đang sửa) chỉ cho sửa các field này; field khác → read-only.
     *  Dòng MỚI thêm vẫn nhập được mọi field. (vd ["soluong","dongia"]). */
    editableOnExisting?: string[];
  };
};

/** Tích các field số trong 1 dòng (NaN/rỗng coi như 0). Dùng cho computed. */
export function computeProduct(row: Record<string, string>, factors: string[]): number {
  const n = factors.reduce((acc, fn) => acc * (Number(row[fn]) || 0), 1);
  return Number.isFinite(n) ? n : 0;
}

/** Tổng 1 field qua mọi dòng. Field computed → cộng tích; field thường → cộng số. */
export function sumField(
  rows: Record<string, string>[],
  field: string,
  computed?: Record<string, string[]>,
): number {
  const factors = computed?.[field];
  return rows.reduce(
    (acc, r) => acc + (factors ? computeProduct(r, factors) : Number(r[field]) || 0),
    0,
  );
}

interface Props {
  config: CreateFormCfg;
  onClose: () => void;
  onCreated: () => void;
}

type DetailInputRow = Record<string, string> & { _key: string };

/** Lọc field nhập được (bỏ formula/collection); theo danh sách cấu hình nếu có. */
function pickFields(all: EntityField[], names?: string[]): EntityField[] {
  const usable = all.filter((f) => f.type !== "formula" && f.type !== "collection");
  if (names && names.length > 0) {
    return names.map((n) => usable.find((f) => f.name === n)).filter(Boolean) as EntityField[];
  }
  return usable.slice(0, 12);
}

function inputTypeFor(t: string): string {
  if (t === "number" || t === "integer" || t === "currency") return "number";
  if (t === "date" || t === "datetime") return "date";
  return "text";
}

/** "YYYY-MM-DD" (từ input date) → ISO UTC để đồng nhất với data đã có
 *  ("2026-06-15T00:00:00.000Z"). UTC nên không lệch ±1 ngày theo tz. */
function toIsoDate(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

/** Gom giá trị đã nhập → payload createRecord (bỏ rỗng, boolean về bool, date → ISO). */
function buildData(vals: Record<string, string>, fields: EntityField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = vals[f.name];
    if (v === undefined) continue;
    if (f.type === "boolean" || f.type === "bool") {
      if (v === "true") out[f.name] = true;
      continue;
    }
    if (v.trim() === "") continue;
    if (f.type === "date" || f.type === "datetime") {
      out[f.name] = toIsoDate(v.trim());
      continue;
    }
    out[f.name] = v;
  }
  return out;
}

export function MasterDetailCreateModal({ config, onClose, onCreated }: Props) {
  const entities = useUserObjects((s) => s.entities);
  const masterEnt = entities.find((e) => e.id === config.master.entity);
  const detailEnt = entities.find((e) => e.id === config.detail.entity);

  const masterFields = useMemo(
    () => pickFields(masterEnt?.fields ?? [], config.master.fields),
    [masterEnt, config.master.fields],
  );
  const detailFields = useMemo(
    () => pickFields(detailEnt?.fields ?? [], config.detail.fields),
    [detailEnt, config.detail.fields],
  );

  const [tab, setTab] = useState<"master" | "detail">("master");
  const [master, setMaster] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<DetailInputRow[]>([
    {
      _key: crypto.randomUUID(),
      ...(config.detail.autoSequenceField ? { [config.detail.autoSequenceField]: "1" } : {}),
    },
  ]);
  const [saving, setSaving] = useState(false);
  const [masterErrors, setMasterErrors] = useState<Record<string, string>>({});
  const [detailErrors, setDetailErrors] = useState<Record<number, Record<string, string>>>({});

  // Nạp record của các entity nguồn dùng cho field-lookup (vd tr_sanpham) để
  // đổ vào dropdown; key theo danh sách entity để effect chạy lại khi đổi cấu hình.
  const masterLookups = config.master.fieldLookups;
  const detailLookups = config.detail.fieldLookups;
  const lookupEntityKey = [
    ...new Set([
      ...(masterLookups ? Object.values(masterLookups).map((l) => l.entity) : []),
      ...(detailLookups ? Object.values(detailLookups).map((l) => l.entity) : []),
    ]),
  ].join(",");
  const [lookupData, setLookupData] = useState<Record<string, Record<string, unknown>[]>>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: bám lookupEntityKey thay object lookups
  useEffect(() => {
    if (!lookupEntityKey) return;
    const ids = lookupEntityKey.split(",");
    let alive = true;
    Promise.all(
      ids.map((id) =>
        api
          .getRecords(id, { limit: 2000 })
          .then((res) => [id, res.rows.map((r) => r.data)] as const)
          .catch(() => [id, [] as Record<string, unknown>[]] as const),
      ),
    ).then((pairs) => {
      if (alive) setLookupData(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [lookupEntityKey]);

  const setRow = (i: number, name: string, v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [name]: v } : r)));

  const renderInput = (
    f: EntityField,
    value: string,
    onChange: (v: string) => void,
    compact = false,
    lookup?: FieldLookup,
  ) => {
    if (lookup) {
      const srcRows = lookupData[lookup.entity] ?? [];
      const labelFields = lookup.labelFields ?? [lookup.valueField];
      const opts = srcRows.map((r) => {
        const val = String(r[lookup.valueField] ?? "");
        const lbl = labelFields
          .map((lf) => r[lf])
          .filter((x) => x != null && String(x) !== "")
          .join(" — ");
        return { value: val, label: lbl || val };
      });
      const richOpts = opts.map((option, index) => {
        const cells = labelFields.map((field) => String(srcRows[index]?.[field] ?? ""));
        return { ...option, cells, searchText: cells.join(" ") };
      });
      // Placeholder suy từ nhãn entity nguồn → dùng chung cho mọi lookup
      // (khách hàng, sản phẩm, …) thay vì cố định "sản phẩm".
      const srcLabel = entities.find((e) => e.id === lookup.entity)?.name ?? "mục";
      if (lookup.multiple) {
        return (
          <MultiLookupPicker
            value={value ?? ""}
            onChange={onChange}
            options={richOpts}
            title={srcLabel}
            separator={lookup.separator}
          />
        );
      }
      return (
        <SearchableSelect
          className="w-full"
          value={value ?? ""}
          onChange={onChange}
          options={richOpts}
          columnHeaders={lookup.columnHeaders}
          emptyOption={`— chọn ${srcLabel} —`}
          searchPlaceholder={`Tìm ${srcLabel}…`}
        />
      );
    }
    if (f.type === "boolean" || f.type === "bool") {
      return (
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
        />
      );
    }
    if (f.options && f.options.length > 0) {
      return (
        <SearchableSelect
          className="w-full"
          value={value ?? ""}
          onChange={onChange}
          options={f.options.map((o) => ({ value: o, label: o }))}
          emptyOption="— chọn —"
        />
      );
    }
    if (!compact && (f.type === "text" || f.type === "longtext")) {
      return (
        <textarea
          className="input w-full resize-none"
          rows={f.type === "longtext" ? 3 : 1}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={f.label}
        />
      );
    }
    return (
      <Input
        type={inputTypeFor(f.type)}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={compact ? undefined : f.label}
      />
    );
  };

  const onSave = async () => {
    if (saving) return;
    const requiredMaster = new Set(config.master.requiredFields ?? []);
    const missing = masterFields.filter(
      (f) => (f.required || requiredMaster.has(f.name)) && !(master[f.name] ?? "").trim(),
    );
    const nextMasterErrors = Object.fromEntries(
      missing.map((field) => [
        field.name,
        `${config.master.fieldLabels?.[field.name] ?? field.label} là bắt buộc`,
      ]),
    );
    setMasterErrors(nextMasterErrors);
    if (missing.length > 0) {
      setTab("master");
      toast.error(`Thiếu thông tin bắt buộc: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    setSaving(true);
    try {
      const validRows = rows.filter((row) =>
        Object.entries(row).some(([field, value]) => field !== "_key" && value.trim() !== ""),
      );
      const requiredDetail = config.detail.requiredFields ?? [];
      const nextDetailErrors: Record<number, Record<string, string>> = {};
      validRows.forEach((row, rowIndex) => {
        for (const field of requiredDetail) {
          if (!(row[field] ?? "").trim()) {
            nextDetailErrors[rowIndex] ??= {};
            nextDetailErrors[rowIndex][field] =
              `${config.detail.fieldLabels?.[field] ?? field} là bắt buộc`;
          }
        }
      });
      setDetailErrors(nextDetailErrors);
      const invalidRow = Object.keys(nextDetailErrors).length
        ? Number(Object.keys(nextDetailErrors)[0])
        : -1;
      if (invalidRow >= 0) {
        setTab("detail");
        throw new Error(`Dòng chi tiết ${invalidRow + 1} chưa nhập đủ thông tin bắt buộc.`);
      }
      await api.createRecord(config.master.entity, buildData(master, masterFields));
      const keyVal = (master[config.detail.parentKeyField] ?? "").trim();
      const computed = config.detail.computed;
      for (const [rowIndex, r] of validRows.entries()) {
        const data = buildData(r, detailFields);
        if (config.detail.autoSequenceField) {
          data[config.detail.autoSequenceField] = rowIndex + 1;
        }
        if (keyVal) data[config.detail.linkField] = keyVal;
        // Field tự tính (vd amount = order_qty × price) — ghi đè khi lưu.
        if (computed)
          for (const [tf, factors] of Object.entries(computed))
            data[tf] = computeProduct(r, factors);
        await api.createRecord(config.detail.entity, data);
      }
      toast.success(
        `Đã tạo ${config.subjectLabel ?? "bản ghi"}${
          validRows.length > 0 ? ` cùng ${validRows.length} dòng chi tiết` : ""
        }`,
      );
      onCreated();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || `Lỗi khi tạo ${config.subjectLabel ?? "bản ghi"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={config.title ?? "Thêm mới đơn hàng"}
      width={config.width ?? 1000}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Huỷ
          </Button>
          <Button variant="primary" onClick={onSave} disabled={saving}>
            {saving ? "Đang lưu..." : "Lưu"}
          </Button>
        </>
      }
    >
      {(Object.keys(masterErrors).length > 0 || Object.keys(detailErrors).length > 0) && (
        <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          Vui lòng điền đầy đủ các trường bắt buộc được đánh dấu bên dưới.
        </div>
      )}
      {config.layout !== "single" && (
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "master", label: config.masterLabel ?? "Thông tin" },
            { value: "detail", label: config.detailLabel ?? "Chi tiết" },
          ]}
        />
      )}

      {(config.layout === "single" || tab === "master") && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          {masterFields.map((f) => (
            <div
              key={f.id}
              className={
                config.master.fullWidthFields?.includes(f.name)
                  ? "space-y-1 col-span-2"
                  : "space-y-1"
              }
            >
              <label className="text-xs font-medium">
                {config.master.fieldLabels?.[f.name] ?? f.label}
                {(f.required || config.master.requiredFields?.includes(f.name)) && (
                  <span className="text-danger ml-0.5">*</span>
                )}
              </label>
              <div className={masterErrors[f.name] ? "rounded-md ring-1 ring-danger" : undefined}>
                {renderInput(
                  f,
                  master[f.name] ?? "",
                  (v) => {
                    setMaster((s) => ({ ...s, [f.name]: v }));
                    if (v.trim()) {
                      setMasterErrors((current) => {
                        const next = { ...current };
                        delete next[f.name];
                        return next;
                      });
                    }
                  },
                  false,
                  masterLookups?.[f.name],
                )}
              </div>
              {masterErrors[f.name] && (
                <p className="text-xs text-danger">{masterErrors[f.name]}</p>
              )}
            </div>
          ))}
        </div>
      )}
      {(config.layout === "single" || tab === "detail") && (
        <div className={config.layout === "single" ? "mt-4 space-y-2" : "mt-3 space-y-2"}>
          <div className="overflow-x-auto border border-border rounded-md max-h-[420px] overflow-y-auto">
            <table className="text-sm w-full">
              <thead className="bg-panel-2 sticky top-0">
                <tr>
                  {detailFields.map((f) => (
                    <th
                      key={f.id}
                      className="px-2 py-1.5 text-left text-xs font-semibold text-muted whitespace-nowrap"
                    >
                      {config.detail.fieldLabels?.[f.name] ?? f.label}
                      {config.detail.requiredFields?.includes(f.name) && (
                        <span className="text-danger ml-0.5">*</span>
                      )}
                    </th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r._key}
                    className={
                      detailErrors[i]
                        ? "border-t border-danger bg-danger/5"
                        : "border-t border-border"
                    }
                  >
                    {detailFields.map((f) => {
                      const factors = config.detail.computed?.[f.name];
                      return (
                        <td
                          key={f.id}
                          className={
                            detailLookups?.[f.name]
                              ? "px-1.5 py-1 min-w-[220px]"
                              : "px-1.5 py-1 min-w-[130px]"
                          }
                        >
                          {factors ? (
                            // Field tự tính (read-only) — hiển thị tích live.
                            <div className="px-2 py-1 text-right tabular-nums text-muted">
                              {computeProduct(r, factors).toLocaleString("vi-VN")}
                            </div>
                          ) : (
                            renderInput(
                              f,
                              r[f.name] ?? "",
                              (v) => {
                                setRow(i, f.name, v);
                                if (v.trim()) {
                                  setDetailErrors((current) => {
                                    const next = { ...current };
                                    const rowErrors = { ...(next[i] ?? {}) };
                                    delete rowErrors[f.name];
                                    if (Object.keys(rowErrors).length) next[i] = rowErrors;
                                    else delete next[i];
                                    return next;
                                  });
                                }
                              },
                              true,
                              detailLookups?.[f.name],
                            )
                          )}
                          {detailErrors[i]?.[f.name] && (
                            <p className="px-1 pt-0.5 text-[11px] text-danger">
                              {detailErrors[i][f.name]}
                            </p>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-center">
                      <button
                        type="button"
                        title="Xoá dòng"
                        className="p-1 text-muted hover:text-danger"
                        onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                      >
                        <I.Trash size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {config.detail.footerSums && config.detail.footerSums.length > 0 && (
                <tfoot className="sticky bottom-0 bg-panel-2 border-t-2 border-border">
                  <tr>
                    {detailFields.map((f, idx) => {
                      const isSum = config.detail.footerSums?.includes(f.name);
                      return (
                        <td
                          key={f.id}
                          className={
                            isSum
                              ? "px-2 py-1.5 text-right text-xs font-semibold tabular-nums"
                              : "px-2 py-1.5 text-xs font-semibold text-muted"
                          }
                        >
                          {isSum
                            ? sumField(rows, f.name, config.detail.computed).toLocaleString("vi-VN")
                            : idx === 0
                              ? "Tổng"
                              : ""}
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <Button
            variant="ghost"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                {
                  _key: crypto.randomUUID(),
                  ...(config.detail.autoSequenceField
                    ? { [config.detail.autoSequenceField]: String(rs.length + 1) }
                    : {}),
                },
              ])
            }
            icon={<I.Plus size={13} />}
          >
            Thêm dòng
          </Button>
          {config.layout !== "single" && (
            <p className="text-xs text-muted">
              Mỗi dòng chi tiết sẽ tự gán {config.detail.linkField} = giá trị{" "}
              {config.detail.parentKeyField} ở phần thông tin.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
