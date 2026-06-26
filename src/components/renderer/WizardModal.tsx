/* ==========================================================
   WizardModal — Modal wizard nhập dữ liệu nhiều bước, được
   kích hoạt bởi ActionStep "open-wizard". Mỗi bước có thể
   gắn entity để tạo bản ghi thật; ID được lưu vào pageState
   qua saveOutputTo của từng bước.
   ========================================================== */
import { createApiDataSource } from "@erp-framework/client";
import type { FilterOp } from "@erp-framework/core";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { fileDisplayName } from "@/components/renderer/FilePreviewModal";
import { LookupPicker } from "@/components/renderer/LookupPicker";
import { computeProduct, sumField } from "@/components/renderer/MasterDetailCreateModal";
import { Button, Input, Modal, SearchableSelect } from "@/components/ui";
import { useDropdownPosition } from "@/hooks/useDropdownPosition";
import type { EntityField } from "@/lib/object-types";
import type { PageStateLike } from "@/lib/run-action";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useUserObjects } from "@/stores/userObjects";
import type {
  ActionConfig,
  ActionStepOpenWizard,
  WizardLookupRef,
  WizardRelatedImage,
} from "@/types/page";

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
  // Tìm SERVER-SIDE cho entity lớn (vd tr_material 36k): gõ → query contains.
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Record<string, unknown>[]>([]);
  const [searching, setSearching] = useState(false);

  const labels = lk.labelFields ?? [lk.valueField];
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy lại khi đổi q (debounce); lk ổn định theo cấu hình.
  useEffect(() => {
    if (!lk.serverSearch) return;
    const term = q.trim();
    if (!term) {
      setRemote([]);
      return;
    }
    let alive = true;
    // CHỈ query khi người dùng NGỪNG gõ ~500ms (gõ tiếp → huỷ timer, chưa gọi API).
    // setSearching đặt TRONG timer để lúc đang gõ không hiện "Đang tìm…".
    const handle = setTimeout(() => {
      setSearching(true);
      const sf = lk.searchFields ?? lk.labelFields ?? [lk.valueField];
      Promise.all(
        sf.map((f) =>
          api
            .getRecords(lk.entity, {
              // Gộp filter cố định (vd xoa='N') với điều kiện contains theo field.
              filters: { ...(lk.filters ?? {}), [f]: { op: "contains", value: term } },
              limit: 50,
            })
            .then((res) => res.rows.map((r) => r.data))
            .catch(() => [] as Record<string, unknown>[]),
        ),
      ).then((groups) => {
        if (!alive) return;
        const seen = new Set<string>();
        const merged: Record<string, unknown>[] = [];
        for (const g of groups)
          for (const r of g) {
            const k = String(r[lk.valueField] ?? "");
            if (k && !seen.has(k)) {
              seen.add(k);
              merged.push(r);
            }
          }
        setRemote(merged);
        setSearching(false);
      });
    }, 500);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [q]);

  // Nguồn option: serverSearch → kết quả query; ngược lại → danh sách preload.
  const pool = lk.serverSearch ? remote : src;
  // >=2 label field → hiển thị lookup NHIỀU CỘT (cells + headers) thay vì gộp
  // một chuỗi — khôi phục tính năng lookup đa cột của bản main.
  const multiCol = labels.length >= 2;
  const opts = pool.map((r) => {
    const val = String(r[lk.valueField] ?? "");
    const lbl = labels
      .map((x) => r[x])
      .filter((x) => x != null && String(x) !== "")
      .join(" — ");
    const cells = multiCol ? labels.map((x) => String(r[x] ?? "")) : undefined;
    return cells
      ? { value: val, label: lbl || val, cells, searchText: cells.join(" ") }
      : { value: val, label: lbl || val };
  });
  const ent = entities.find((e) => e.id === lk.entity);
  const srcLabel = ent?.name ?? "mục";
  const headers = multiCol
    ? labels.map((x) => {
        if (x === "code") return "Mã";
        if (x === "name") return "Tên";
        if (x === "masp_nhamay") return "nhà máy";
        if (x === "tensp") return "Tên";
        return ent?.fields.find((field) => field.name === x)?.label ?? x;
      })
    : undefined;
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
              pool.find((r) => String(r[lk.valueField] ?? "") === v),
            )
          }
          options={opts}
          emptyOption={`— chọn ${srcLabel} —`}
          searchPlaceholder={`Tìm ${srcLabel}…`}
          columnHeaders={headers}
          onSearch={lk.serverSearch ? setQ : undefined}
          loading={lk.serverSearch ? searching : undefined}
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

