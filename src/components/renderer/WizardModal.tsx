/* ==========================================================
   WizardModal — Modal wizard nhập dữ liệu nhiều bước, được
   kích hoạt bởi ActionStep "open-wizard". Mỗi bước có thể
   gắn entity để tạo bản ghi thật; ID được lưu vào pageState
   qua saveOutputTo của từng bước.
   ========================================================== */
import { createApiDataSource } from "@erp-framework/client";
import { type ReactNode, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { LookupPicker } from "@/components/renderer/LookupPicker";
import { computeProduct, sumField } from "@/components/renderer/MasterDetailCreateModal";
import { Button, Input, Modal, SearchableSelect } from "@/components/ui";
import type { EntityField } from "@/lib/object-types";
import type { PageStateLike } from "@/lib/run-action";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionConfig, ActionStepOpenWizard } from "@/types/page";

const api = createApiDataSource("");

/** "YYYY-MM-DD" → ISO UTC (đồng nhất với data đã có; không lệch ±1 ngày). */
function toIsoDate(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

/** Giá trị record → string cho input (boolean→"true"/"false", date→"YYYY-MM-DD"). */
function toStr(v: unknown, type: string): string {
  if (v == null) return "";
  if (type === "boolean" || type === "bool") return v === true || v === "true" ? "true" : "false";
  if (type === "date" || type === "datetime") {
    const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : String(v);
  }
  return String(v);
}

/** Gom giá trị 1 dòng lưới → payload (bỏ rỗng, boolean→bool, date→ISO). */
function buildRowData(
  vals: Record<string, string>,
  fields: EntityField[],
): Record<string, unknown> {
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

interface Props {
  step: ActionStepOpenWizard;
  pageState: PageStateLike;
  /** (Chế độ 1-entity) ID bản ghi cần SỬA. Có → prefill + update; không → tạo mới. */
  recordId?: unknown;
  onDone: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  /** Render một ActionConfig thành nút hành động. Được cung cấp bởi ActionWidget để tránh circular import. */
  renderAction?: (action: ActionConfig, key: string) => ReactNode;
}

/** Khoá form dùng chung cho mọi bước ở chế độ 1-entity (tránh field cùng tên
 *  ở 2 bước ghi đè nhau khi gộp). */
const SINGLE_FORM_KEY = "__wizard_single__";

export function WizardModal({ step, pageState, recordId, onDone, onCancel, renderAction }: Props) {
  const entities = useUserObjects((s) => s.entities);
  const wizardSteps = step.steps ?? [];

  // Chế độ 1-entity: mọi bước thao tác cùng step.entity (gom field theo bước).
  const wizardEntityId = step.entity;
  const editId = recordId == null || recordId === "" ? null : String(recordId);
  const readOnly = step.readOnly === true;

  const [activeIdx, setActiveIdx] = useState(0);
  // Tạo mới (không recordId) + có defaults → điền sẵn giá trị mặc định.
  const [forms, setForms] = useState<Record<string, Record<string, string>>>(() => {
    const init: Record<string, Record<string, string>> = {};
    if (wizardEntityId && !editId && step.defaults) init[SINGLE_FORM_KEY] = { ...step.defaults };
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [collected, setCollected] = useState<Record<string, unknown>>({});
  // Dòng nhập của các bước lưới chi tiết (theo step.id).
  const [detailRows, setDetailRows] = useState<Record<string, Record<string, string>[]>>({});
  // Record nguồn cho field-lookup trong lưới chi tiết (theo entityId).
  const [detailLookupData, setDetailLookupData] = useState<
    Record<string, Record<string, unknown>[]>
  >({});
  // (SỬA) id các dòng chi tiết cũ bị xoá → deleteRecord khi lưu.
  const [deletedDetail, setDeletedDetail] = useState<string[]>([]);

  // Nạp record nguồn cho mọi field-lookup: field master (combobox) + lưới detail.
  const lookupKey = [
    ...new Set(
      wizardSteps.flatMap((s) => [
        ...(s.fieldLookups ? Object.values(s.fieldLookups).map((l) => l.entity) : []),
        ...(s.detail?.fieldLookups
          ? Object.values(s.detail.fieldLookups).map((l) => l.entity)
          : []),
      ]),
    ),
  ].join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: bám lookupKey (chuỗi id) thay mảng object
  useEffect(() => {
    if (!lookupKey) return;
    let alive = true;
    Promise.all(
      lookupKey.split(",").map((id) =>
        api
          .getRecords(id, { limit: 2000 })
          .then((res) => [id, res.rows.map((r) => r.data)] as const)
          .catch(() => [id, [] as Record<string, unknown>[]] as const),
      ),
    ).then((pairs) => {
      if (alive) setDetailLookupData(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [lookupKey]);

  // (1-entity, SỬA) Tải bản ghi → prefill form dùng chung.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ nạp lại khi đổi record/entity; KHÔNG bám wizardSteps để khỏi reset input
  useEffect(() => {
    if (!wizardEntityId || !editId) return;
    setLoading(true);
    api
      .getRecord(editId)
      .then(async (rec) => {
        const data = (rec?.data ?? {}) as Record<string, unknown>;
        // Format theo kiểu field (date/datetime → "YYYY-MM-DD" cho input date).
        const mFields = entities.find((e) => e.id === wizardEntityId)?.fields ?? [];
        const typeOf = (k: string) => mFields.find((f) => f.name === k)?.type ?? "text";
        const filled: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) {
          filled[k] = toStr(v, typeOf(k));
        }
        setForms({ [SINGLE_FORM_KEY]: filled });

        // (SỬA) Nạp dòng chi tiết sẵn có cho các bước detail.
        const detailSteps = wizardSteps.filter((s) => s.detail);
        if (detailSteps.length > 0) {
          const loaded: Record<string, Record<string, string>[]> = {};
          for (const s of detailSteps) {
            const dc = s.detail;
            if (!dc) continue;
            const keyVal = String(data[dc.parentKeyField] ?? "");
            if (!keyVal) {
              loaded[s.id] = [];
              continue;
            }
            const dEnt = entities.find((e) => e.id === dc.entity);
            const dFields = dc.fields?.length
              ? (dEnt?.fields ?? []).filter((f) => dc.fields?.includes(f.name))
              : (dEnt?.fields ?? []).filter((f) => f.type !== "formula" && f.type !== "collection");
            const res = await api
              .getRecords(dc.entity, {
                filters: { [dc.linkField]: { op: "=", value: keyVal } },
                limit: 1000,
              })
              .catch(() => ({ rows: [] }) as { rows: { id: string; data: unknown }[] });
            loaded[s.id] = res.rows.map((r) => {
              const d = (r.data ?? {}) as Record<string, unknown>;
              const row: Record<string, string> = { _rid: r.id };
              for (const f of dFields) row[f.name] = toStr(d[f.name], f.type);
              return row;
            });
          }
          setDetailRows(loaded);
        }
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [wizardEntityId, editId]);

  if (wizardSteps.length === 0) {
    return (
      <Modal open onClose={onCancel} title={step.title || "Wizard"} width={540}>
        <p className="text-sm text-muted text-center py-6">Wizard chưa cấu hình bước nào.</p>
      </Modal>
    );
  }

  const current = wizardSteps[Math.min(activeIdx, wizardSteps.length - 1)];
  if (!current) return null;

  // 1-entity mode: mọi bước dùng wizardEntityId; else: entity riêng từng bước.
  const stepEntityId = wizardEntityId ?? current.entity;
  const ent = stepEntityId ? entities.find((e) => e.id === stepEntityId) : undefined;
  const visibleFields = current.fields?.length
    ? (ent?.fields ?? []).filter((f) => current.fields!.includes(f.name))
    : (ent?.fields ?? []);
  // 1-entity → form dùng chung 1 khoá cho mọi bước; else → form riêng theo step.id.
  const formKey = wizardEntityId ? SINGLE_FORM_KEY : current.id;
  const form = forms[formKey] ?? {};
  const setField = (k: string, v: string) =>
    setForms((prev) => ({ ...prev, [formKey]: { ...(prev[formKey] ?? {}), [k]: v } }));
  const isLast = activeIdx === wizardSteps.length - 1;

  // ── Bước lưới chi tiết (master-detail) ──
  const detailCfg = current.detail;
  const detailEnt = detailCfg ? entities.find((e) => e.id === detailCfg.entity) : undefined;
  const detailFields: EntityField[] = detailCfg
    ? detailCfg.fields?.length
      ? (detailEnt?.fields ?? []).filter((f) => detailCfg.fields?.includes(f.name))
      : (detailEnt?.fields ?? []).filter((f) => f.type !== "formula" && f.type !== "collection")
    : [];
  const rows = detailRows[current.id] ?? [{}];
  const setRow = (i: number, name: string, v: string) =>
    setDetailRows((prev) => {
      const cur = prev[current.id] ?? [{}];
      return { ...prev, [current.id]: cur.map((r, idx) => (idx === i ? { ...r, [name]: v } : r)) };
    });
  const addRow = () =>
    setDetailRows((prev) => ({ ...prev, [current.id]: [...(prev[current.id] ?? [{}]), {}] }));
  const delRow = (i: number) => {
    const rid = (detailRows[current.id] ?? [{}])[i]?._rid;
    if (rid) setDeletedDetail((d) => [...d, rid]);
    setDetailRows((prev) => ({
      ...prev,
      [current.id]: (prev[current.id] ?? [{}]).filter((_, idx) => idx !== i),
    }));
  };

  const renderDetailCell = (f: EntityField, value: string, onChange: (v: string) => void) => {
    const lk = detailCfg?.fieldLookups?.[f.name];
    if (lk) {
      const src = detailLookupData[lk.entity] ?? [];
      const labels = lk.labelFields ?? [lk.valueField];
      const opts = src.map((r) => {
        const val = String(r[lk.valueField] ?? "");
        const lbl = labels
          .map((x) => r[x])
          .filter((x) => x != null && String(x) !== "")
          .join(" — ");
        return { value: val, label: lbl || val };
      });
      const srcLabel = entities.find((e) => e.id === lk.entity)?.name ?? "mục";
      return (
        <SearchableSelect
          className="w-full"
          value={value}
          onChange={onChange}
          options={opts}
          emptyOption={`— chọn ${srcLabel} —`}
          searchPlaceholder={`Tìm ${srcLabel}…`}
        />
      );
    }
    if (f.type === "boolean" || f.type === "bool") {
      return (
        <input
          type="checkbox"
          className="accent-accent"
          checked={value === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
        />
      );
    }
    if (f.options && f.options.length > 0) {
      return (
        <SearchableSelect
          className="w-full"
          value={value}
          onChange={onChange}
          options={f.options.map((o) => ({ value: o, label: o }))}
          emptyOption="— chọn —"
        />
      );
    }
    return (
      <Input
        type={
          f.type === "number" || f.type === "integer" || f.type === "currency"
            ? "number"
            : f.type === "date" || f.type === "datetime"
              ? "date"
              : "text"
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  };

  const goNext = async () => {
    // Chế độ XEM (chỉ đọc): chỉ điều hướng giữa các bước, KHÔNG lưu gì.
    if (readOnly) {
      if (isLast) onCancel();
      else setActiveIdx((i) => i + 1);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      // ── Chế độ 1-entity: gom field qua các bước, chỉ LƯU ở bước cuối ──
      if (wizardEntityId) {
        if (!isLast) {
          setActiveIdx((i) => i + 1);
          return;
        }
        const shared = forms[SINGLE_FORM_KEY] ?? {};
        // Field date/datetime: "YYYY-MM-DD" → ISO (đồng nhất định dạng đã lưu).
        const mFields = entities.find((e) => e.id === wizardEntityId)?.fields ?? [];
        const typeOf = (k: string) => mFields.find((f) => f.name === k)?.type;
        const payload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(shared)) {
          if (v === "") continue;
          const t = typeOf(k);
          payload[k] = t === "date" || t === "datetime" ? toIsoDate(v) : v;
        }
        const saved = editId
          ? await api.updateRecord(editId, payload)
          : await api.createRecord(wizardEntityId, payload);

        // Đồng bộ dòng chi tiết cho các bước có cấu hình detail (master-detail).
        const keyOf = (dc: NonNullable<typeof current.detail>) =>
          (forms[SINGLE_FORM_KEY]?.[dc.parentKeyField] ?? "").trim();
        // (SỬA) xoá các dòng cũ bị bỏ trước.
        for (const rid of deletedDetail) await api.deleteRecord(rid);
        for (const s of wizardSteps) {
          const dc = s.detail;
          if (!dc) continue;
          const dEnt = entities.find((e) => e.id === dc.entity);
          const dFields = dc.fields?.length
            ? (dEnt?.fields ?? []).filter((f) => dc.fields?.includes(f.name))
            : (dEnt?.fields ?? []).filter((f) => f.type !== "formula" && f.type !== "collection");
          const keyVal = keyOf(dc);
          for (const r of detailRows[s.id] ?? []) {
            const hasData = Object.entries(r).some(
              ([k, v]) => k !== "_rid" && (v ?? "").trim() !== "",
            );
            const data = buildRowData(r, dFields);
            if (keyVal) data[dc.linkField] = keyVal;
            if (dc.computed)
              for (const [tf, factors] of Object.entries(dc.computed))
                data[tf] = computeProduct(r, factors);
            // Dòng cũ (_rid) → update; dòng mới có dữ liệu → create.
            if (r._rid) await api.updateRecord(r._rid, data);
            else if (hasData) await api.createRecord(dc.entity, data);
          }
        }
        onDone({ id: saved.id, ...saved.data });
        return;
      }

      // ── Chế độ đa-entity (cũ): mỗi bước tự tạo bản ghi theo step.entity ──
      let stepData: Record<string, unknown> = {};
      if (current.entity && ent) {
        const payload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(form)) if (v !== "") payload[k] = v;
        const result = await api.createRecord(current.entity, payload);
        stepData = { id: result.id, ...result.data };
        if (current.saveOutputTo) pageState.set(current.saveOutputTo, result.id);
      } else {
        stepData = { ...form };
      }

      const newCollected = { ...collected, [current.id]: stepData };
      setCollected(newCollected);

      if (isLast) {
        const merged: Record<string, unknown> = {};
        for (const d of Object.values(newCollected)) {
          if (d && typeof d === "object") Object.assign(merged, d);
        }
        onDone(merged);
      } else {
        setActiveIdx((i) => i + 1);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onCancel}
      title={step.title || "Wizard"}
      width={wizardSteps.some((s) => s.detail) ? 920 : 540}
    >
      <div className="flex flex-col gap-4">
        {/* Thanh step indicator */}
        <div className="flex items-center overflow-x-auto pb-1">
          {wizardSteps.map((s, i) => (
            <div key={s.id} className="flex items-center shrink-0">
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0",
                  i < activeIdx
                    ? "bg-success text-white"
                    : i === activeIdx
                      ? "bg-accent text-white"
                      : "bg-border text-muted",
                )}
              >
                {i < activeIdx ? <I.Check size={10} /> : i + 1}
              </div>
              <span
                className={cn(
                  "ml-1.5 text-xs whitespace-nowrap",
                  i === activeIdx ? "font-semibold text-fg" : "text-muted",
                )}
              >
                {s.title || `Bước ${i + 1}`}
              </span>
              {i < wizardSteps.length - 1 && <div className="mx-3 h-px w-4 bg-border shrink-0" />}
            </div>
          ))}
        </div>

        {/* Nội dung bước */}
        <div
          className={cn("space-y-3 min-h-[140px]", readOnly && "pointer-events-none opacity-95")}
        >
          {current.description && <p className="text-xs text-muted">{current.description}</p>}
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted text-sm gap-2">
              <I.Loader size={16} className="animate-spin" />
              Đang tải dữ liệu...
            </div>
          ) : detailCfg ? (
            <div className="space-y-2">
              <div className="overflow-x-auto border border-border rounded-md max-h-[320px] overflow-y-auto">
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
                      // biome-ignore lint/suspicious/noArrayIndexKey: dòng nhập tạm chưa có id ổn định
                      <tr key={i} className="border-t border-border">
                        {detailFields.map((f) => {
                          const factors = detailCfg.computed?.[f.name];
                          return (
                            <td
                              key={f.id}
                              className={
                                detailCfg.fieldLookups?.[f.name]
                                  ? "px-1.5 py-1 min-w-[200px]"
                                  : "px-1.5 py-1 min-w-[120px]"
                              }
                            >
                              {factors ? (
                                <div className="px-2 py-1 text-right tabular-nums text-muted">
                                  {computeProduct(r, factors).toLocaleString("vi-VN")}
                                </div>
                              ) : (
                                renderDetailCell(f, r[f.name] ?? "", (v) => setRow(i, f.name, v))
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
                              onClick={() => delRow(i)}
                            >
                              <I.Trash size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {detailCfg.footerSums && detailCfg.footerSums.length > 0 && (
                    <tfoot className="sticky bottom-0 bg-panel-2 border-t-2 border-border">
                      <tr>
                        {detailFields.map((f, idx) => {
                          const isSum = detailCfg.footerSums?.includes(f.name);
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
                                ? sumField(rows, f.name, detailCfg.computed).toLocaleString("vi-VN")
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
                  <Button variant="ghost" onClick={addRow} icon={<I.Plus size={13} />}>
                    Thêm dòng
                  </Button>
                  <p className="text-xs text-muted">
                    Mỗi dòng tự gán {detailCfg.linkField} = {detailCfg.parentKeyField} ở bước thông
                    tin đơn.
                  </p>
                </>
              )}
            </div>
          ) : ent ? (
            visibleFields.length > 0 ? (
              visibleFields.map((f) => (
                <div key={f.id}>
                  <label className="block text-xs font-medium mb-0.5">
                    {f.label}
                    {f.required ? <span className="text-danger ml-0.5">*</span> : null}
                  </label>
                  {current.fieldLookups?.[f.name] ? (
                    (() => {
                      const lk = current.fieldLookups?.[f.name];
                      if (!lk) return null;
                      const src = detailLookupData[lk.entity] ?? [];
                      const labels = lk.labelFields ?? [lk.valueField];
                      const opts = src.map((r) => {
                        const val = String(r[lk.valueField] ?? "");
                        const lbl = labels
                          .map((x) => r[x])
                          .filter((x) => x != null && String(x) !== "")
                          .join(" — ");
                        return { value: val, label: lbl || val };
                      });
                      const srcLabel = entities.find((e) => e.id === lk.entity)?.name ?? "mục";
                      return (
                        <SearchableSelect
                          className="w-full"
                          value={form[f.name] ?? ""}
                          onChange={(v) => {
                            setField(f.name, v);
                            // Tự điền field khác từ record nguồn đã chọn.
                            if (lk.autofill) {
                              const rec = src.find((r) => String(r[lk.valueField] ?? "") === v);
                              for (const [tgt, srcField] of Object.entries(lk.autofill)) {
                                const val = rec ? rec[srcField] : undefined;
                                setField(tgt, val == null ? "" : String(val));
                              }
                            }
                          }}
                          options={opts}
                          emptyOption={`— chọn ${srcLabel} —`}
                          searchPlaceholder={`Tìm ${srcLabel}…`}
                        />
                      );
                    })()
                  ) : (f.type === "lookup" || f.type === "multi-lookup") && f.ref ? (
                    <LookupPicker
                      refEntityId={f.ref}
                      value={form[f.name] ?? ""}
                      onChange={(v) => setField(f.name, v)}
                      multi={f.type === "multi-lookup"}
                    />
                  ) : f.type === "select" && f.options?.length ? (
                    <SearchableSelect
                      className="w-full"
                      value={form[f.name] ?? ""}
                      onChange={(v) => setField(f.name, v)}
                      options={f.options.map((o) => ({ value: o, label: o }))}
                      emptyOption="— chọn —"
                    />
                  ) : f.type === "boolean" ? (
                    <label className="flex items-center gap-2 text-sm mt-0.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-accent"
                        checked={form[f.name] === "true"}
                        onChange={(e) => setField(f.name, e.target.checked ? "true" : "false")}
                      />
                      {f.label}
                    </label>
                  ) : f.type === "longtext" ? (
                    <textarea
                      className="input w-full resize-none"
                      rows={3}
                      value={form[f.name] ?? ""}
                      onChange={(e) => setField(f.name, e.target.value)}
                      placeholder={f.label}
                    />
                  ) : (
                    <input
                      className="input w-full"
                      type={
                        f.type === "number" || f.type === "currency" || f.type === "integer"
                          ? "number"
                          : f.type === "date" || f.type === "datetime"
                            ? "date"
                            : f.type === "email"
                              ? "email"
                              : "text"
                      }
                      value={form[f.name] ?? ""}
                      onChange={(e) => setField(f.name, e.target.value)}
                      placeholder={f.label}
                    />
                  )}
                </div>
              ))
            ) : (
              <p className="text-xs text-muted italic">Entity này chưa có trường nào.</p>
            )
          ) : (
            <p className="text-xs text-muted italic">
              Bước giới thiệu — không cần nhập dữ liệu, nhấn Tiếp theo để tiếp tục.
            </p>
          )}
          {err && <p className="text-xs text-danger">{err}</p>}
        </div>

        {/* Hành động của bước */}
        {renderAction && (current.actions?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {current.actions!.map((a) => renderAction(a, a.id))}
          </div>
        )}

        {/* Điều hướng */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button
            variant="ghost"
            onClick={() => {
              if (activeIdx === 0) {
                onCancel();
              } else {
                setErr("");
                setActiveIdx((i) => i - 1);
              }
            }}
          >
            {activeIdx === 0 ? "Huỷ" : "Quay lại"}
          </Button>
          <span className="text-xs text-muted">
            {activeIdx + 1} / {wizardSteps.length}
          </span>
          <Button variant="primary" disabled={busy} onClick={() => void goNext()}>
            {busy
              ? "Đang lưu..."
              : readOnly
                ? isLast
                  ? "Đóng"
                  : "Tiếp theo →"
                : isLast
                  ? step.submitLabel || "Hoàn tất"
                  : "Tiếp theo →"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
