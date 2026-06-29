/* ==========================================================
   MasterDetailEditModal — dialog SỬA record master-detail (2 tab),
   song song với MasterDetailCreateModal nhưng NẠP SẴN dữ liệu:
   - Tab master: form field entity cha, điền sẵn từ record đang sửa.
   - Tab detail: bảng các dòng con (link theo parentKeyField), điền
     sẵn + cho thêm/xóa dòng.
   Lưu: updateRecord(cha) → với mỗi dòng con: có _rid → updateRecord,
   chưa có → createRecord; dòng bị xóa → deleteRecord.
   Dùng chung CreateFormCfg + FieldLookup với modal tạo mới.
   ========================================================== */
import { createApiDataSource } from "@erp-framework/client";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Input, Modal, SearchableSelect, Tabs } from "@/components/ui";
import type { EntityField } from "@/lib/object-types";
import { toast } from "@/lib/toast";
import { useUserObjects } from "@/stores/userObjects";
import { LookupPicker } from "./LookupPicker";
import {
  type CreateFormCfg,
  computeProduct,
  type FieldLookup,
  sumField,
} from "./MasterDetailCreateModal";
import { MultiLookupPicker } from "./MultiLookupPicker";

const api = createApiDataSource("");

interface Props {
  config: CreateFormCfg;
  /** ID record master (đơn hàng) đang sửa. */
  recordId: string;
  onClose: () => void;
  onSaved: () => void;
  /** Chỉ xem: vô hiệu mọi input, ẩn nút thêm/xóa dòng + nút Lưu. */
  readOnly?: boolean;
}

/** Dòng chi tiết kèm _rid = id record con (undefined = dòng mới). */
type DetailRow = Record<string, string> & { _key: string; _rid?: string };

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
 *  ("2026-06-15T00:00:00.000Z"). Dùng UTC nên không lệch ±1 ngày theo tz.
 *  Giá trị không phải date-only (đã ISO / khác format) → giữ nguyên. */
