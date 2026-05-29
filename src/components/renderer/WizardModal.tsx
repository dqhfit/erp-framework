/* ==========================================================
   WizardModal — Modal wizard nhập dữ liệu nhiều bước, được
   kích hoạt bởi ActionStep "open-wizard". Mỗi bước có thể
   gắn entity để tạo bản ghi thật; ID được lưu vào pageState
   qua saveOutputTo của từng bước.
   ========================================================== */
import { createApiDataSource } from "@erp-framework/client";
import { type ReactNode, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { PageStateLike } from "@/lib/run-action";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionConfig, ActionStepOpenWizard } from "@/types/page";
import { LookupPicker } from "@/components/renderer/LookupPicker";

const api = createApiDataSource("");

interface Props {
  step: ActionStepOpenWizard;
  pageState: PageStateLike;
  onDone: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  /** Render một ActionConfig thành nút hành động. Được cung cấp bởi ActionWidget để tránh circular import. */
  renderAction?: (action: ActionConfig, key: string) => ReactNode;
}

export function WizardModal({ step, pageState, onDone, onCancel, renderAction }: Props) {
  const entities = useUserObjects((s) => s.entities);
  const wizardSteps = step.steps ?? [];

  const [activeIdx, setActiveIdx] = useState(0);
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [collected, setCollected] = useState<Record<string, unknown>>({});

  if (wizardSteps.length === 0) {
    return (
      <Modal open onClose={onCancel} title={step.title || "Wizard"} width={540}>
        <p className="text-sm text-muted text-center py-6">Wizard chưa cấu hình bước nào.</p>
      </Modal>
    );
  }

  const current = wizardSteps[Math.min(activeIdx, wizardSteps.length - 1)];
  if (!current) return null;

  const ent = current.entity ? entities.find((e) => e.id === current.entity) : undefined;
  const visibleFields = current.fields?.length
    ? (ent?.fields ?? []).filter((f) => current.fields!.includes(f.name))
    : (ent?.fields ?? []);
  const form = forms[current.id] ?? {};
  const setField = (k: string, v: string) =>
    setForms((prev) => ({ ...prev, [current.id]: { ...form, [k]: v } }));
  const isLast = activeIdx === wizardSteps.length - 1;

  const goNext = async () => {
    setBusy(true);
    setErr("");
    try {
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
    <Modal open onClose={onCancel} title={step.title || "Wizard"} width={540}>
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
        <div className="space-y-3 min-h-[140px]">
          {current.description && <p className="text-xs text-muted">{current.description}</p>}
          {ent ? (
            visibleFields.length > 0 ? (
              visibleFields.map((f) => (
                <div key={f.id}>
                  <label className="block text-xs font-medium mb-0.5">
                    {f.label}
                    {f.required ? <span className="text-danger ml-0.5">*</span> : null}
                  </label>
                  {(f.type === "lookup" || f.type === "multi-lookup") && f.ref ? (
                    <LookupPicker
                      refEntityId={f.ref}
                      value={form[f.name] ?? ""}
                      onChange={(v) => setField(f.name, v)}
                      multi={f.type === "multi-lookup"}
                    />
                  ) : f.type === "select" && f.options?.length ? (
                    <select
                      className="input w-full"
                      value={form[f.name] ?? ""}
                      onChange={(e) => setField(f.name, e.target.value)}
                    >
                      <option value="">— chọn —</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
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
                          : f.type === "date"
                            ? "date"
                            : f.type === "datetime"
                              ? "datetime-local"
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
            {busy ? "Đang lưu..." : isLast ? step.submitLabel || "Hoàn tất" : "Tiếp theo →"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
