/* ==========================================================
   ActionInspector — Sidebar config cho widget "action" trong
   PageDesigner. Cho phép sửa label/icon/variant + chuỗi step
   (procedure / confirm / navigate / set-state).
   ========================================================== */
import { createProceduresClient } from "@erp-framework/client";
import { useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, FormField, Input, Select } from "@/components/ui";
import { useUserObjects } from "@/stores/userObjects";
import type {
  ActionConfig,
  ActionStep,
  ActionStepConfirm,
  ActionStepNavigate,
  ActionStepOpenPopup,
  ActionStepOpenWizard,
  ActionStepProcedure,
  ActionStepSetState,
  ActionStepUploadFile,
  ActionVariant,
  BindingValue,
  WizardStepDef,
} from "@/types/page";

const procs = createProceduresClient("");

interface ProcRow {
  id: string;
  name: string;
  label: string;
  paramsSchema: unknown;
}

interface ProcParam {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
}

function readParams(p: unknown): ProcParam[] {
  if (!Array.isArray(p)) return [];
  return p
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      name: String(x.name ?? ""),
      type: typeof x.type === "string" ? x.type : undefined,
      required: x.required === true,
      description: typeof x.description === "string" ? x.description : undefined,
    }))
    .filter((x) => x.name.length > 0);
}

const VARIANT_OPTIONS: ActionVariant[] = ["primary", "default", "danger", "ghost"];

interface Props {
  config: ActionConfig;
  onChange: (next: ActionConfig) => void;
}