function toIsoDate(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

/** Giá trị record → string cho input (boolean → "true"/"false"). */
function toStr(v: unknown, type: string): string {
  if (v == null) return "";
  if (type === "boolean" || type === "bool") return v === true || v === "true" ? "true" : "false";
  // date/datetime render bằng <input type="date"> → cần "YYYY-MM-DD".
  // Data lưu ISO ("2026-06-15T00:00:00.000Z") hoặc date-only → cắt phần ngày.
  if (type === "date" || type === "datetime") {
    const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : String(v);
  }
  return String(v);
}

/** Gom giá trị đã nhập → payload (bỏ rỗng, boolean về bool, date → ISO). */
function buildData(vals: Record<string, string>, fields: EntityField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = vals[f.name];
    if (v === undefined) continue;
    if (f.type === "boolean" || f.type === "bool") {
      out[f.name] = v === "true";
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

export function MasterDetailEditModal({
  config,
  recordId,
  onClose,
  onSaved,
  readOnly = false,
}: Props) {
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
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [masterErrors, setMasterErrors] = useState<Record<string, string>>({});
  const [detailErrors, setDetailErrors] = useState<Record<number, Record<string, string>>>({});

  /* ── Nạp dữ liệu lookup (master + detail) cho combobox ── */
  const masterLookups = config.master.fieldLookups;
  const detailLookups = config.detail.fieldLookups;
  const lookupEntityKey = [
    ...new Set([
      ...(masterLookups ? Object.values(masterLookups).map((l) => l.entity) : []),
      ...(detailLookups ? Object.values(detailLookups).map((l) => l.entity) : []),
    ]),
  ].join(",");
  const [lookupData, setLookupData] = useState<Record<string, Record<string, unknown>[]>>({});
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

  /* ── Nạp record master + các dòng chi tiết để điền sẵn ── */
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ nạp lại khi đổi recordId/entity; masterFields/detailFields ổn định theo entity
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const keyField = config.detail.parentKeyField;
    const linkField = config.detail.linkField;
    api
      .getRecord(recordId)
      .then(async (rec) => {
        if (!alive) return;
        const mdata = (rec?.data ?? {}) as Record<string, unknown>;
        const mInit: Record<string, string> = {};
        for (const f of masterFields) mInit[f.name] = toStr(mdata[f.name], f.type);
        if (alive) setMaster(mInit);

        const keyVal = String(mdata[keyField] ?? "");
        if (keyVal) {
          const res = await api
            .getRecords(config.detail.entity, {
              filters: { [linkField]: { op: "=", value: keyVal } },
              limit: 1000,
            })
            .catch(() => ({ rows: [] }) as { rows: { id: string; data: unknown }[] });
          if (alive) {
            const drows: DetailRow[] = res.rows.map((r) => {
              const d = (r.data ?? {}) as Record<string, unknown>;
              const row: DetailRow = { _key: r.id, _rid: r.id };
              for (const f of detailFields) row[f.name] = toStr(d[f.name], f.type);
              return row;
            });
            setRows(drows);
          }
        }
        if (alive) setLoading(false);
      })
      .catch(() => {
        if (alive) {
          setLoading(false);
          toast.error("Lỗi tải đơn hàng");
        }
      });
    return () => {
      alive = false;
    };
  }, [recordId, config.master.entity, config.detail.entity]);

  const setRow = (i: number, name: string, v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [name]: v } : r)));

  const removeRow = (i: number) =>
    setRows((rs) => {
      const r = rs[i];
      if (r?._rid) setDeleted((d) => [...d, r._rid as string]);
      return rs.filter((_, idx) => idx !== i);
    });

  const renderInput = (
    f: EntityField,
    value: string,
    onChange: (v: string) => void,
    compact = false,
    lookup?: FieldLookup,
    cellReadOnly = false,
  ) => {
    if (readOnly || cellReadOnly) {
      const displayValue =
        f.type === "boolean" || f.type === "bool"
          ? value === "true"
            ? "Có"
            : "Không"
          : value || "—";
      return (
        <div
          className={
            compact
              ? "min-h-8 px-2 py-1.5 text-sm"
              : "min-h-9 rounded-md border border-border bg-bg-soft px-3 py-2 text-sm whitespace-pre-wrap"
          }
        >
          {displayValue}
        </div>
      );
    }
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
      const srcLabel = entities.find((e) => e.id === lookup.entity)?.name ?? "mục";
      if (lookup.multiple) {
        return (
          <MultiLookupPicker
            value={value ?? ""}
            onChange={onChange}
            options={richOpts}
            title={srcLabel}
            separator={lookup.separator}
            disabled={readOnly}
          />
        );
      }
      // serverSearch: bảng lớn → LookupPicker (preload + ILIKE server khi gõ).
      if (lookup.serverSearch) {
        return (
          <LookupPicker
            refEntityId={lookup.entity}
            value={value ?? ""}
            onChange={onChange}
            valueField={lookup.valueField}
            className="w-full"
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
          disabled={readOnly}
        />
      );
    }
    if (f.type === "boolean" || f.type === "bool") {
      return (
        <input
          type="checkbox"
          checked={value === "true"}
          disabled={readOnly}
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
          disabled={readOnly}
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
          disabled={readOnly}
        />
      );
    }
    return (
      <Input
        type={inputTypeFor(f.type)}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={compact ? undefined : f.label}
        disabled={readOnly}
      />
    );
  };

  const onSave = async () => {
    if (saving) return;
    const requiredMaster = new Set(config.master.requiredFields ?? []);
    const missing = masterFields.filter(
      (f) => (f.required || requiredMaster.has(f.name)) && !(master[f.name] ?? "").trim(),
    );
    setMasterErrors(
      Object.fromEntries(
        missing.map((field) => [
          field.name,
          `${config.master.fieldLabels?.[field.name] ?? field.label} là bắt buộc`,
        ]),
      ),
    );
    if (missing.length > 0) {
      setTab("master");
      toast.error(`Thiếu thông tin bắt buộc: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    setSaving(true);
    try {
      const requiredDetail = config.detail.requiredFields ?? [];
      const nextDetailErrors: Record<number, Record<string, string>> = {};
      rows.forEach((row, rowIndex) => {
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
      await api.updateRecord(recordId, buildData(master, masterFields));
      const keyVal = (master[config.detail.parentKeyField] ?? "").trim();
      const computed = config.detail.computed;
      // Xóa các dòng bị bỏ trước.
      for (const rid of deleted) await api.deleteRecord(rid);
      // Upsert dòng chi tiết.
      for (const [rowIndex, r] of rows.entries()) {
        const hasData = Object.entries(r).some(
          ([key, value]) => key !== "_rid" && key !== "_key" && value.trim() !== "",
        );
        const data = buildData(r, detailFields);
        if (config.detail.autoSequenceField) {
          data[config.detail.autoSequenceField] = rowIndex + 1;
        }
        if (keyVal) data[config.detail.linkField] = keyVal;
        // Field tự tính (vd amount = order_qty × price) — ghi đè khi lưu.
        if (computed)
          for (const [tf, factors] of Object.entries(computed))
            data[tf] = computeProduct(r, factors);
        if (r._rid) {
          await api.updateRecord(r._rid, data);
        } else if (hasData) {
          await api.createRecord(config.detail.entity, data);
        }
      }
      toast.success(`Đã cập nhật ${config.subjectLabel ?? "bản ghi"}`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || `Lỗi khi cập nhật ${config.subjectLabel ?? "bản ghi"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        readOnly
          ? (config.viewTitle ?? `Thông tin ${config.subjectLabel ?? "bản ghi"}`)
          : (config.editTitle ??
            (config.title ? config.title.replace(/^Thêm/i, "Sửa") : "Sửa bản ghi"))
      }
      width={config.width ?? 1000}
      footer={
        readOnly ? (
          <Button variant="ghost" onClick={onClose}>
            Đóng
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Huỷ
            </Button>
            <Button variant="primary" onClick={onSave} disabled={saving || loading}>
              {saving ? "Đang lưu..." : "Lưu"}
            </Button>
          </>
        )
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted text-sm gap-2">
          <I.Loader size={16} className="animate-spin" />
          Đang tải dữ liệu đơn hàng...
        </div>
      ) : (
        <>
          {!readOnly &&
            (Object.keys(masterErrors).length > 0 || Object.keys(detailErrors).length > 0) && (
              <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                Vui lòng điền đầy đủ các trường bắt buộc được đánh dấu bên dưới.
              </div>
            )}
          {(() => {
            const masterFormContent = (stacked = false) => (
              <div className={stacked ? "space-y-3" : "mt-3 grid grid-cols-2 gap-x-4 gap-y-3"}>
                {masterFields.map((f) => {
                  const fResolved = config.master.longtextFields?.includes(f.name)
                    ? { ...f, type: "longtext" as EntityField["type"] }
                    : f;
                  const isFieldReadonly = config.master.readonlyFields?.includes(f.name);
                  return (
                    <div
                      key={f.id ?? f.name}
                      className={
                        !stacked && config.master.fullWidthFields?.includes(f.name)
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
                      <div
                        className={
                          masterErrors[f.name] ? "rounded-md ring-1 ring-danger" : undefined
                        }
                      >
                        {renderInput(
                          fResolved,
                          master[f.name] ?? "",
                          (v) => {
                            setMaster((s) => ({ ...s, [f.name]: v }));
                            if (v.trim())
                              setMasterErrors((c) => {
                                const n = { ...c };
                                delete n[f.name];
                                return n;
                              });
                          },
                          false,
                          masterLookups?.[f.name],
                          isFieldReadonly,
                        )}
                      </div>
                      {masterErrors[f.name] && (
                        <p className="text-xs text-danger">{masterErrors[f.name]}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            );

            const renderDetailTable = (inSplit = false) => (
              <div
                className={
                  inSplit
                    ? "flex flex-col gap-2 flex-1 min-h-0"
                    : config.layout === "single"
                      ? "mt-4 space-y-2"
                      : "mt-3 space-y-2"
                }
              >
                <div
                  className={
                    inSplit
                      ? "overflow-auto border border-border rounded-md flex-1 min-h-0"
                      : "overflow-x-auto border border-border rounded-md max-h-[420px] overflow-y-auto"
                  }
                >
                  <table className={`text-sm${inSplit ? " min-w-max" : " w-full"}`}>
                    <thead className="bg-panel-2 sticky top-0">
                      <tr>
                        {detailFields.map((f) => (
                          <th
                            key={f.id ?? f.name}
                            style={{
                              width:
                                config.detail.fieldWidths?.[f.name] ??
                                (detailLookups?.[f.name]
                                  ? 190
                                  : f.type === "number"
                                    ? 90
                                    : undefined),
                            }}
                            className="px-2 py-1.5 text-left text-xs font-semibold text-muted whitespace-nowrap"
                          >
                            {config.detail.fieldLabels?.[f.name] ?? f.label}
                            {config.detail.requiredFields?.includes(f.name) && (
                              <span className="text-danger ml-0.5">*</span>
                            )}
                          </th>
                        ))}
                        {!readOnly && <th className="w-8" />}
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
                                key={f.id ?? f.name}
                                className="px-1.5 py-1"
                                style={{
                                  minWidth:
                                    config.detail.fieldWidths?.[f.name] ??
                                    (detailLookups?.[f.name]
                                      ? 190
                                      : f.type === "number"
                                        ? 90
                                        : 110),
                                }}
                              >
                                {factors ? (
                                  <div className="px-2 py-1 text-right tabular-nums text-muted">
                                    {computeProduct(r, factors).toLocaleString("vi-VN")}
                                  </div>
                                ) : (
                                  renderInput(
                                    f,
                                    r[f.name] ?? "",
                                    (v) => {
                                      setRow(i, f.name, v);
                                      if (v.trim())
                                        setDetailErrors((cur) => {
                                          const n = { ...cur };
                                          const re = { ...(n[i] ?? {}) };
                                          delete re[f.name];
                                          if (Object.keys(re).length) n[i] = re;
                                          else delete n[i];
                                          return n;
                                        });
                                    },
                                    true,
                                    detailLookups?.[f.name],
                                    !!r._rid &&
                                      !!config.detail.editableOnExisting &&
                                      !config.detail.editableOnExisting.includes(f.name),
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
                          {!readOnly && (
                            <td className="text-center">
                              <button
                                type="button"
                                title="Xoá dòng"
                                className="p-1 text-muted hover:text-danger"
                                onClick={() => removeRow(i)}
                              >
                                <I.Trash size={13} />
                              </button>
                            </td>
                          )}
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
                                key={f.id ?? f.name}
                                className={
                                  isSum
                                    ? "px-2 py-1.5 text-right text-xs font-semibold tabular-nums"
                                    : "px-2 py-1.5 text-xs font-semibold text-muted"
                                }
                              >
                                {isSum
                                  ? sumField(rows, f.name, config.detail.computed).toLocaleString(
                                      "vi-VN",
                                    )
                                  : idx === 0
                                    ? "Tổng"
                                    : ""}
                              </td>
                            );
                          })}
                          {!readOnly && <td />}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {!readOnly && (
                  <>
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
                    {!inSplit && config.layout !== "single" && (
                      <p className="text-xs text-muted">
                        Dòng mới sẽ tự gán {config.detail.linkField} = giá trị{" "}
                        {config.detail.parentKeyField} ở phần thông tin.
                      </p>
                    )}
                  </>
                )}
              </div>
            );

            if (config.layout === "split") {
              return (
                <div className="flex gap-0 mt-1" style={{ height: 520 }}>
                  <div className="w-[360px] shrink-0 flex flex-col border-r border-border pr-4">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">
                      {config.masterLabel ?? "Thông tin chung"}
                    </p>
                    <div className="flex-1 overflow-y-auto pr-0.5">{masterFormContent(true)}</div>
                  </div>
                  <div className="flex-1 min-w-0 pl-4 flex flex-col gap-2 overflow-hidden">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">
                      {config.detailLabel ?? "Chi tiết"}
                    </p>
                    {renderDetailTable(true)}
                  </div>
                </div>
              );
            }

            return (
              <>
                {config.layout !== "single" && (
                  <Tabs
                    value={tab}
                    onChange={setTab}
                    options={[
                      { value: "master", label: config.masterLabel ?? "Thông tin" },
                      {
                        value: "detail",
                        label: `${config.detailLabel ?? "Chi tiết"} (${rows.length})`,
                      },
                    ]}
                  />
                )}
                {(config.layout === "single" || tab === "master") && masterFormContent()}
                {(config.layout === "single" || tab === "detail") && renderDetailTable()}
              </>
            );
          })()}
        </>
      )}
    </Modal>
  );
}
