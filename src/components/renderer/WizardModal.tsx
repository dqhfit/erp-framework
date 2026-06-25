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
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionConfig, ActionStepOpenWizard, WizardLookupRef } from "@/types/page";

const api = createApiDataSource("");

/** Combobox lookup trong wizard + (tùy chọn) nút "+" tạo nhanh bản ghi mới vào
 *  entity nguồn. Tạo xong → nạp lại danh sách (onCreated) + chọn luôn (onPick). */
function WizardLookupField({
  lk,
  src,
  value,
  onPick,
  onCreated,
}: {
  lk: WizardLookupRef;
  src: Record<string, unknown>[];
  value: string;
  onPick: (v: string, rec?: Record<string, unknown>) => void;
  onCreated: () => void;
}) {
  const entities = useUserObjects((s) => s.entities);
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const labels = lk.labelFields ?? [lk.valueField];
  const opts = src.map((r) => {
    const val = String(r[lk.valueField] ?? "");
    const lbl = labels
      .map((x) => r[x])
      .filter((x) => x != null && String(x) !== "")
      .join(" — ");
    return { value: val, label: lbl || val };
  });
  const ent = entities.find((e) => e.id === lk.entity);
  const srcLabel = ent?.name ?? "mục";
  const createNames = lk.createFields ?? [...new Set([lk.valueField, ...labels])];
  const createDefs = createNames
    .map((n) => ent?.fields.find((f) => f.name === n))
    .filter(Boolean) as EntityField[];

  const save = async () => {
    if (saving) return;
    const valKey = String(vals[lk.valueField] ?? "").trim();
    if (!valKey) {
      toast.error(`Vui lòng nhập ${lk.valueField}`);
      return;
    }
    setSaving(true);
    try {
      const data: Record<string, unknown> = {};
      for (const f of createDefs) {
        const v = vals[f.name];
        if (v == null || v === "") continue;
        data[f.name] =
          f.type === "number" || f.type === "integer"
            ? Number(v)
            : f.type === "boolean" || f.type === "bool"
              ? v === "true"
              : v;
      }
      // Field tự tăng (vd id_buocson): KHÔNG nhập tay — gán max(nguồn)+1.
      const autoVals: Record<string, string> = {};
      for (const fname of lk.createAutoInc ?? []) {
        const maxV = src.reduce((m, r) => Math.max(m, Number(r[fname]) || 0), 0);
        const next = maxV + 1;
        data[fname] = next;
        autoVals[fname] = String(next);
      }
      await api.createRecord(lk.entity, data);
      toast.success("Đã thêm mới");
      onCreated();
      onPick(valKey, { ...vals, ...autoVals });
      setOpen(false);
      setVals({});
    } catch (e) {
      toast.error((e as Error).message || "Lỗi tạo mới");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 min-w-0">
        <SearchableSelect
          className="w-full"
          value={value}
          onChange={(v) =>
            onPick(
              v,
              src.find((r) => String(r[lk.valueField] ?? "") === v),
            )
          }
          options={opts}
          emptyOption={`— chọn ${srcLabel} —`}
          searchPlaceholder={`Tìm ${srcLabel}…`}
        />
      </div>
      {lk.allowCreate && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded border border-border text-muted hover:text-accent hover:border-accent transition-colors"
          title={`Thêm ${srcLabel}`}
        >
          <I.Plus size={15} />
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Thêm ${srcLabel}`}
        width={420}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              Lưu
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {createDefs.length === 0 && (
            <div className="text-sm text-muted italic">Không có field để nhập.</div>
          )}
          {createDefs.map((f) => (
            <label key={f.name} className="block space-y-1">
              <span className="text-xs font-medium text-muted">{f.label || f.name}</span>
              {f.type === "boolean" || f.type === "bool" ? (
                <select
                  className="input w-full"
                  value={vals[f.name] ?? ""}
                  onChange={(e) => setVals((p) => ({ ...p, [f.name]: e.target.value }))}
                >
                  <option value="">—</option>
                  <option value="true">Có</option>
                  <option value="false">Không</option>
                </select>
              ) : (
                <Input
                  type={f.type === "number" || f.type === "integer" ? "number" : "text"}
                  value={vals[f.name] ?? ""}
                  onChange={(e) => setVals((p) => ({ ...p, [f.name]: e.target.value }))}
                />
              )}
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
}

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

/** Nội suy {{stateKey}} trong rowDefaults từ pageState → giá trị cho DÒNG MỚI
 *  (vd is_active="true", donhot="{{selQTDonhot}}" lấy theo quy trình đang chọn). */
function interpRowDefaults(
  rowDefaults: Record<string, string> | undefined,
  getState: (k: string) => unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rowDefaults ?? {})) {
    out[k] =
      typeof v === "string"
        ? v.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
            const g = getState(key);
            return g == null ? "" : String(g);
          })
        : v;
  }
  return out;
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

/** Áp fieldOverrides của page lên field entity: merge type/label/options/required
 *  (override thắng). Cho phép cấu hình form sống trong page → đi theo page sync,
 *  KHÔNG cần sửa entity trên DB. Field không có override giữ nguyên. */
function applyFieldOverrides(
  fields: EntityField[],
  ov?: Record<string, { type?: string; label?: string; options?: string[]; required?: boolean }>,
): EntityField[] {
  if (!ov) return fields;
  return fields.map((f) => (ov[f.name] ? ({ ...f, ...ov[f.name] } as EntityField) : f));
}

/** Ép giá trị khoá liên kết (linkField) theo KIỂU field đích: field số (vd
 *  tr_quytrinh_son_chitiet.id_quytrinh là numeric) nhận chuỗi "1" sẽ bị server
 *  từ chối ("phải là số"). Chuyển sang Number khi field đích là số. */
function coerceLinkValue(value: unknown, fields: EntityField[], fieldName: string): unknown {
  const f = fields.find((x) => x.name === fieldName);
  if (f && (f.type === "number" || f.type === "integer" || f.type === "currency")) {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  return value;
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
  const _onCancel = onCancel;
  const entities = useUserObjects((s) => s.entities);
  const wizardSteps = step.steps ?? [];
  // Gom fieldOverrides của mọi bước — cấu hình field nhúng trong page (đổi kiểu/
  // nhãn/options) để form đi theo page sync mà khỏi chạm entity trên DB.
  const fieldOv = Object.assign({}, ...wizardSteps.map((s) => s.fieldOverrides ?? {})) as Record<
    string,
    { type?: string; label?: string; options?: string[]; required?: boolean }
  >;

  // Chế độ 1-entity: mọi bước thao tác cùng step.entity (gom field theo bước).
  const wizardEntityId = step.entity;
  const editId = recordId == null || recordId === "" ? null : String(recordId);
  const readOnly = step.readOnly === true;

  const [activeIdx, setActiveIdx] = useState(0);
  // Tạo mới (không recordId) + có defaults → điền sẵn giá trị mặc định.
  const [forms, setForms] = useState<Record<string, Record<string, string>>>(() => {
    const init: Record<string, Record<string, string>> = {};
    if (wizardEntityId && !editId && step.defaults) {
      // Nội suy {{stateKey}} trong defaults từ pageState — cho phép set khoá cha
      // động khi tạo bản ghi con (vd id_phienban = {{selPhienBan}} của dòng đang chọn).
      const resolved: Record<string, string> = {};
      for (const [k, v] of Object.entries(step.defaults)) {
        resolved[k] =
          typeof v === "string"
            ? v.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
                const got = pageState.get(key);
                return got == null ? "" : String(got);
              })
            : v;
      }
      init[SINGLE_FORM_KEY] = resolved;
    }
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
  const [imgUploading, setImgUploading] = useState<Record<string, boolean>>({});
  // Tăng để buộc nạp lại danh sách lookup (vd sau khi tạo nhanh bản ghi mới qua nút +).
  const [lookupTick, setLookupTick] = useState(0);

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
  }, [lookupKey, lookupTick]);

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
        const mFields = applyFieldOverrides(
          entities.find((e) => e.id === wizardEntityId)?.fields ?? [],
          fieldOv,
        );
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
            // parentKeyField="id" → khoá là ID master (không nằm trong rec.data) → dùng editId.
            const keyVal =
              dc.parentKeyField === "id" ? String(editId) : String(data[dc.parentKeyField] ?? "");
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

  // (DETAIL-ONLY, SỬA) Wizard không có entity cha (vd "Cập nhật quy trình" link
  // theo recordId = màu đang chọn). Nếu bản ghi cha đã có dòng con → nạp sẵn để
  // người dùng sửa trực tiếp. Dòng mang _rid → goNext() update; dòng mới → create.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ nạp khi đổi record/entity; KHÔNG bám wizardSteps để khỏi reset input
  useEffect(() => {
    if (wizardEntityId || !editId) return;
    const detailOnlySteps = wizardSteps.filter((s) => s.detail);
    if (detailOnlySteps.length === 0) return;
    setLoading(true);
    let alive = true;
    (async () => {
      const loaded: Record<string, Record<string, string>[]> = {};
      for (const s of detailOnlySteps) {
        const dc = s.detail;
        if (!dc) continue;
        const dEnt = entities.find((e) => e.id === dc.entity);
        const dFields = dc.fields?.length
          ? (dEnt?.fields ?? []).filter((f) => dc.fields?.includes(f.name))
          : (dEnt?.fields ?? []).filter((f) => f.type !== "formula" && f.type !== "collection");
        const res = await api
          .getRecords(dc.entity, {
            filters: { [dc.linkField]: { op: "=", value: editId } },
            limit: 1000,
          })
          .catch(() => ({ rows: [] }) as { rows: { id: string; data: unknown }[] });
        const mapped = res.rows.map((r) => {
          const d = (r.data ?? {}) as Record<string, unknown>;
          const row: Record<string, string> = { _rid: r.id };
          for (const f of dFields) row[f.name] = toStr(d[f.name], f.type);
          return row;
        });
        // Chưa có dòng nào → để 1 dòng trống (nạp rowDefaults) cho người dùng nhập mới.
        loaded[s.id] =
          mapped.length > 0 ? mapped : [interpRowDefaults(dc.rowDefaults, pageState.get)];
      }
      if (alive) setDetailRows(loaded);
    })()
      .catch((e) => {
        if (alive) setErr((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [wizardEntityId, editId]);

  if (wizardSteps.length === 0) {
    return (
      <Modal open onClose={_onCancel} title={step.title || "Wizard"} width={540}>
        <p className="text-sm text-muted text-center py-6">Wizard chưa cấu hình bước nào.</p>
      </Modal>
    );
  }

  const current = wizardSteps[Math.min(activeIdx, wizardSteps.length - 1)];
  if (!current) return null;

  // 1-entity mode: mọi bước dùng wizardEntityId; else: entity riêng từng bước.
  const stepEntityId = wizardEntityId ?? current.entity;
  const ent = stepEntityId ? entities.find((e) => e.id === stepEntityId) : undefined;
  // Map theo current.fields để GIỮ ĐÚNG THỨ TỰ cấu hình (filter sẽ giữ thứ tự
  // entity gốc → sai vị trí ô nhập). Không có → toàn bộ field entity.
  const entFields = applyFieldOverrides(ent?.fields ?? [], fieldOv);
  const visibleFields = current.fields?.length
    ? (current.fields
        .map((n) => entFields.find((f) => f.name === n))
        .filter(Boolean) as EntityField[])
    : entFields;
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
  // Dòng chi tiết MỚI: nạp sẵn rowDefaults (vd is_active="true", donhot lấy theo quy trình).
  const emptyRow = (): Record<string, string> =>
    interpRowDefaults(detailCfg?.rowDefaults, pageState.get);
  const rows = detailRows[current.id] ?? [emptyRow()];
  const setRow = (i: number, name: string, v: string) =>
    setDetailRows((prev) => {
      const cur = prev[current.id] ?? [emptyRow()];
      return { ...prev, [current.id]: cur.map((r, idx) => (idx === i ? { ...r, [name]: v } : r)) };
    });
  // Cập nhật NHIỀU field của 1 dòng (vd lookup + autofill id_buocson) trong 1 lần.
  const setRowFields = (i: number, patch: Record<string, string>) =>
    setDetailRows((prev) => {
      const cur = prev[current.id] ?? [emptyRow()];
      return { ...prev, [current.id]: cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) };
    });
  const addRow = () =>
    setDetailRows((prev) => ({
      ...prev,
      [current.id]: [...(prev[current.id] ?? [emptyRow()]), emptyRow()],
    }));
  const delRow = (i: number) => {
    const rid = (detailRows[current.id] ?? [emptyRow()])[i]?._rid;
    if (rid) setDeletedDetail((d) => [...d, rid]);
    setDetailRows((prev) => ({
      ...prev,
      [current.id]: (prev[current.id] ?? [{}]).filter((_, idx) => idx !== i),
    }));
  };

  const renderDetailCell = (
    f: EntityField,
    value: string,
    onChange: (v: string) => void,
    onRowPatch?: (patch: Record<string, string>) => void,
  ) => {
    const lk = detailCfg?.fieldLookups?.[f.name];
    if (lk) {
      const src = detailLookupData[lk.entity] ?? [];
      // Combobox lookup trong lưới: hỗ trợ "+" tạo nhanh + autofill (vd id_buocson).
      const pick = (v: string, rec?: Record<string, unknown>) => {
        const patch: Record<string, string> = { [f.name]: v };
        if (lk.autofill) {
          const r = rec ?? src.find((x) => String(x[lk.valueField] ?? "") === v);
          for (const [tgt, srcField] of Object.entries(lk.autofill)) {
            const val = r ? r[srcField] : undefined;
            patch[tgt] = val == null ? "" : String(val);
          }
        }
        if (onRowPatch) onRowPatch(patch);
        else onChange(v);
      };
      return (
        <WizardLookupField
          lk={lk}
          src={src}
          value={value}
          onPick={pick}
          onCreated={() => setLookupTick((t) => t + 1)}
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
      if (isLast) _onCancel();
      else setActiveIdx((i) => i + 1);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      // ── Chế độ DETAIL-ONLY: không entity cha; tạo/sửa NHIỀU dòng con (vd các
      //    bước quy trình) link tới recordId (vd màu đang chọn) qua linkField. ──
      const detailOnlySteps = !wizardEntityId ? wizardSteps.filter((s) => s.detail) : [];
      if (detailOnlySteps.length > 0) {
        if (!isLast) {
          setActiveIdx((i) => i + 1);
          return;
        }
        if (!editId) {
          setErr("Hãy chọn bản ghi (vd màu sơn) ở danh sách trước khi nhập.");
          setBusy(false);
          return;
        }
        // (SỬA) xoá các dòng cũ người dùng đã bỏ trước khi ghi.
        for (const rid of deletedDetail) await api.deleteRecord(rid);
        let created = 0;
        for (const s of detailOnlySteps) {
          const dc = s.detail;
          if (!dc) continue;
          const dEnt = entities.find((e) => e.id === dc.entity);
          const dFields = dc.fields?.length
            ? (dEnt?.fields ?? []).filter((f) => dc.fields?.includes(f.name))
            : (dEnt?.fields ?? []).filter((f) => f.type !== "formula" && f.type !== "collection");
          for (const r of detailRows[s.id] ?? []) {
            // Dòng "có dữ liệu" = có field NGHIỆP VỤ (bỏ _rid + rowDefaults như is_active)
            // → tránh lưu dòng trống chỉ chứa giá trị mặc định.
            const hasData = Object.entries(r).some(
              ([k, v]) =>
                k !== "_rid" && !(dc.rowDefaults && k in dc.rowDefaults) && (v ?? "").trim() !== "",
            );
            const data = buildRowData(r, dFields);
            if (dc.linkField)
              data[dc.linkField] = coerceLinkValue(editId, dEnt?.fields ?? [], dc.linkField);
            if (dc.computed)
              for (const [tf, factors] of Object.entries(dc.computed))
                data[tf] = computeProduct(r, factors);
            // Dòng cũ (_rid) → update; dòng mới có dữ liệu → create.
            if (r._rid) await api.updateRecord(r._rid, data);
            else if (hasData) {
              await api.createRecord(dc.entity, data);
              created++;
            }
          }
        }
        onDone({ created });
        return;
      }

      // ── Chế độ 1-entity: gom field qua các bước, chỉ LƯU ở bước cuối ──
      if (wizardEntityId) {
        if (!isLast) {
          setActiveIdx((i) => i + 1);
          return;
        }
        const shared = forms[SINGLE_FORM_KEY] ?? {};
        // Field date/datetime: "YYYY-MM-DD" → ISO (đồng nhất định dạng đã lưu).
        const mFields = applyFieldOverrides(
          entities.find((e) => e.id === wizardEntityId)?.fields ?? [],
          fieldOv,
        );
        const typeOf = (k: string) => mFields.find((f) => f.name === k)?.type;
        const payload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(shared)) {
          const t = typeOf(k);
          // Multiselect: form lưu CSV "a,b" → server yêu cầu MẢNG.
          if (t === "multiselect" || t === "multienum" || t === "multilookup") {
            payload[k] = v
              ? v
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [];
            continue;
          }
          // Boolean: "true"/"false" → bool (vd active mặc định khi thêm).
          if (t === "boolean" || t === "bool") {
            payload[k] = v === "true" || v === "1";
            continue;
          }
          if (v === "") continue;
          payload[k] = t === "date" || t === "datetime" ? toIsoDate(v) : v;
        }
        const saved = editId
          ? await api.updateRecord(editId, payload)
          : await api.createRecord(wizardEntityId, payload);

        // Đồng bộ dòng chi tiết cho các bước có cấu hình detail (master-detail).
        // parentKeyField="id" → linkField nhận ID master VỪA TẠO/SỬA (khoá hệ thống,
        // không phải field form) → cho phép gộp tạo cha + con cùng lúc.
        const keyOf = (dc: NonNullable<typeof current.detail>) =>
          dc.parentKeyField === "id"
            ? String(saved.id ?? editId ?? "")
            : (forms[SINGLE_FORM_KEY]?.[dc.parentKeyField] ?? "").trim();
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
            // Dòng "có dữ liệu" = có field NGHIỆP VỤ (bỏ _rid + rowDefaults như is_active)
            // → tránh lưu dòng trống chỉ chứa giá trị mặc định.
            const hasData = Object.entries(r).some(
              ([k, v]) =>
                k !== "_rid" && !(dc.rowDefaults && k in dc.rowDefaults) && (v ?? "").trim() !== "",
            );
            const data = buildRowData(r, dFields);
            // Field được lookup AUTOFILL (vd id_buocson) — không nằm trong dc.fields
            // hiển thị nên buildRowData bỏ qua → copy thủ công để lưu.
            if (dc.fieldLookups)
              for (const lkc of Object.values(dc.fieldLookups))
                for (const tgt of Object.keys(lkc.autofill ?? {}))
                  if (r[tgt] != null && String(r[tgt]) !== "") data[tgt] = r[tgt];
            if (keyVal)
              data[dc.linkField] = coerceLinkValue(keyVal, dEnt?.fields ?? [], dc.linkField);
            // Kế thừa field từ master (vd màu sắc) cho dòng chi tiết.
            if (dc.inherit)
              for (const [tf, mf] of Object.entries(dc.inherit)) {
                const mv = shared[mf];
                if (mv != null && String(mv) !== "") data[tf] = mv;
              }
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

  // Upload ảnh lên server → lưu URL vào form (thay base64).
  const onPickImage = (name: string, file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Chỉ chấp nhận file ảnh");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Ảnh không được vượt quá 10MB");
      return;
    }
    // Preview nhanh base64 local trong khi upload ngầm.
    const reader = new FileReader();
    reader.onload = () => setField(name, String(reader.result));
    reader.readAsDataURL(file);
    setImgUploading((u) => ({ ...u, [name]: true }));
    const fd = new FormData();
    fd.append("file", file);
    fetch("/upload/image", { method: "POST", body: fd })
      .then(async (res) => {
        if (!res.ok) {
          const e = await res.json().catch(() => ({ error: "Upload thất bại" }));
          throw new Error((e as { error?: string }).error ?? "Upload thất bại");
        }
        return res.json() as Promise<{ url: string }>;
      })
      .then(({ url }) => setField(name, url))
      .catch((e: Error) => {
        toast.error(e.message);
        setField(name, ""); // xoá preview nếu upload lỗi
      })
      .finally(() =>
        setImgUploading((u) => {
          const n = { ...u };
          delete n[name];
          return n;
        }),
      );
  };

  // Render 1 control nhập theo kiểu field (combobox lookup / select / bool / longtext / input).
  const renderControl = (f: EntityField) =>
    current.fieldLookups?.[f.name] ? (
      (() => {
        const lk = current.fieldLookups?.[f.name];
        if (!lk) return null;
        const src = detailLookupData[lk.entity] ?? [];
        // Chọn (hoặc vừa tạo) → set field + autofill các field đích từ record nguồn.
        const pick = (v: string, rec?: Record<string, unknown>) => {
          setField(f.name, v);
          if (lk.autofill) {
            const r = rec ?? src.find((x) => String(x[lk.valueField] ?? "") === v);
            for (const [tgt, srcField] of Object.entries(lk.autofill)) {
              const val = r ? r[srcField] : undefined;
              setField(tgt, val == null ? "" : String(val));
            }
          }
        };
        return (
          <WizardLookupField
            lk={lk}
            src={src}
            value={form[f.name] ?? ""}
            onPick={pick}
            onCreated={() => setLookupTick((t) => t + 1)}
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
    ) : f.type === "multiselect" && f.options?.length ? (
      // Chọn nhiều bằng checkbox — lưu CSV "a,b" (vừa khoá string của form).
      (() => {
        const arr = (form[f.name] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        return (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-0.5">
            {f.options?.map((opt) => (
              <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={arr.includes(opt)}
                  onChange={(e) =>
                    setField(
                      f.name,
                      (e.target.checked ? [...arr, opt] : arr.filter((x) => x !== opt)).join(","),
                    )
                  }
                />
                {opt}
              </label>
            ))}
          </div>
        );
      })()
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
    ) : f.type === "file" ? (
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
          <span className="btn btn-default text-xs px-3 py-1.5 shrink-0 whitespace-nowrap">
            Chọn file
          </span>
          <span className="text-xs text-muted truncate min-w-0">
            {form[f.name]
              ? String(form[f.name]).startsWith("data:")
                ? "File đã chọn"
                : (String(form[f.name]).split("/").pop() ?? form[f.name])
              : "Chưa chọn file"}
          </span>
          <input
            type="file"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setField(f.name, String(reader.result));
              reader.readAsDataURL(file);
            }}
          />
        </label>
        {form[f.name] && (
          <button
            type="button"
            className="text-muted hover:text-danger shrink-0"
            onClick={() => setField(f.name, "")}
          >
            <I.X size={14} />
          </button>
        )}
      </div>
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
    );

  // Field ảnh tách sang cột phải (khung lớn); field khác ở cột trái.
  const imgFields = visibleFields.filter((f) => f.type === "image");
  const leftFields = visibleFields.filter((f) => f.type !== "image");

  return (
    <Modal
      open
      onClose={_onCancel}
      title={step.title || "Wizard"}
      width={
        wizardSteps.some((s) => s.detail)
          ? 920
          : imgFields.length > 0 || wizardSteps.some((s) => (s.cols ?? 1) >= 2)
            ? 720
            : 540
      }
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
                                renderDetailCell(
                                  f,
                                  r[f.name] ?? "",
                                  (v) => setRow(i, f.name, v),
                                  (patch) => setRowFields(i, patch),
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
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                {/* Cột trái: các trường nhập (flat hoặc grouped theo sections) */}
                <div className={cn("min-w-0 w-full", imgFields.length > 0 ? "sm:flex-1" : "")}>
                  {current.sections?.length ? (
                    // Chế độ sections: render từng nhóm có header tiêu đề
                    <div className="space-y-3">
                      {current.sections.map((sec) => {
                        const secFields = sec.fields
                          .map((n) => leftFields.find((f) => f.name === n))
                          .filter(Boolean) as typeof leftFields;
                        if (!secFields.length) return null;
                        return (
                          <div key={sec.title}>
                            <div className="text-xs font-semibold bg-panel-2 px-2 py-1.5 rounded-t border-b border-border mb-2">
                              {sec.title}
                            </div>
                            <div
                              className={cn(
                                (current.cols ?? 1) >= 2
                                  ? "grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5"
                                  : "space-y-2.5",
                              )}
                            >
                              {secFields.map((f) => (
                                <div
                                  key={f.id}
                                  className={
                                    (current.cols ?? 1) >= 2 && f.type === "longtext"
                                      ? "col-span-2"
                                      : undefined
                                  }
                                >
                                  <label className="block text-xs font-medium mb-0.5">
                                    {f.label}
                                    {f.required ? (
                                      <span className="text-danger ml-0.5">*</span>
                                    ) : null}
                                  </label>
                                  {renderControl(f)}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    // Chế độ flat (mặc định)
                    <div
                      className={cn(
                        (current.cols ?? 1) >= 2
                          ? "grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5"
                          : "space-y-2.5",
                      )}
                    >
                      {leftFields.map((f) => (
                        <div
                          key={f.id}
                          className={
                            (current.cols ?? 1) >= 2 && f.type === "longtext"
                              ? "col-span-2"
                              : undefined
                          }
                        >
                          <label className="block text-xs font-medium mb-0.5">
                            {f.label}
                            {f.required ? <span className="text-danger ml-0.5">*</span> : null}
                          </label>
                          {renderControl(f)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Cột phải: khung ảnh + upload */}
                {imgFields.length > 0 && (
                  <div className="w-full sm:w-56 sm:shrink-0 space-y-3">
                    {imgFields.map((f) => (
                      <div key={f.id}>
                        <label className="block text-xs font-medium mb-1 flex items-center gap-1">
                          {f.label}
                          {imgUploading[f.name] && (
                            <I.Loader size={10} className="animate-spin text-accent" />
                          )}
                        </label>
                        {form[f.name] ? (
                          // biome-ignore lint/performance/noImgElement: preview ảnh URL/base64 trong modal
                          <img
                            src={form[f.name]}
                            alt=""
                            className={cn(
                              "w-full h-48 object-contain rounded border border-border bg-panel-2",
                              imgUploading[f.name] && "opacity-50",
                            )}
                          />
                        ) : (
                          <div className="w-full h-48 flex items-center justify-center text-xs text-muted border border-dashed border-border rounded">
                            {imgUploading[f.name] ? (
                              <I.Loader size={20} className="animate-spin text-accent" />
                            ) : (
                              "Chưa có ảnh"
                            )}
                          </div>
                        )}
                        {!readOnly && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <span
                                className={cn(
                                  "btn btn-default text-xs px-3 py-1.5 shrink-0",
                                  imgUploading[f.name] && "opacity-50 pointer-events-none",
                                )}
                              >
                                Chọn ảnh
                              </span>
                              <input
                                type="file"
                                accept="image/*"
                                className="sr-only"
                                disabled={!!imgUploading[f.name]}
                                onChange={(e) => onPickImage(f.name, e.target.files?.[0])}
                              />
                            </label>
                            {form[f.name] && !imgUploading[f.name] && (
                              <button
                                type="button"
                                className="text-xs text-danger hover:underline shrink-0"
                                onClick={() => setField(f.name, "")}
                              >
                                Xoá
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
            {/* biome-ignore lint/style/noNonNullAssertion: guard (actions?.length ?? 0) > 0 trên */}
            {current.actions!.map((a) => renderAction(a, a.id))}
          </div>
        )}

        {/* Điều hướng */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button
            variant="ghost"
            onClick={() => {
              if (activeIdx === 0) {
                _onCancel();
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