export function ActionInspector({ config, onChange }: Props) {
  const [procedures, setProcedures] = useState<ProcRow[]>([]);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    let alive = true;
    procs
      .list()
      .then((rows) => {
        if (!alive) return;
        setProcedures(
          (rows as unknown as ProcRow[]).map((r) => ({
            id: r.id,
            name: r.name,
            label: r.label,
            paramsSchema: r.paramsSchema,
          })),
        );
      })
      .catch((e) => alive && setLoadErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  const update = (patch: Partial<ActionConfig>) => onChange({ ...config, ...patch });
  const setSteps = (steps: ActionStep[]) => update({ steps });

  const addStep = (kind: ActionStep["kind"]) => {
    const id = `s_${Math.random().toString(36).slice(2, 7)}`;
    let step: ActionStep;
    if (kind === "confirm") {
      step = { id, kind, message: "Bạn có chắc chắn?" } satisfies ActionStepConfirm;
    } else if (kind === "procedure") {
      step = {
        id,
        kind,
        procedureName: "",
        args: {},
      } satisfies ActionStepProcedure;
    } else if (kind === "upload-file") {
      step = {
        id,
        kind,
        subfolder: "doc",
        accept: "",
        saveUrlTo: "",
        saveNameTo: "",
      } satisfies ActionStepUploadFile;
    } else if (kind === "navigate") {
      step = { id, kind, href: "" } satisfies ActionStepNavigate;
    } else if (kind === "open-popup") {
      step = {
        id,
        kind: "open-popup",
        popupMode: "list",
        entity: "",
        saveOutputTo: "",
      } satisfies ActionStepOpenPopup;
    } else if (kind === "open-wizard") {
      step = {
        id,
        kind: "open-wizard",
        title: "Wizard",
        steps: [],
      } satisfies ActionStepOpenWizard;
    } else {
      step = {
        id,
        kind: "set-state",
        key: "",
        value: { source: "const", value: "" },
      } satisfies ActionStepSetState;
    }
    setSteps([...(config.steps ?? []), step]);
  };

  const updateStep = (idx: number, next: ActionStep) => {
    const list = [...(config.steps ?? [])];
    list[idx] = next;
    setSteps(list);
  };

  const removeStep = (idx: number) => {
    const list = [...(config.steps ?? [])];
    list.splice(idx, 1);
    setSteps(list);
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const list = [...(config.steps ?? [])];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[idx];
    const b = list[j];
    if (!a || !b) return;
    list[idx] = b;
    list[j] = a;
    setSteps(list);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-3 border-b border-border">
        <div className="text-[11px] uppercase text-muted tracking-wider font-semibold mb-2">
          Hành động
        </div>
        <div className="space-y-2.5">
          <FormField label="Nhãn nút">
            <Input
              value={config.label ?? ""}
              onChange={(e) => update({ label: e.target.value })}
              placeholder="vd: Duyệt đơn"
            />
          </FormField>
          <FormField label="Kiểu hiển thị">
            <Select
              value={config.variant ?? "default"}
              onChange={(e) => update({ variant: e.target.value as ActionVariant })}
            >
              {VARIANT_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Icon (tuỳ chọn)" hint="Tên icon trong bộ I.* (vd Play, Check, Plus)">
            <Input
              value={config.icon ?? ""}
              onChange={(e) =>
                update({ icon: (e.target.value || undefined) as ActionConfig["icon"] })
              }
              placeholder="vd: Play"
            />
          </FormField>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={config.iconOnly === true}
              onChange={(e) => update({ iconOnly: e.target.checked || undefined })}
            />
            <span className="font-medium">Chỉ hiện icon (ẩn nhãn, label thành tooltip)</span>
          </label>
          <FormField label="Tooltip">
            <Input
              value={config.hint ?? ""}
              onChange={(e) => update({ hint: e.target.value || undefined })}
              placeholder="Mô tả hiển thị khi hover"
            />
          </FormField>

          <div className="space-y-1.5 pt-1 border-t border-border">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={config.requireConfirm === true}
                onChange={(e) =>
                  update({
                    requireConfirm: e.target.checked || undefined,
                  })
                }
              />
              <span className="font-medium">Hỏi xác nhận trước khi chạy</span>
            </label>
            {config.requireConfirm && (
              <div className="space-y-1.5 pl-5">
                <FormField label="Tiêu đề (tuỳ chọn)">
                  <Input
                    value={config.confirmTitle ?? ""}
                    onChange={(e) => update({ confirmTitle: e.target.value || undefined })}
                    placeholder="vd: Xác nhận duyệt"
                  />
                </FormField>
                <FormField label="Nội dung xác nhận">
                  <Input
                    value={config.confirmMessage ?? ""}
                    onChange={(e) => update({ confirmMessage: e.target.value || undefined })}
                    placeholder="vd: Bạn có chắc chắn duyệt đơn này?"
                  />
                </FormField>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-3 flex-1">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase text-muted tracking-wider font-semibold">
            Chuỗi bước ({(config.steps ?? []).length})
          </div>
          <StepAddMenu onAdd={addStep} />
        </div>

        {loadErr && (
          <div className="text-xs text-danger mb-2">
            Không tải được danh sách procedure: {loadErr}
          </div>
        )}

        {(config.steps ?? []).length === 0 ? (
          <div className="text-xs text-muted border border-dashed border-border rounded-md p-4 text-center">
            Chưa có bước nào. Bấm “+ Thêm bước” phía trên.
          </div>
        ) : (
          <div className="space-y-2">
            {(config.steps ?? []).map((step, idx) => (
              <StepRow
                key={step.id}
                step={step}
                idx={idx}
                total={(config.steps ?? []).length}
                procedures={procedures}
                onChange={(next) => updateStep(idx, next)}
                onRemove={() => removeStep(idx)}
                onMoveUp={() => moveStep(idx, -1)}
                onMoveDown={() => moveStep(idx, 1)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Add menu ─────────────────────── */
function StepAddMenu({ onAdd }: { onAdd: (kind: ActionStep["kind"]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="default"
        icon={<I.Plus size={11} />}
        onClick={() => setOpen((v) => !v)}
      >
        Thêm bước
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            onKeyDown={() => setOpen(false)}
            role="presentation"
          />
          <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-panel border border-border rounded-md shadow-md py-1">
            {(
              [
                { k: "procedure", label: "Gọi procedure" },
                { k: "confirm", label: "Hỏi xác nhận" },
                { k: "navigate", label: "Điều hướng" },
                { k: "set-state", label: "Đặt page state" },
                { k: "open-popup", label: "Mở popup" },
                { k: "open-wizard", label: "Mở wizard" },
                { k: "upload-file", label: "Tải lên file" },
              ] as const
            ).map((o) => (
              <button
                key={o.k}
                type="button"
                className="w-full text-left text-xs px-3 py-1.5 hover:bg-hover"
                onClick={() => {
                  onAdd(o.k);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── Step row ─────────────────────── */
function StepRow({
  step,
  idx,
  total,
  procedures,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  step: ActionStep;
  idx: number;
  total: number;
  procedures: ProcRow[];
  onChange: (next: ActionStep) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const kindLabel: Record<ActionStep["kind"], string> = {
    procedure: "Gọi procedure",
    "invoke-module-proc": "Gọi proc nghiệp vụ (Tier D)",
    confirm: "Hỏi xác nhận",
    "delete-record": "Xoá bản ghi",
    "create-record": "Tạo bản ghi",
    "update-record": "Sửa bản ghi",
    "update-fields": "Cập nhật trường trực tiếp",
    "update-many-fields": "Cập nhật nhiều bản ghi",
    navigate: "Điều hướng",
    "set-state": "Đặt page state",
    refresh: "Nạp lại lưới",
    "export-records": "Xuất dữ liệu (Excel/CSV)",
    "print-records": "In danh sách",
    "open-popup": "Mở popup",
    "open-create-form": "Mở form tạo mới (list)",
    "open-wizard": "Mở wizard",
    "upload-file": "Tải lên file",
  };
  return (
    <div className="border border-border rounded-md bg-panel">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-bg-soft">
        <Chip className="text-[10px]">{idx + 1}</Chip>
        <span className="text-xs font-medium">{kindLabel[step.kind]}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onMoveUp}
          disabled={idx === 0}
          className="p-1 rounded hover:bg-hover disabled:opacity-30"
          title="Lên"
        >
          <I.ChevronUp size={11} />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={idx === total - 1}
          className="p-1 rounded hover:bg-hover disabled:opacity-30"
          title="Xuống"
        >
          <I.ChevronDown size={11} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 rounded hover:bg-danger/15 text-muted hover:text-danger"
          title="Xoá"
        >
          <I.Trash size={11} />
        </button>
      </div>
      <div className="p-2.5">
        {step.kind === "confirm" && <ConfirmEditor step={step} onChange={onChange} />}
        {step.kind === "procedure" && (
          <ProcedureEditor step={step} procedures={procedures} onChange={onChange} />
        )}
        {step.kind === "navigate" && <NavigateEditor step={step} onChange={onChange} />}
        {step.kind === "set-state" && <SetStateEditor step={step} onChange={onChange} />}
        {step.kind === "open-popup" && <PopupEditor step={step} onChange={onChange} />}
        {step.kind === "open-wizard" && <WizardEditor step={step} onChange={onChange} />}
        {step.kind === "upload-file" && <UploadFileEditor step={step} onChange={onChange} />}
      </div>
    </div>
  );
}

/* ─────────────────────────── Confirm ──────────────────────── */
function ConfirmEditor({
  step,
  onChange,
}: {
  step: ActionStepConfirm;
  onChange: (next: ActionStepConfirm) => void;
}) {
  return (
    <div className="space-y-2">
      <FormField label="Tiêu đề">
        <Input
          value={step.title ?? ""}
          onChange={(e) => onChange({ ...step, title: e.target.value || undefined })}
          placeholder="vd: Xác nhận xoá"
        />
      </FormField>
      <FormField label="Nội dung">
        <Input
          value={step.message}
          onChange={(e) => onChange({ ...step, message: e.target.value })}
          placeholder="vd: Bạn có chắc chắn?"
        />
      </FormField>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={step.danger === true}
          onChange={(e) => onChange({ ...step, danger: e.target.checked || undefined })}
        />
        Nguy hiểm (nút xác nhận màu đỏ)
      </label>
    </div>
  );
}

/* ─────────────────────────── Procedure ────────────────────── */
function ProcedureEditor({
  step,
  procedures,
  onChange,
}: {
  step: ActionStepProcedure;
  procedures: ProcRow[];
  onChange: (next: ActionStepProcedure) => void;
}) {
  const selected = procedures.find((p) => p.name === step.procedureName);
  const params = useMemo(() => readParams(selected?.paramsSchema), [selected]);

  const setArg = (paramName: string, binding: BindingValue | null) => {
    const args = { ...(step.args ?? {}) };
    if (binding == null) delete args[paramName];
    else args[paramName] = binding;
    onChange({ ...step, args });
  };

  return (
    <div className="space-y-2">
      <FormField label="Procedure">
        <Select
          value={step.procedureName}
          onChange={(e) => onChange({ ...step, procedureName: e.target.value, args: {} })}
        >
          <option value="">— chọn —</option>
          {procedures.map((p) => (
            <option key={p.id} value={p.name}>
              {p.label} ({p.name})
            </option>
          ))}
        </Select>
      </FormField>

      {selected && params.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-border">
          <div className="text-[10px] uppercase text-muted tracking-wider font-semibold">
            Tham số
          </div>
          {params.map((p) => (
            <ArgBindingRow
              key={p.name}
              param={p}
              binding={step.args?.[p.name]}
              onChange={(b) => setArg(p.name, b)}
            />
          ))}
        </div>
      )}

      <FormField label="Lưu output vào page state" hint="Tên key — bỏ trống nếu không cần">
        <Input
          value={step.saveOutputTo ?? ""}
          onChange={(e) => onChange({ ...step, saveOutputTo: e.target.value || undefined })}
          placeholder="vd: lastResult"
        />
      </FormField>

      <FormField
        label="Refetch entity sau khi chạy"
        hint="ID entity, mỗi dòng một entity — widget list/detail/... bind entity này sẽ tự refresh"
      >
        <textarea
          className="input font-mono text-xs"
          rows={2}
          value={(step.invalidateEntities ?? []).join("\n")}
          onChange={(e) => {
            const lines = e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s);
            onChange({ ...step, invalidateEntities: lines.length ? lines : undefined });
          }}
          placeholder="vd: task"
        />
      </FormField>
    </div>
  );
}

/* ─────────────── Binding chọn nguồn cho 1 param ───────────── */
function ArgBindingRow({
  param,
  binding,
  onChange,
}: {
  param: ProcParam;
  binding: BindingValue | undefined;
  onChange: (b: BindingValue | null) => void;
}) {
  const source = binding?.source ?? "const";
  return (
    <div className="space-y-1 pl-2 border-l-2 border-border">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-mono text-xs">
          {param.name}
          {param.required && <span className="text-danger ml-0.5">*</span>}
        </span>
        <span className="text-[10px] text-muted">({param.type ?? "any"})</span>
        <div className="flex-1" />
        <Select
          value={source}
          onChange={(e) => {
            const s = e.target.value as BindingValue["source"];
            if (s === "const") onChange({ source: "const", value: "" });
            else if (s === "state") onChange({ source: "state", key: "" });
            else onChange({ source: "template", template: "" });
          }}
          className="h-6! text-[11px]! py-0! px-1.5! w-auto!"
        >
          <option value="const">const</option>
          <option value="state">state</option>
          <option value="template">template</option>
        </Select>
        {binding && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[10px] text-muted hover:text-danger px-1"
            title="Bỏ binding"
          >
            ×
          </button>
        )}
      </div>
      <BindingValueInput
        binding={binding ?? { source: "const", value: "" }}
        paramType={param.type}
        onChange={onChange}
      />
      {param.description && <div className="text-[10px] text-muted">{param.description}</div>}
    </div>
  );
}

function BindingValueInput({
  binding,
  paramType,
  onChange,
}: {
  binding: BindingValue;
  paramType?: string;
  onChange: (b: BindingValue) => void;
}) {
  if (binding.source === "state") {
    return (
      <Input
        value={binding.key}
        onChange={(e) => onChange({ source: "state", key: e.target.value })}
        placeholder="vd: selectedId"
        className="text-xs!"
      />
    );
  }
  if (binding.source === "template") {
    return (
      <Input
        value={binding.template}
        onChange={(e) => onChange({ source: "template", template: e.target.value })}
        placeholder="vd: {{state.selectedId}}"
        className="text-xs! font-mono!"
      />
    );
  }
  // const — input theo paramType
  if (paramType === "boolean") {
    return (
      <Select
        value={binding.value === true ? "true" : "false"}
        onChange={(e) => onChange({ source: "const", value: e.target.value === "true" })}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </Select>
    );
  }
  if (paramType === "number" || paramType === "integer") {
    return (
      <Input
        type="number"
        value={
          typeof binding.value === "number" || typeof binding.value === "string"
            ? String(binding.value)
            : ""
        }
        onChange={(e) => {
          const s = e.target.value;
          if (s === "") onChange({ source: "const", value: "" });
          else onChange({ source: "const", value: Number(s) });
        }}
        className="text-xs!"
      />
    );
  }
  return (
    <Input
      value={binding.value == null ? "" : String(binding.value)}
      onChange={(e) => onChange({ source: "const", value: e.target.value })}
      placeholder="giá trị cố định"
      className="text-xs!"
    />
  );
}

/* ─────────────────────────── Navigate ─────────────────────── */
function NavigateEditor({
  step,
  onChange,
}: {
  step: ActionStepNavigate;
  onChange: (next: ActionStepNavigate) => void;
}) {
  return (
    <div className="space-y-2">
      <FormField label="URL / Đường dẫn" hint="Hỗ trợ {{state.key}} interpolation">
        <Input
          value={step.href}
          onChange={(e) => onChange({ ...step, href: e.target.value })}
          placeholder="vd: /tasks/{{state.lastId}}"
        />
      </FormField>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={step.external === true}
          onChange={(e) => onChange({ ...step, external: e.target.checked || undefined })}
        />
        Mở tab mới (external link)
      </label>
    </div>
  );
}

/* ─────────────────────────── Set state ────────────────────── */
function SetStateEditor({
  step,
  onChange,
}: {
  step: ActionStepSetState;
  onChange: (next: ActionStepSetState) => void;
}) {
  return (
    <div className="space-y-2">
      <FormField label="Khoá page state">
        <Input
          value={step.key}
          onChange={(e) => onChange({ ...step, key: e.target.value })}
          placeholder="vd: selectedId"
        />
      </FormField>
      <FormField label="Giá trị">
        <BindingValueRow binding={step.value} onChange={(b) => onChange({ ...step, value: b })} />
      </FormField>
    </div>
  );
}

/* ─────────────────────────── Open popup ───────────────────── */
function PopupEditor({
  step,
  onChange,
}: {
  step: ActionStepOpenPopup;
  onChange: (next: ActionStepOpenPopup) => void;
}) {
  const entities = useUserObjects((s) => s.entities);

  return (
    <div className="space-y-2">
      <FormField label="Chế độ popup">
        <Select
          value={step.popupMode}
          onChange={(e) =>
            onChange({ ...step, popupMode: e.target.value as ActionStepOpenPopup["popupMode"] })
          }
        >
          <option value="list">Danh sách (chọn bản ghi)</option>
          <option value="detail">Chi tiết (xem + chọn)</option>
          <option value="form">Biểu mẫu (nhập mới)</option>
        </Select>
      </FormField>

      <FormField label="Entity">
        <Select value={step.entity} onChange={(e) => onChange({ ...step, entity: e.target.value })}>
          <option value="">— chọn entity —</option>
          {entities.map((ent) => (
            <option key={ent.id} value={ent.id}>
              {ent.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField label="Tiêu đề popup" hint="Bỏ trống để dùng tên mặc định">
        <Input
          value={step.title ?? ""}
          onChange={(e) => onChange({ ...step, title: e.target.value || undefined })}
          placeholder="vd: Chọn khách hàng"
        />
      </FormField>

      {step.popupMode === "detail" && (
        <div className="space-y-1 pl-2 border-l-2 border-border">
          <div className="text-[10px] uppercase text-muted tracking-wider font-semibold mb-1">
            Binding ID bản ghi
          </div>
          <BindingValueRow
            binding={step.recordIdBinding ?? { source: "const", value: "" }}
            onChange={(b) => onChange({ ...step, recordIdBinding: b })}
          />
        </div>
      )}

      <FormField label="Lưu kết quả vào page state" hint="Key để lưu object đã chọn / nhập">
        <Input
          value={step.saveOutputTo}
          onChange={(e) => onChange({ ...step, saveOutputTo: e.target.value })}
          placeholder="vd: selectedCustomer"
        />
      </FormField>
    </div>
  );
}

/* ─────────────────────────── Wizard ───────────────────────── */
function WizardEditor({
  step,
  onChange,
}: {
  step: ActionStepOpenWizard;
  onChange: (next: ActionStepOpenWizard) => void;
}) {
  const entities = useUserObjects((s) => s.entities);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [autoEntity, setAutoEntity] = useState("");

  const steps = step.steps ?? [];

  const upd = (patch: Partial<ActionStepOpenWizard>) => onChange({ ...step, ...patch });

  const addWizardStep = () => {
    const id = `ws_${Math.random().toString(36).slice(2, 6)}`;
    const newStep: WizardStepDef = { id, title: `Bước ${steps.length + 1}` };
    upd({ steps: [...steps, newStep] });
    setExpanded(id);
  };

  const removeWizardStep = (sid: string) => {
    upd({ steps: steps.filter((s) => s.id !== sid) });
    if (expanded === sid) setExpanded(null);
  };

  const updateWizardStep = (sid: string, patch: Partial<WizardStepDef>) =>
    upd({ steps: steps.map((s) => (s.id === sid ? { ...s, ...patch } : s)) });

  /** Tự sinh wizard từ cấu trúc bảng: nhóm mỗi 5 field thành 1 bước. */
  const autoGenerate = () => {
    const ent = entities.find((e) => e.id === autoEntity);
    if (!ent) return;
    const validFields = ent.fields
      .filter((f) => !["formula", "collection"].includes(f.type))
      .map((f) => f.name);
    const CHUNK = 5;
    const chunks: string[][] = [];
    for (let i = 0; i < validFields.length; i += CHUNK) {
      chunks.push(validFields.slice(i, i + CHUNK));
    }
    if (chunks.length === 0) chunks.push([]);
    const generated: WizardStepDef[] = chunks.map((fs, i) => ({
      id: `ws_${Math.random().toString(36).slice(2, 6)}`,
      title:
        chunks.length === 1
          ? `Nhập ${ent.name}`
          : i === 0
            ? `Thông tin ${ent.name}`
            : `Chi tiết (phần ${i + 1})`,
      entity: ent.id,
      fields: fs.length === validFields.length ? undefined : fs,
      saveOutputTo: i === 0 ? `${ent.id}_id` : undefined,
    }));
    upd({ steps: [...steps, ...generated] });
    setExpanded(generated[0]?.id ?? null);
  };

  return (
    <div className="space-y-3">
      <FormField label="Tiêu đề wizard">
        <Input
          value={step.title ?? ""}
          onChange={(e) => upd({ title: e.target.value || undefined })}
          placeholder="vd: Tạo đơn hàng"
        />
      </FormField>
      <FormField label="Nhãn nút hoàn tất">
        <Input
          value={step.submitLabel ?? ""}
          onChange={(e) => upd({ submitLabel: e.target.value || undefined })}
          placeholder="Hoàn tất"
        />
      </FormField>
      <FormField label="Lưu kết quả vào state" hint="Key để lưu data tổng hợp">
        <Input
          value={step.saveOutputTo ?? ""}
          onChange={(e) => upd({ saveOutputTo: e.target.value || undefined })}
          placeholder="vd: wizardResult"
        />
      </FormField>

      {/* Auto-generate từ bảng */}
      <div className="border border-dashed border-border rounded-md p-2 space-y-1.5">
        <div className="text-[10px] uppercase text-muted tracking-wider font-semibold">
          Tự sinh bước từ bảng
        </div>
        <div className="flex gap-1">
          <Select
            value={autoEntity}
            onChange={(e) => setAutoEntity(e.target.value)}
            className="flex-1"
          >
            <option value="">— chọn entity —</option>
            {entities.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
          </Select>
          <button
            type="button"
            disabled={!autoEntity}
            onClick={autoGenerate}
            className="px-2 py-1 rounded border border-border bg-panel hover:bg-hover text-xs disabled:opacity-40 shrink-0 whitespace-nowrap"
          >
            Tạo từ bảng
          </button>
        </div>
        <div className="text-[10px] text-muted/70">
          Tự động nhóm mỗi 5 field thành 1 bước — thêm vào danh sách bên dưới.
        </div>
      </div>

      {/* Danh sách bước */}
      <div className="text-[10px] uppercase text-muted tracking-wider font-semibold">
        Các bước ({steps.length})
      </div>

      {steps.length === 0 ? (
        <div className="text-xs text-muted border border-dashed border-border rounded-md p-3 text-center">
          Chưa có bước nào.
        </div>
      ) : (
        <div className="space-y-1.5">
          {steps.map((s, i) => {
            const stepEnt = entities.find((e) => e.id === s.entity);
            const isOpen = expanded === s.id;
            const entFields = stepEnt?.fields ?? [];
            const allSelected = s.fields == null;
            const selectedFields = s.fields ?? [];
            return (
              <div key={s.id} className="border border-border rounded-md overflow-hidden">
                <button
                  type="button"
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-left ${isOpen ? "bg-accent/10" : "hover:bg-hover/50"}`}
                  onClick={() => setExpanded(isOpen ? null : s.id)}
                >
                  <div className="w-5 h-5 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[10px] font-semibold shrink-0">
                    {i + 1}
                  </div>
                  <span className="flex-1 text-xs font-medium truncate">
                    {s.title || `Bước ${i + 1}`}
                  </span>
                  {s.entity && (
                    <span className="text-[10px] text-muted truncate max-w-[60px]">
                      {stepEnt?.name ?? s.entity}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeWizardStep(s.id);
                    }}
                    className="w-5 h-5 flex items-center justify-center text-muted hover:text-danger shrink-0"
                  >
                    <I.Trash size={11} />
                  </button>
                </button>
                {isOpen && (
                  <div className="p-2 space-y-2 border-t border-border bg-bg-soft">
                    <FormField label="Tên bước">
                      <Input
                        placeholder={`Bước ${i + 1}`}
                        value={s.title}
                        onChange={(e) => updateWizardStep(s.id, { title: e.target.value })}
                      />
                    </FormField>
                    <FormField label="Mô tả">
                      <Input
                        placeholder="Hướng dẫn người dùng..."
                        value={s.description ?? ""}
                        onChange={(e) =>
                          updateWizardStep(s.id, { description: e.target.value || undefined })
                        }
                      />
                    </FormField>
                    <FormField label="Entity (tạo bản ghi)">
                      <Select
                        value={s.entity ?? ""}
                        onChange={(e) =>
                          updateWizardStep(s.id, {
                            entity: e.target.value || undefined,
                            fields: undefined,
                          })
                        }
                      >
                        <option value="">— chỉ hiển thị, không lưu —</option>
                        {entities.map((en) => (
                          <option key={en.id} value={en.id}>
                            {en.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    {stepEnt && entFields.length > 0 && (
                      <FormField label="Field hiển thị">
                        <div className="border border-border rounded overflow-hidden max-h-32 overflow-y-auto">
                          {entFields.map((f) => {
                            const checked = allSelected || selectedFields.includes(f.name);
                            return (
                              <label
                                key={f.name}
                                className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-hover/40 border-b border-border/50 last:border-0"
                              >
                                <input
                                  type="checkbox"
                                  className="accent-accent"
                                  checked={checked}
                                  onChange={(ev) => {
                                    const base = allSelected
                                      ? entFields.map((x) => x.name)
                                      : [...selectedFields];
                                    const next = ev.target.checked
                                      ? base.includes(f.name)
                                        ? base
                                        : [...base, f.name]
                                      : base.filter((n) => n !== f.name);
                                    updateWizardStep(s.id, {
                                      fields: next.length === entFields.length ? undefined : next,
                                    });
                                  }}
                                />
                                <span className="flex-1 truncate">{f.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </FormField>
                    )}
                    {s.entity && (
                      <FormField label="Lưu ID vào state key">
                        <Input
                          placeholder="vd: order_id"
                          value={s.saveOutputTo ?? ""}
                          onChange={(e) =>
                            updateWizardStep(s.id, { saveOutputTo: e.target.value || undefined })
                          }
                        />
                      </FormField>
                    )}
                    <div className="pt-1 border-t border-border/60">
                      <WizardStepActionsEditor
                        actions={s.actions ?? []}
                        onChange={(acts) =>
                          updateWizardStep(s.id, { actions: acts.length ? acts : undefined })
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={addWizardStep}
        className="w-full flex items-center justify-center gap-1 py-1.5 rounded border border-dashed border-border text-xs text-muted hover:border-accent hover:text-accent transition-colors"
      >
        <I.Plus size={12} /> Thêm bước thủ công
      </button>
    </div>
  );
}

/* ─────────────── Actions editor nhỏ cho từng bước wizard ─── */
function WizardStepActionsEditor({
  actions,
  onChange,
}: {
  actions: Array<{ id: string } & ActionConfig>;
  onChange: (next: Array<{ id: string } & ActionConfig>) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const addAction = () => {
    const id = `wa_${Math.random().toString(36).slice(2, 7)}`;
    const newItem: { id: string } & ActionConfig = { id, label: "Hành động", steps: [] };
    const next = [...actions, newItem];
    onChange(next);
    setExpandedId(id);
  };

  const removeAction = (id: string) => {
    onChange(actions.filter((a) => a.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const updateAction = (id: string, next: ActionConfig) => {
    onChange(actions.map((a) => (a.id === id ? { ...next, id } : a)));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase text-muted tracking-wider font-semibold">
          Hành động của bước ({actions.length})
        </div>
        <button
          type="button"
          onClick={addAction}
          className="flex items-center gap-0.5 text-[10px] text-accent hover:underline"
        >
          <I.Plus size={10} /> Thêm
        </button>
      </div>
      {actions.length === 0 && (
        <div className="text-[10px] text-muted/60 text-center py-1.5 border border-dashed border-border/50 rounded-md">
          Chưa có hành động
        </div>
      )}
      <div className="space-y-1">
        {actions.map((item) => (
          <div key={item.id} className="border border-border rounded-md overflow-hidden">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-bg-soft">
              <input
                className="flex-1 bg-transparent outline-none min-w-0 text-xs"
                value={item.label}
                placeholder="Nhãn"
                onChange={(e) => updateAction(item.id, { ...item, label: e.target.value })}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                className="text-muted hover:text-text"
              >
                {expandedId === item.id ? <I.ChevronUp size={10} /> : <I.ChevronDown size={10} />}
              </button>
              <button
                type="button"
                onClick={() => removeAction(item.id)}
                className="hover:text-danger text-muted"
              >
                <I.X size={10} />
              </button>
            </div>
            {expandedId === item.id && (
              <div className="border-t border-border">
                <ActionInspector config={item} onChange={(next) => updateAction(item.id, next)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BindingValueRow({
  binding,
  onChange,
}: {
  binding: BindingValue;
  onChange: (b: BindingValue) => void;
}) {
  return (
    <div className="space-y-1">
      <Select
        value={binding.source}
        onChange={(e) => {
          const s = e.target.value as BindingValue["source"];
          if (s === "const") onChange({ source: "const", value: "" });
          else if (s === "state") onChange({ source: "state", key: "" });
          else onChange({ source: "template", template: "" });
        }}
      >
        <option value="const">const (hằng)</option>
        <option value="state">state (đọc page state khác)</option>
        <option value="template">template ({"{{state.x}}"})</option>
      </Select>
      <BindingValueInput binding={binding} onChange={onChange} />
    </div>
  );
}

function UploadFileEditor({
  step,
  onChange,
}: {
  step: ActionStepUploadFile;
  onChange: (next: ActionStepUploadFile) => void;
}) {
  return (
    <div className="space-y-2">
      <FormField label="Thư mục con (subfolder)">
        <Input
          value={step.subfolder ?? ""}
          onChange={(e) => onChange({ ...step, subfolder: e.target.value || undefined })}
          placeholder="vd: banve, tailieu"
        />
      </FormField>
      <FormField label="Định dạng cho phép (accept)">
        <Input
          value={step.accept ?? ""}
          onChange={(e) => onChange({ ...step, accept: e.target.value || undefined })}
          placeholder="vd: .pdf,.png,.jpg (để trống = tất cả)"
        />
      </FormField>
      <FormField label="Lưu URL file vào state key">
        <Input
          value={step.saveUrlTo ?? ""}
          onChange={(e) => onChange({ ...step, saveUrlTo: e.target.value || undefined })}
          placeholder="vd: fileUrl"
        />
      </FormField>
      <FormField label="Lưu tên file vào state key">
        <Input
          value={step.saveNameTo ?? ""}
          onChange={(e) => onChange({ ...step, saveNameTo: e.target.value || undefined })}
          placeholder="vd: fileName"
        />
      </FormField>
    </div>
  );
}
