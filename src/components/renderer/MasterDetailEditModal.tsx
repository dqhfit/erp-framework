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
import {
  type CreateFormCfg,
  computeProduct,
  type FieldLookup,
  sumField,
} from "./MasterDetailCreateModal";

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
type DetailRow = Record<string, string> & { _rid?: string };

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
              const row: DetailRow = { _rid: r.id };
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
      const srcLabel = entities.find((e) => e.id === lookup.entity)?.name ?? "mục";
      return (
        <SearchableSelect
          className="w-full"
          value={value ?? ""}
          onChange={onChange}
          options={opts}
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
    const missing = masterFields.filter((f) => f.required && !(master[f.name] ?? "").trim());
    if (missing.length > 0) {
      setTab("master");
      toast.error(`Thiếu thông tin bắt buộc: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    setSaving(true);
    try {
      await api.updateRecord(recordId, buildData(master, masterFields));
      const keyVal = (master[config.detail.parentKeyField] ?? "").trim();
      const computed = config.detail.computed;
      // Xóa các dòng bị bỏ trước.
      for (const rid of deleted) await api.deleteRecord(rid);
      // Upsert dòng chi tiết.
      for (const r of rows) {
        const hasData = Object.entries(r).some(([k, v]) => k !== "_rid" && (v ?? "").trim() !== "");
        const data = buildData(r, detailFields);
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
      toast.success("Đã cập nhật đơn hàng");
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Lỗi khi cập nhật đơn hàng");
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
          ? config.title
            ? config.title.replace(/^Thêm/i, "Xem")
            : "Xem đơn hàng"
          : config.title
            ? config.title.replace(/^Thêm/i, "Sửa")
            : "Sửa đơn hàng"
      }
      width={1000}
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
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: "master", label: "Thông tin đơn hàng" },
              { value: "detail", label: `Chi tiết đơn hàng (${rows.length})` },
            ]}
          />

          {tab === "master" ? (
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
              {masterFields.map((f) => (
                <div key={f.id} className="space-y-1">
                  <label className="text-xs font-medium">
                    {f.label}
                    {f.required && <span className="text-danger ml-0.5">*</span>}
                  </label>
                  {renderInput(
                    f,
                    master[f.name] ?? "",
                    (v) => setMaster((s) => ({ ...s, [f.name]: v })),
                    false,
                    masterLookups?.[f.name],
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="overflow-x-auto border border-border rounded-md max-h-[420px] overflow-y-auto">
                <table className="text-sm w-full">
                  <thead className="bg-panel-2 sticky top-0">
                    <tr>
                      {detailFields.map((f) => (
                        <th
                          key={f.id}
                          className="px-2 py-1.5 text-left text-xs font-semibold text-muted whitespace-nowrap"
                        >
                          {f.label}
                        </th>
                      ))}
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: dòng nhập theo chỉ số trong phiên; _rid có thể trùng undefined với dòng mới
                      <tr key={i} className="border-t border-border">
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
                                <div className="px-2 py-1 text-right tabular-nums text-muted">
                                  {computeProduct(r, factors).toLocaleString("vi-VN")}
                                </div>
                              ) : (
                                renderInput(
                                  f,
                                  r[f.name] ?? "",
                                  (v) => setRow(i, f.name, v),
                                  true,
                                  detailLookups?.[f.name],
                                )
                              )}
                            </td>
                          );
                        })}
                        <td className="text-center">
                          {!readOnly && (
                            <button
                              type="button"
                              title="Xoá dòng"
                              className="p-1 text-muted hover:text-danger"
                              onClick={() => removeRow(i)}
                            >
                              <I.Trash size={13} />
                            </button>
                          )}
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
                                ? sumField(rows, f.name, config.detail.computed).toLocaleString(
                                    "vi-VN",
                                  )
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
              {!readOnly && (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => setRows((rs) => [...rs, {}])}
                    icon={<I.Plus size={13} />}
                  >
                    Thêm dòng
                  </Button>
                  <p className="text-xs text-muted">
                    Dòng mới sẽ tự gán {config.detail.linkField} = giá trị{" "}
                    {config.detail.parentKeyField} ở tab Thông tin đơn hàng.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