function MultiselectDropdown({
  value,
  onChange,
  options,
  placeholder = "Chọn…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pos = useDropdownPosition(triggerRef, open);

  const [tempSelected, setTempSelected] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      const arr = value
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);
      setTempSelected(arr);
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(tgt) &&
        !panelRef.current?.contains(tgt)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const handleOK = () => {
    onChange(tempSelected.join("/ "));
    setOpen(false);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const toggle = (opt: string) => {
    setTempSelected((prev) =>
      prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt],
    );
  };

  const displayVal = value || placeholder;

  return (
    <div className={cn("relative inline-block w-full", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input flex w-full items-center justify-between gap-2 text-left"
      >
        <span className={cn("min-w-0 truncate", !value && "text-muted")}>{displayVal}</span>
        <I.ChevronDown size={14} className="shrink-0 text-muted" />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: pos.top !== undefined ? pos.top : "auto",
              bottom: pos.bottom !== undefined ? pos.bottom : "auto",
              left: pos.left,
              width: Math.max(pos.width, 240),
            }}
            className="z-[1000] rounded-md border border-border bg-panel shadow-lg flex flex-col overflow-hidden"
          >
            <div className="max-h-60 overflow-y-auto p-2 flex flex-col gap-1.5 bg-panel">
              {options.map((opt) => {
                const checked = tempSelected.includes(opt);
                return (
                  <label
                    key={opt}
                    className="flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer hover:bg-hover/40 rounded transition-colors"
                  >
                    <input
                      type="checkbox"
                      className="accent-accent shrink-0 rounded border-border"
                      checked={checked}
                      onChange={() => toggle(opt)}
                    />
                    <span className="text-text select-none">{opt}</span>
                  </label>
                );
              })}
            </div>
            <div className="border-t border-border flex justify-end gap-2 p-2 bg-panel-2/30">
              <button
                type="button"
                onClick={handleOK}
                className="px-3 py-1 rounded bg-accent text-white hover:bg-accent-2/90 text-xs font-semibold shadow-sm transition-all active:scale-95 min-w-[50px]"
              >
                OK
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-3 py-1 rounded border border-border text-muted hover:bg-hover hover:text-text text-xs font-medium transition-all min-w-[50px]"
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
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
  renderAction?: (
    action: ActionConfig,
    key: string,
    onComplete?: (output?: any) => void,
    customPageState?: PageStateLike,
  ) => ReactNode;
}

/** Khoá form dùng chung cho mọi bước ở chế độ 1-entity (tránh field cùng tên
 *  ở 2 bước ghi đè nhau khi gộp). */
function RelatedImagePanel({
  config,
  parentValue,
}: {
  config: WizardRelatedImage;
  parentValue: string;
}) {
  const entities = useUserObjects((s) => s.entities);
  const [image, setImage] = useState("");

  useEffect(() => {
    if (!parentValue) {
      setImage("");
      return;
    }
    const sourceEntity = entities.find(
      (e) =>
        (config.entity && e.id === config.entity) ||
        (config.entityName && e.name.toLowerCase() === config.entityName.toLowerCase()),
    );
    if (!sourceEntity) {
      setImage("");
      return;
    }
    let alive = true;
    api
      .getRecords(sourceEntity.id, {
        filters: { [config.linkField]: { op: "=", value: parentValue } },
        limit: 1,
      })
      .then((res) => {
        if (!alive) return;
        const data = res.rows[0]?.data as Record<string, unknown> | undefined;
        setImage(String(data?.[config.imageField] ?? ""));
      })
      .catch(() => {
        if (alive) setImage("");
      });
    return () => {
      alive = false;
    };
  }, [config, entities, parentValue]);

  const src = image.startsWith("wwwroot/") ? `/${image.slice(8)}` : image;
  return (
    <div>
      <label className="block text-xs font-medium mb-1">{config.label ?? "Hình ảnh"}</label>
      {src ? (
        <img
          src={src}
          alt=""
          className="w-full h-48 object-contain rounded border border-border bg-panel-2"
        />
      ) : (
        <div className="w-full h-48 flex items-center justify-center text-xs text-muted border border-dashed border-border rounded">
          Chưa có ảnh
        </div>
      )}
    </div>
  );
}

const SINGLE_FORM_KEY = "__wizard_single__";

export function WizardModal({ step, pageState, recordId, onDone, onCancel, renderAction }: Props) {
  const entities = useUserObjects((s) => s.entities);
  const wizardSteps = step.steps ?? [];
  // Chế độ 1-entity: mọi bước thao tác cùng step.entity (gom field theo bước).
  const wizardEntityId = step.entity;

  // Gom fieldOverrides của mọi bước — cấu hình field nhúng trong page (đổi kiểu/
  // nhãn/options) để form đi theo page sync mà khỏi chạm entity trên DB.
  const fieldOv = Object.assign({}, ...wizardSteps.map((s) => s.fieldOverrides ?? {})) as Record<
    string,
    { type?: string; label?: string; options?: string[]; required?: boolean }
  >;
  const hasImageInAnyStep = useMemo(() => {
    return wizardSteps.some((s) => {
      const stepEntId = wizardEntityId ?? s.entity;
      const stepEnt = stepEntId ? entities.find((e) => e.id === stepEntId) : undefined;
      const fieldsInStep = s.fields ?? [];
      const hasImg = fieldsInStep.some((fName) => {
        const f = stepEnt?.fields.find((field) => field.name === fName);
        return f?.type === "image" || fName === "hinhanh";
      });
      return hasImg || !!s.relatedImage;
    });
  }, [wizardSteps, wizardEntityId, entities]);

  const editId = recordId == null || recordId === "" ? null : String(recordId);
  const readOnly = step.readOnly === true;
  // User đăng nhập — cho token $currentUser trong defaults (vd nguoitao).
  const authUser = useAuth((s) => s.user);

  const [activeIdx, setActiveIdx] = useState(0);
  const current = wizardSteps[Math.min(activeIdx, wizardSteps.length - 1)];

  // Tạo mới (không recordId) + có defaults → điền sẵn giá trị mặc định.
  const [forms, setForms] = useState<Record<string, Record<string, string>>>(() => {
    const init: Record<string, Record<string, string>> = {};
    if (wizardEntityId && !editId && step.defaults) {
      // Nội suy {{stateKey}} trong defaults từ pageState — cho phép set khoá cha
      // động khi tạo bản ghi con (vd id_phienban = {{selPhienBan}} của dòng đang chọn).
      // Hỗ trợ token: $now = giờ hiện tại (ISO), $currentUser = tên/email user.
      const resolved: Record<string, string> = {};
      for (const [k, v] of Object.entries(step.defaults)) {
        if (v === "$now") {
          resolved[k] = new Date().toISOString();
        } else if (v === "$currentUser") {
          resolved[k] = authUser?.name ?? authUser?.email ?? "";
        } else {
          resolved[k] =
            typeof v === "string"
              ? v.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
                  const got = pageState.get(key);
                  return got == null ? "" : String(got);
                })
              : v;
        }
      }
      init[SINGLE_FORM_KEY] = resolved;
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset lỗi mỗi khi đổi bước, chỉ cần activeIdx
  useEffect(() => {
    setFieldErrors({});
  }, [activeIdx]);
  const [collected, setCollected] = useState<Record<string, unknown>>({});

  const formKey = wizardEntityId ? SINGLE_FORM_KEY : (current?.id ?? "");
  const setField = useCallback(
    (k: string, v: string) => {
      setForms((prev) => ({ ...prev, [formKey]: { ...(prev[formKey] ?? {}), [k]: v } }));
      setFieldErrors((prev) => {
        if (!prev[k]) return prev;
        const next = { ...prev };
        delete next[k];
        return next;
      });
    },
    [formKey],
  );
  // Dòng nhập của các bước lưới chi tiết (theo step.id).
  const [detailRows, setDetailRows] = useState<Record<string, Record<string, string>[]>>({});
  // Record nguồn cho field-lookup trong lưới chi tiết (theo entityId).
  const [detailLookupData, setDetailLookupData] = useState<
    Record<string, Record<string, unknown>[]>
  >({});
  const [lookupReloadKey, setLookupReloadKey] = useState(0);
  // (SỬA) id các dòng chi tiết cũ bị xoá → deleteRecord khi lưu.
  const [deletedDetail, setDeletedDetail] = useState<string[]>([]);
  const [imgUploading, setImgUploading] = useState<Record<string, boolean>>({});
  // Tên file gốc lưu sau khi upload thành công — tránh phụ thuộc decode token client-side.
  const [fileDisplayNames, setFileDisplayNames] = useState<Record<string, string>>({});
  // Escape giả từ native file dialog được nuốt ở useFocusTrap (theo vòng đời dialog).
  const _onCancel = onCancel;
  // Tăng để buộc nạp lại danh sách lookup (vd sau khi tạo nhanh bản ghi mới qua nút +).
  const [lookupTick, setLookupTick] = useState(0);

  const activeEntity = wizardEntityId ? entities.find((e) => e.id === wizardEntityId) : undefined;
  const isProductEntity =
    wizardEntityId === "b71515cf-4a57-4eed-a1f5-9275d7781c72" ||
    activeEntity?.techName === "tr_sanpham" ||
    activeEntity?.name === "tr_sanpham";
  const isColorEntity = activeEntity?.techName === "tr_color" || activeEntity?.name === "tr_color";

  // Lấy các giá trị hiện tại để tính masp và mahtr (cho entity tr_sanpham)
  const formValues = wizardEntityId
    ? (forms[SINGLE_FORM_KEY] ?? {})
    : Object.assign({}, ...Object.values(forms));

  const wrappedPageState = useMemo(() => {
    return {
      get: (key: string) => {
        if (key.startsWith("form.")) {
          const fieldPath = key.slice(5);
          if (fieldPath.endsWith("_id")) {
            const baseKey = fieldPath.slice(0, -3);
            const val = formValues[baseKey];
            if (val) {
              const lk = current?.fieldLookups?.[baseKey];
              if (lk) {
                const src = detailLookupData[lk.entity] ?? [];
                const rec = src.find((r) => String(r[lk.valueField] ?? "") === val);
                if (rec) return rec.id;
              }
            }
          }
          return formValues[fieldPath] ?? "";
        }
        return pageState.get(key);
      },
      set: (key: string, value: unknown) => {
        if (key.startsWith("form.")) {
          setField(key.slice(5), String(value));
        } else {
          pageState.set(key, value);
        }
      },
      values: {
        ...pageState.values,
        ...Object.fromEntries(Object.entries(formValues).map(([k, v]) => [`form.${k}`, v])),
      },
    };
  }, [pageState, formValues, current?.fieldLookups, detailLookupData, setField]);

  const masp_nhamay = String(formValues.masp_nhamay ?? "").trim();
  const mausac = String(formValues.mausac ?? "").trim();
  const customer = String(formValues.customer ?? "").trim();
  const bemat_sanpham = String(formValues.bemat_sanpham ?? "").trim();

  // Find customer_id from lookup records metadata if available
  const customerLookupEntityId =
    wizardSteps
      .flatMap((s) => (s.fieldLookups ? Object.entries(s.fieldLookups) : []))
      .find(([field]) => field === "customer")?.[1]?.entity ||
    "5c138697-6875-40e5-b9fd-3451e241de0d";
  const customerRecords = detailLookupData[customerLookupEntityId] || [];
  const customerObj = customerRecords.find(
    (r) =>
      String(r.customer_name ?? "")
        .trim()
        .toLowerCase() === customer.toLowerCase(),
  );
  const customerCode = customerObj ? String(customerObj.customer_id ?? "").trim() : customer;

  const computedMasp =
    masp_nhamay || mausac || customerCode ? `${masp_nhamay}_${mausac}_${customerCode}` : "";

  const bematRecords = detailLookupData["8b34e2ab-8e01-443b-ba21-4f9e8a01cb23"] || [];

  let bematList: string[] = [];
  try {
    const parsed = bemat_sanpham ? JSON.parse(bemat_sanpham) : [];
    bematList = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    bematList = bemat_sanpham
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const surfaceCodes = bematList
    .map((s) => {
      const found = bematRecords.find(
        (r) =>
          String(r.name ?? "")
            .trim()
            .toLowerCase() === s.toLowerCase() ||
          String(r.code ?? "")
            .trim()
            .toLowerCase() === s.toLowerCase(),
      );
      if (found && found.code) {
        return String(found.code).trim();
      }
      return s
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase())
        .join("");
    })
    .join("/");

  const computedMahtr = masp_nhamay ? `W${masp_nhamay}_${surfaceCodes}` : "";

  // Nạp record nguồn cho mọi field-lookup: field master (combobox) + lưới detail.
  // Mỗi entity preload theo `filters` + `preloadLimit` riêng (vd tr_material chỉ
  // lấy xoa='N', limit cao để hiện hết) — dedupe theo entity (ref đầu tiên thắng).
  const lookupSpec = (() => {
    const byEntity = new Map<
      string,
      { entity: string; filters: unknown; limit: number; pageSize: number }
    >();
    for (const s of wizardSteps)
      for (const l of [
        ...(s.fieldLookups ? Object.values(s.fieldLookups) : []),
        ...(s.detail?.fieldLookups ? Object.values(s.detail.fieldLookups) : []),
      ]) {
        // serverSearch → KHÔNG preload (combobox tự query khi gõ) — tránh tải thừa.
        if (l.serverSearch) continue;
        if (!byEntity.has(l.entity))
          byEntity.set(l.entity, {
            entity: l.entity,
            filters: l.filters ?? null,
            limit: l.preloadLimit ?? 2000,
            pageSize: l.preloadPageSize ?? 500,
          });
      }
    return [...byEntity.values()];
  })();
  const lookupRequestKey = lookupSpec.length
    ? `${JSON.stringify(lookupSpec)}|${lookupReloadKey}`
    : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: lookupTick là TRIGGER chủ ý — nút "+" tạo nhanh gọi setLookupTick để nạp lại danh sách lookup; effect body không tham chiếu trực tiếp.
  useEffect(() => {
    if (!lookupRequestKey) return;
    const spec = JSON.parse(lookupRequestKey.split("|")[0] ?? "[]") as Array<{
      entity: string;
      filters: Record<string, { op: FilterOp; value: unknown }> | null;
      limit: number;
      pageSize: number;
    }>;
    let alive = true;
    // Preload LŨY TIẾN: nạp từng trang `pageSize` (mặc định 500, trần records.list
    // 10.000/req) rồi APPEND ngay vào state → combobox dùng được sau trang đầu, các
    // trang sau chạy nền cho tới khi đủ `limit` hoặc hết dữ liệu.
    const loadProgressive = async (
      entity: string,
      filters: Record<string, { op: FilterOp; value: unknown }> | undefined,
      total: number,
      pageSize: number,
    ): Promise<void> => {
      const PAGE = Math.min(Math.max(pageSize, 1), 10_000);
      const acc: Record<string, unknown>[] = [];
      let offset = 0;
      while (acc.length < total) {
        const size = Math.min(PAGE, total - acc.length);
        let rows: Record<string, unknown>[];
        try {
          const res = await api.getRecords(entity, { filters, limit: size, offset });
          rows = res.rows.map((r) => r.data);
        } catch {
          break;
        }
        if (!alive) return;
        acc.push(...rows);
        // Append vào state (copy mảng để React nhận thay đổi).
        const snapshot = [...acc];
        setDetailLookupData((prev) => ({ ...prev, [entity]: snapshot }));
        if (rows.length < size) break;
        offset += size;
      }
    };
    for (const le of spec) {
      // Khởi tạo rỗng để combobox không kẹt giá trị cũ khi đổi cấu hình.
      setDetailLookupData((prev) => (prev[le.entity] ? prev : { ...prev, [le.entity]: [] }));
      void loadProgressive(le.entity, le.filters ?? undefined, le.limit, le.pageSize);
    }
    return () => {
      alive = false;
    };
  }, [lookupRequestKey, lookupTick]);

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

  if (!current) return null;

  // 1-entity mode: mọi bước dùng wizardEntityId; else: entity riêng từng bước.
  const stepEntityId = wizardEntityId ?? current.entity;
  const ent = stepEntityId ? entities.find((e) => e.id === stepEntityId) : undefined;
  // Map theo current.fields để GIỮ ĐÚNG THỨ TỰ cấu hình (filter sẽ giữ thứ tự
  // entity gốc → sai vị trí ô nhập). Không có → toàn bộ field entity.
  const entFields = applyFieldOverrides(ent?.fields ?? [], fieldOv);
  // hiddenFields: vẫn trong `fields` (để lưu qua defaults) nhưng ẩn khỏi form.
  const stepHidden = new Set(current.hiddenFields ?? []);
  const visibleFields = (
    current.fields?.length
      ? (current.fields
          .map((n) => entFields.find((f) => f.name === n))
          .filter(Boolean) as EntityField[])
      : entFields
  ).filter((f) => !stepHidden.has(f.name));
  // 1-entity → form dùng chung 1 khoá cho mọi bước; else → form riêng theo step.id.
  const form = forms[formKey] ?? {};
  const isLast = activeIdx === wizardSteps.length - 1;
  const relatedImageCfg = current.relatedImage;
  const relatedParentValue = relatedImageCfg
    ? String(form[relatedImageCfg.parentField] ?? "").trim()
    : "";

  // ── Bước lưới chi tiết (master-detail) ──
  const detailCfg = current.detail;
  const detailEnt = detailCfg ? entities.find((e) => e.id === detailCfg.entity) : undefined;
  // Cột HIỂN THỊ của lưới: loại field trong hiddenFields (vd soluong mặc định 1 —
  // vẫn LƯU qua dc.fields ở bước save, chỉ ẩn khỏi lưới).
  const detailHidden = new Set(detailCfg?.hiddenFields ?? []);
  const detailFields: EntityField[] = detailCfg
    ? (detailCfg.fields?.length
        ? (detailEnt?.fields ?? []).filter((f) => detailCfg.fields?.includes(f.name))
        : (detailEnt?.fields ?? []).filter((f) => f.type !== "formula" && f.type !== "collection")
      ).filter((f) => !detailHidden.has(f.name))
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
    if (readOnly) {
      if (lk) {
        const src = detailLookupData[lk.entity] ?? [];
        const labels = lk.labelFields ?? [lk.valueField];
        const selectedRec = src.find((r) => String(r[lk.valueField] ?? "") === String(value));
        const displayVal = selectedRec
          ? labels
              .map((x) => selectedRec[x])
              .filter((x) => x != null && String(x) !== "")
              .join(" — ")
          : String(value);
        return (
          <div className="px-2 py-1 text-sm text-fg truncate select-text">{displayVal || ""}</div>
        );
      }
      if (f.type === "boolean" || f.type === "bool") {
        return (
          <input
            type="checkbox"
            className="accent-accent pointer-events-none"
            checked={value === "true"}
            readOnly
          />
        );
      }
      if (f.options && f.options.length > 0) {
        return <div className="px-2 py-1 text-sm text-fg truncate select-text">{value || ""}</div>;
      }
      return <div className="px-2 py-1 text-sm text-fg truncate select-text">{value || ""}</div>;
    }

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
          emptyOption="chọn"
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
      // Ràng buộc bắt buộc (required) ở cấp độ step hiện tại
      if (ent && !current.detail) {
        const errors: Record<string, string> = {};
        for (const f of visibleFields) {
          if (f.required) {
            const val = form[f.name];
            if (val == null || String(val).trim() === "") {
              errors[f.name] = `Trường "${f.label || f.name}" là bắt buộc nhập.`;
            }
          }
        }
        if (Object.keys(errors).length > 0) {
          setFieldErrors(errors);
          throw new Error("Vui lòng điền đầy đủ các trường bắt buộc.");
        }
      }

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
        const editableFieldNames = new Set(
          wizardSteps.flatMap((wizardStep) =>
            wizardStep.sections?.length
              ? wizardStep.sections.flatMap((section) => section.fields)
              : (wizardStep.fields ?? []),
          ),
        );
        if (isColorEntity) {
          if (editableFieldNames.has("duongdan")) editableFieldNames.add("tenfile");
          if (editableFieldNames.has("duongdan2")) editableFieldNames.add("tenfile2");
        }
        // Khi KHÔNG có step nào khai báo fields tường minh (editableFieldNames rỗng),
        // bỏ filter — lưu tất cả field có giá trị. Tránh payload rỗng khi wizard
        // dùng fallback "hiện 7 field đầu" mà không liệt kê field.
        const hasExplicitFields = editableFieldNames.size > 0;
        const payload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(shared)) {
          if (hasExplicitFields && !editableFieldNames.has(k)) continue;
          const t = typeOf(k);
          // Multiselect: form lưu CSV "a,b" → server yêu cầu MẢNG.
          if (t === "multiselect" || t === "multienum" || t === "multilookup") {
            if (k === "bemat_sanpham") {
              payload[k] = v; // Gửi nguyên chuỗi "Trơn láng/ Giả cổ/ Da" cho DB text column
            } else {
              payload[k] = v
                ? v
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [];
            }
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

        // Tự động gán mã sản phẩm nếu entity là tr_sanpham
        if (
          ent?.techName === "tr_sanpham" ||
          ent?.name === "tr_sanpham" ||
          wizardEntityId === "b71515cf-4a57-4eed-a1f5-9275d7781c72"
        ) {
          payload.masp = computedMasp;
          payload.ma_btp = computedMahtr;
        }

        // Kiểm tra trùng lặp cho khách hàng hoặc ngân hàng khi tạo mới
        if (!editId) {
          if (ent?.techName === "tr_khachhang") {
            const customerIdVal = String(payload.customer_id ?? "").trim();
            if (customerIdVal) {
              const dupIdRes = await api.getRecords(wizardEntityId, {
                filters: { customer_id: { op: "=", value: customerIdVal } },
                limit: 1,
              });
              if (dupIdRes.rows.length > 0) {
                setFieldErrors((prev) => ({ ...prev, customer_id: "Mã khách hàng đã tồn tại" }));
                throw new Error("Mã khách hàng đã tồn tại");
              }
            }
            const customerNameVal = String(payload.customer_name ?? "").trim();
            if (customerNameVal) {
              const dupNameRes = await api.getRecords(wizardEntityId, {
                filters: { customer_name: { op: "=", value: customerNameVal } },
                limit: 1,
              });
              if (dupNameRes.rows.length > 0) {
                setFieldErrors((prev) => ({ ...prev, customer_name: "Tên khách hàng đã tồn tại" }));
                throw new Error("Tên khách hàng đã tồn tại");
              }
            }
          } else if (ent?.techName === "tr_nganhang") {
            const nameVal = String(payload.name ?? "").trim();
            if (nameVal) {
              const dupName = await api.getRecords(wizardEntityId, {
                filters: { name: { op: "=", value: nameVal } },
                limit: 1,
              });
              if (dupName.rows.length > 0) {
                setFieldErrors((prev) => ({ ...prev, name: "Tên ngân hàng đã tồn tại" }));
                throw new Error("Tên ngân hàng đã tồn tại");
              }
            }
            const abbrVal = String(payload.abbr_name ?? "").trim();
            if (abbrVal) {
              const dupAbbr = await api.getRecords(wizardEntityId, {
                filters: { abbr_name: { op: "=", value: abbrVal } },
                limit: 1,
              });
              if (dupAbbr.rows.length > 0) {
                setFieldErrors((prev) => ({ ...prev, abbr_name: "Tên viết tắt đã tồn tại" }));
                throw new Error("Tên viết tắt đã tồn tại");
              }
            }
          } else if (ent?.techName === "tr_color") {
            const codeVal = String(payload.code ?? "").trim();
            if (codeVal) {
              const dupCode = await api.getRecords(wizardEntityId, {
                filters: { code: { op: "=", value: codeVal } },
                limit: 1,
              });
              if (dupCode.rows.length > 0) {
                setFieldErrors((prev) => ({ ...prev, code: "Mã màu đã tồn tại" }));
                throw new Error("Mã màu đã tồn tại");
              }
            }
          } else if (ent?.techName === "tr_hehang") {
            const tenhhVal = String(payload.tenhh ?? "").trim();
            if (tenhhVal) {
              const dupTen = await api.getRecords(wizardEntityId, {
                filters: { tenhh: { op: "=", value: tenhhVal } },
                limit: 1,
              });
              if (dupTen.rows.length > 0) {
                setFieldErrors((prev) => ({ ...prev, tenhh: "Tên hệ hàng đã tồn tại" }));
                throw new Error("Tên hệ hàng đã tồn tại");
              }
            }
          } else if (ent?.techName === "tr_sanpham_nhamay") {
            const maspNhamayVal = String(payload.masp_nhamay ?? "").trim();
            if (maspNhamayVal) {
              const dupMasp = await api.getRecords(wizardEntityId, {
                filters: { masp_nhamay: { op: "=", value: maspNhamayVal } },
                limit: 1,
              });
              if (dupMasp.rows.length > 0) {
                setFieldErrors((prev) => ({ ...prev, masp_nhamay: "Mã nhà máy đã tồn tại" }));
                throw new Error("Mã nhà máy đã tồn tại");
              }
            }
          } else if (ent?.techName === "tr_bemat") {
            const codeVal = String(payload.code ?? "").trim();
            if (codeVal) {
              const dupCode = await api.getRecords(wizardEntityId, {
                filters: { code: { op: "=", value: codeVal } },
                limit: 1,
              });
              if (dupCode.rows.length > 0) {
                setFieldErrors((prev) => ({ ...prev, code: "Mã bề mặt đã tồn tại" }));
                throw new Error("Mã bề mặt đã tồn tại");
              }
            }
          }
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
    const sub =
      ent?.techName === "tr_color" || ent?.name === "tr_color"
        ? "mau-sac"
        : ent?.techName === "tr_sanpham" || ent?.name === "tr_sanpham"
          ? "san-pham"
          : "";
    const url = sub ? `/upload/image?subfolder=${sub}` : "/upload/image";
    fetch(url, { method: "POST", body: fd })
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

  // Upload file đính kèm lên server → lưu URL vào form (thay base64).
  const onPickFile = (name: string, file: File | undefined) => {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error("File không được vượt quá 25MB");
      return;
    }
    setImgUploading((u) => ({ ...u, [name]: true }));
    const fd = new FormData();
    fd.append("file", file);
    const sub = ent?.techName === "tr_color" || ent?.name === "tr_color" ? "mau-sac" : "";
    const url = sub ? `/upload/file?subfolder=${sub}` : "/upload/file";
    fetch(url, { method: "POST", body: fd })
      .then(async (res) => {
        if (!res.ok) {
          const e = await res.json().catch(() => ({ error: "Upload thất bại" }));
          throw new Error((e as { error?: string }).error ?? "Upload thất bại");
        }
        return res.json() as Promise<{ url: string; name?: string }>;
      })
      .then(({ url, name: displayName }) => {
        setField(name, url);
        if (displayName) {
          setFileDisplayNames((m) => ({ ...m, [name]: displayName }));
          if (name === "duongdan") {
            setField("tenfile", displayName);
          } else if (name === "duongdan2") {
            setField("tenfile2", displayName);
          }
        }
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() =>
        setImgUploading((u) => {
          const n = { ...u };
          delete n[name];
          return n;
        }),
      );
  };

  // Render 1 control nhập theo kiểu field (combobox lookup / select / bool / longtext / input).
  const renderControl = (f: EntityField) => {
    if (readOnly) {
      if (current.fieldLookups?.[f.name]) {
        const lk = current.fieldLookups[f.name];
        if (!lk) return null;
        const src = detailLookupData[lk.entity] ?? [];
        const labels = lk.labelFields ?? [lk.valueField];
        const selectedRec = src.find(
          (r) => String(r[lk.valueField] ?? "") === String(form[f.name] ?? ""),
        );
        const displayVal = selectedRec
          ? labels
              .map((x) => selectedRec[x])
              .filter((x) => x != null && String(x) !== "")
              .join(" — ")
          : String(form[f.name] ?? "");
        return (
          <div className="w-full min-h-[30px] flex items-center px-3 py-1 bg-panel-2/30 border border-border/40 rounded text-fg select-text text-sm min-w-0">
            {displayVal || ""}
          </div>
        );
      }
      if (
        (f.type === "lookup" || f.type === "multi-lookup") &&
        (f.ref || (f as { relationEntityId?: string }).relationEntityId)
      ) {
        return (
          <LookupPicker
            refEntityId={f.ref || (f as { relationEntityId?: string }).relationEntityId || ""}
            value={form[f.name] ?? ""}
            valueField={f.refValueField}
            onChange={(v) => setField(f.name, v)}
            multi={f.type === "multi-lookup"}
            readOnly={readOnly}
            reloadKey={lookupReloadKey}
          />
        );
      }
      if (f.type === "multiselect" && f.options?.length) {
        const arr = (form[f.name] ?? "")
          .split(f.name === "bemat_sanpham" ? "/" : ",")
          .map((s) => s.trim())
          .filter(Boolean);
        return (
          <div className="flex flex-wrap gap-1.5 p-1 border border-border/40 rounded bg-panel-2/30 min-h-[30px] items-center">
            {arr.map((opt) => (
              <span key={opt} className="chip chip-accent text-xs">
                {opt}
              </span>
            ))}
          </div>
        );
      }
      if (f.type === "select" && f.options?.length) {
        const displayVal = String(form[f.name] ?? "");
        return (
          <div className="w-full min-h-[30px] flex items-center px-3 py-1 bg-panel-2/30 border border-border/40 rounded text-fg select-text text-sm min-w-0">
            {displayVal || ""}
          </div>
        );
      }
      if (f.type === "boolean") {
        return (
          <label className="flex items-center gap-2 text-sm mt-0.5 pointer-events-none select-none">
            <input
              type="checkbox"
              className="accent-accent"
              checked={form[f.name] === "true"}
              readOnly
            />
            <span>{f.label}</span>
          </label>
        );
      }
      if (f.type === "longtext") {
        return (
          <div className="w-full min-h-[72px] bg-panel-2/30 border border-border/40 rounded px-3 py-2 text-fg text-sm whitespace-pre-wrap select-text leading-relaxed">
            {form[f.name] ? String(form[f.name]) : ""}
          </div>
        );
      }
      if (f.type === "file") {
        const v = form[f.name] ? String(form[f.name]) : "";
        if (!v) {
          return (
            <div className="w-full min-h-[30px] bg-panel-2/30 border border-border/40 rounded" />
          );
        }
        const last = v.split("/").pop() ?? v;
        const displayName = last.includes("__") ? last.slice(last.indexOf("__") + 2) : last;
        return (
          <div className="w-full min-h-[30px] flex items-center gap-2 px-3 py-1 bg-panel-2/30 border border-border/40 rounded text-sm">
            <span className="text-fg truncate min-w-0 flex-1">{displayName}</span>
            {!String(v).startsWith("data:") && (
              <a
                href={v}
                target="_blank"
                rel="noreferrer"
                className="text-muted hover:text-accent shrink-0 p-1 hover:bg-hover rounded"
                title="Tải / mở file"
              >
                <I.Download size={14} />
              </a>
            )}
          </div>
        );
      }
      const displayVal = String(form[f.name] ?? "");
      return (
        <div className="w-full min-h-[30px] flex items-center px-3 py-1 bg-panel-2/30 border border-border/40 rounded text-fg select-text text-sm min-w-0">
          {displayVal || ""}
        </div>
      );
    }

    return current.fieldLookups?.[f.name] ? (
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
    ) : (f.type === "lookup" || f.type === "multi-lookup") &&
      (f.ref || (f as { relationEntityId?: string }).relationEntityId) ? (
      <LookupPicker
        refEntityId={f.ref || (f as { relationEntityId?: string }).relationEntityId || ""}
        value={form[f.name] ?? ""}
        valueField={f.refValueField}
        onChange={(v) => setField(f.name, v)}
        multi={f.type === "multi-lookup"}
        reloadKey={lookupReloadKey}
      />
    ) : f.type === "multiselect" && f.options?.length ? (
      <MultiselectDropdown
        value={form[f.name] ?? ""}
        onChange={(v) => setField(f.name, v)}
        options={f.options}
        placeholder={`Chọn ${f.label ?? "các mục"}…`}
      />
    ) : f.type === "select" && f.options?.length ? (
      <SearchableSelect
        className="w-full"
        value={form[f.name] ?? ""}
        onChange={(v) => setField(f.name, v)}
        options={f.options.map((o) => ({ value: o, label: o }))}
        emptyOption="chọn"
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
            {imgUploading[f.name] ? "Đang tải…" : "Chọn file"}
          </span>
          <span className="text-xs text-muted truncate min-w-0">
            {(() => {
              const v = form[f.name] ? String(form[f.name]) : "";
              if (!v) return "Chưa chọn file";
              if (v.startsWith("data:")) return "File đã chọn";
              // Ưu tiên tên lưu từ upload response; fallback decode token
              return fileDisplayNames[f.name] ?? fileDisplayName(v);
            })()}
          </span>
          <input
            type="file"
            className="sr-only"
            disabled={!!imgUploading[f.name]}
            onChange={(e) => onPickFile(f.name, e.target.files?.[0])}
          />
        </label>
        {form[f.name] && !imgUploading[f.name] && !String(form[f.name]).startsWith("data:") && (
          <a
            href={String(form[f.name])}
            target="_blank"
            rel="noreferrer"
            className="text-muted hover:text-accent shrink-0"
            title="Tải / mở file"
          >
            <I.Download size={14} />
          </a>
        )}
        {form[f.name] && !imgUploading[f.name] && (
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
  };

  // Field ảnh tách sang cột phải (khung lớn); field khác ở cột trái.
  const imgFields = visibleFields.filter((f) => f.type === "image" || f.name === "hinhanh");
  const leftFields = visibleFields.filter((f) => f.type !== "image" && f.name !== "hinhanh");
  const hasImagePanel = imgFields.length > 0 || !!relatedImageCfg;

  const renderFieldInput = (f: EntityField) => {
    const renderFieldAction = !readOnly ? renderAction : undefined;
    const actions = current.fieldActions?.[f.name] ?? [];
    if (!renderFieldAction || actions.length === 0) return renderControl(f);
    return (
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">{renderControl(f)}</div>
        <div className="shrink-0 flex items-center gap-1">
          {actions.map((a) =>
            renderFieldAction(
              { ...a, iconOnly: a.iconOnly ?? true },
              a.id,
              (output) => {
                setLookupReloadKey((x) => x + 1);
                if (output && typeof output === "object") {
                  const lk = current.fieldLookups?.[f.name];
                  if (lk) {
                    const val = output[lk.valueField] ?? output.id;
                    if (val != null) {
                      if (f.type === "multi-lookup") {
                        let selected: string[] = [];
                        const currentVal = form[f.name];
                        try {
                          const parsed = currentVal ? JSON.parse(String(currentVal)) : [];
                          selected = Array.isArray(parsed) ? parsed.map(String) : [];
                        } catch {
                          selected = currentVal ? [String(currentVal)] : [];
                        }
                        if (!selected.includes(String(val))) {
                          const next = [...selected, String(val)];
                          setField(f.name, JSON.stringify(next));
                        }
                      } else {
                        setField(f.name, String(val));
                        if (lk.autofill) {
                          for (const [tgt, srcField] of Object.entries(lk.autofill)) {
                            const val = output[srcField];
                            setField(tgt, val == null ? "" : String(val));
                          }
                        }
                      }
                    }
                  }
                }
              },
              wrappedPageState,
            ),
          )}
        </div>
      </div>
    );
  };

  return (
    <Modal
      open
      onClose={_onCancel}
      title={step.title || "Wizard"}
      width={
        wizardSteps.some((s) => s.detail) || wizardSteps.some((s) => s.cols === 4)
          ? 920
          : hasImageInAnyStep || wizardSteps.some((s) => (s.cols ?? 1) >= 2)
            ? 720
            : 540
      }
      footer={
        <div className="flex items-center justify-between w-full">
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

        {/* Tiêu đề & Mã computed cho Sản phẩm */}
        {isProductEntity && (
          <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-2">
            <div className="flex items-center gap-1.5 text-muted text-xs font-medium">
              {activeIdx > 0 ? (
                <button
                  type="button"
                  className="hover:text-accent flex items-center gap-1 transition-colors"
                  onClick={() => {
                    setErr("");
                    setActiveIdx((i) => i - 1);
                  }}
                >
                  <I.ChevronLeft size={14} />
                  Quay lại bước trước
                </button>
              ) : (
                <span className="flex items-center gap-1.5">
                  <I.Info size={14} />
                  Cập nhật thông tin sản phẩm
                </span>
              )}
            </div>
            <div className="flex gap-6 text-right text-xs shrink-0">
              <div className="min-w-[100px] whitespace-nowrap">
                <span className="text-muted font-medium block text-[10px] uppercase tracking-wider mb-0.5">
                  Mã sản phẩm
                </span>
                <span className="font-semibold text-fg tabular-nums whitespace-nowrap">
                  {computedMasp || "—"}
                </span>
              </div>
              <div className="min-w-[120px] whitespace-nowrap">
                <span className="text-muted font-medium block text-[10px] uppercase tracking-wider mb-0.5">
                  Mã hàng trắng
                </span>
                <span className="font-semibold text-fg tabular-nums whitespace-nowrap">
                  {computedMahtr || "—"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Nội dung bước */}
        <div
          className={cn(
            "space-y-3",
            isProductEntity
              ? "h-[400px] overflow-y-auto pr-1"
              : current.cols === 4
                ? "min-h-[490px]"
                : "min-h-[140px]",
            readOnly && "opacity-95",
          )}
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
                <div className={cn("min-w-0 w-full", hasImagePanel ? "sm:flex-1" : "")}>
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
                                current.cols === 4
                                  ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2.5"
                                  : (current.cols ?? 1) >= 2
                                    ? "grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5"
                                    : "space-y-2.5",
                              )}
                            >
                              {secFields.map((f) => (
                                <div
                                  key={f.id}
                                  className={(() => {
                                    if (current.cols === 4) {
                                      const span =
                                        (f as any).colSpan ?? (f.type === "longtext" ? 4 : 2);
                                      if (span === 4)
                                        return "col-span-1 sm:col-span-2 md:col-span-4";
                                      if (span === 3)
                                        return "col-span-1 sm:col-span-2 md:col-span-3";
                                      if (span === 2) return "col-span-1 sm:col-span-2";
                                      return "col-span-1";
                                    }
                                    return (current.cols ?? 1) >= 2 && f.type === "longtext"
                                      ? "col-span-2"
                                      : undefined;
                                  })()}
                                >
                                  <label className="block text-xs font-medium mb-0.5">
                                    {f.label}
                                    {!readOnly && f.required ? (
                                      <span className="text-danger ml-0.5">*</span>
                                    ) : null}
                                  </label>
                                  {renderFieldInput(f)}
                                  {!readOnly && fieldErrors[f.name] && (
                                    <span className="text-[10px] font-medium text-danger mt-1 block">
                                      {fieldErrors[f.name]}
                                    </span>
                                  )}
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
                        current.cols === 4
                          ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2.5"
                          : (current.cols ?? 1) >= 2
                            ? "grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5"
                            : "space-y-2.5",
                      )}
                    >
                      {leftFields.map((f) => (
                        <div
                          key={f.id}
                          className={(() => {
                            if (current.cols === 4) {
                              const span = (f as any).colSpan ?? (f.type === "longtext" ? 4 : 2);
                              if (span === 4) return "col-span-1 sm:col-span-2 md:col-span-4";
                              if (span === 3) return "col-span-1 sm:col-span-2 md:col-span-3";
                              if (span === 2) return "col-span-1 sm:col-span-2";
                              return "col-span-1";
                            }
                            return (current.cols ?? 1) >= 2 && f.type === "longtext"
                              ? "col-span-2"
                              : undefined;
                          })()}
                        >
                          <label className="block text-xs font-medium mb-0.5">
                            {f.label}
                            {!readOnly && f.required ? (
                              <span className="text-danger ml-0.5">*</span>
                            ) : null}
                          </label>
                          {renderFieldInput(f)}
                          {!readOnly && fieldErrors[f.name] && (
                            <span className="text-[10px] font-medium text-danger mt-1 block">
                              {fieldErrors[f.name]}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Cột phải: khung ảnh + upload */}
                {hasImagePanel && (
                  <div className="w-full sm:w-56 sm:shrink-0 space-y-3">
                    {relatedImageCfg && (
                      <RelatedImagePanel
                        config={relatedImageCfg}
                        parentValue={relatedParentValue}
                      />
                    )}
                    {imgFields.map((f) => (
                      <div key={f.id}>
                        <label className="block text-xs font-medium mb-1 flex items-center gap-1">
                          {f.label}
                          {imgUploading[f.name] && (
                            <I.Loader size={10} className="animate-spin text-accent" />
                          )}
                        </label>
                        {form[f.name] ? (
                          <img
                            src={
                              String(form[f.name]).startsWith("wwwroot/")
                                ? `/${String(form[f.name]).slice(8)}`
                                : form[f.name]
                            }
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
      </div>
    </Modal>
  );
}
