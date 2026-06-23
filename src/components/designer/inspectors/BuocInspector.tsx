/* Tab "Bước" (Wizard) của inspector PageDesigner cho widget step: danh sách
   bước, mỗi bước gắn entity + field, sắp xếp/thêm/xoá. Tách từ PageDesigner.tsx
   (Phase B4) — chỉ di chuyển code, KHÔNG đổi hành vi. */
import type { Dispatch, SetStateAction } from "react";
import { ActionBarInspector } from "@/components/designer/inspectors/inspector-helpers";
import type { ActionBarItem, PageComponent } from "@/components/designer/page-designer-constants";
import { fieldBoth } from "@/components/FieldDisplayToggle";
import { I } from "@/components/Icons";
import { FormField, Input, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";

export function BuocInspector({
  sel,
  update,
  expandedStep,
  setExpandedStep,
}: {
  sel: PageComponent;
  update: (id: string, patch: Partial<PageComponent>) => void;
  expandedStep: string | null;
  setExpandedStep: Dispatch<SetStateAction<string | null>>;
}) {
  const entities = useUserObjects((s) => s.entities);
  return (() => {
    interface StepDef {
      id: string;
      title: string;
      description?: string;
      entity?: string;
      fields?: string[];
      saveOutputTo?: string;
      actions?: ActionBarItem[];
    }
    const steps = (sel.config.steps as StepDef[] | undefined) ?? [];
    const submitLabel = (sel.config.submitLabel as string | undefined) ?? "";

    const addStep = () => {
      const newStep: StepDef = {
        id: `s_${Math.random().toString(36).slice(2, 6)}`,
        title: `Bước ${steps.length + 1}`,
      };
      update(sel.id, {
        config: { ...sel.config, steps: [...steps, newStep] },
      });
      setExpandedStep(newStep.id);
    };
    const removeStep = (sid: string) => {
      update(sel.id, {
        config: { ...sel.config, steps: steps.filter((s) => s.id !== sid) },
      });
      if (expandedStep === sid) setExpandedStep(null);
    };
    const updateStep = (sid: string, patch: Partial<StepDef>) =>
      update(sel.id, {
        config: {
          ...sel.config,
          steps: steps.map((s) => (s.id === sid ? { ...s, ...patch } : s)),
        },
      });

    return (
      <>
        <FormField label="Nhãn nút hoàn tất">
          <Input
            placeholder="Hoàn tất"
            value={submitLabel}
            onChange={(e) =>
              update(sel.id, {
                config: { ...sel.config, submitLabel: e.target.value },
              })
            }
          />
        </FormField>
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mt-1">
          Các bước ({steps.length})
        </div>
        <div className="space-y-2">
          {steps.map((s, i) => {
            const stepEnt = entities.find((e) => e.id === s.entity);
            const isOpen = expandedStep === s.id;
            const allSelected = s.fields == null;
            const selectedFieldNames = s.fields ?? [];
            const entFields = stepEnt?.fields ?? [];
            return (
              <div key={s.id} className="border border-border rounded-md overflow-hidden">
                <button
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 text-left",
                    isOpen ? "bg-accent/10" : "hover:bg-hover/50",
                  )}
                  onClick={() => setExpandedStep(isOpen ? null : s.id)}
                >
                  <div className="w-5 h-5 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[10px] font-semibold shrink-0">
                    {i + 1}
                  </div>
                  <span className="flex-1 text-xs font-medium truncate">
                    {s.title || `Bước ${i + 1}`}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeStep(s.id);
                    }}
                    className="w-5 h-5 flex items-center justify-center text-muted hover:text-danger"
                  >
                    <I.Trash size={11} />
                  </button>
                  <I.ChevronDown
                    size={11}
                    className={cn(
                      "text-muted transition-transform shrink-0",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="p-2 space-y-2 border-t border-border bg-bg-soft">
                    <FormField label="Tên bước">
                      <Input
                        placeholder={`Bước ${i + 1}`}
                        value={s.title}
                        onChange={(e) => updateStep(s.id, { title: e.target.value })}
                      />
                    </FormField>
                    <FormField label="Mô tả (tuỳ chọn)">
                      <Input
                        placeholder="Hướng dẫn người dùng..."
                        value={s.description ?? ""}
                        onChange={(e) =>
                          updateStep(s.id, {
                            description: e.target.value || undefined,
                          })
                        }
                      />
                    </FormField>
                    <FormField label="Entity (tạo bản ghi)">
                      <Select
                        value={s.entity ?? ""}
                        onChange={(e) =>
                          updateStep(s.id, {
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
                      <FormField label="Trường hiển thị">
                        <div className="border border-border rounded overflow-hidden max-h-36 overflow-y-auto">
                          {entFields.map((f) => {
                            const checked = allSelected || selectedFieldNames.includes(f.name);
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
                                      : [...selectedFieldNames];
                                    const next = ev.target.checked
                                      ? base.includes(f.name)
                                        ? base
                                        : [...base, f.name]
                                      : base.filter((n) => n !== f.name);
                                    updateStep(s.id, {
                                      fields: next.length === entFields.length ? undefined : next,
                                    });
                                  }}
                                />
                                <span className="flex-1 truncate">{fieldBoth(f)}</span>
                              </label>
                            );
                          })}
                        </div>
                      </FormField>
                    )}
                    {s.entity && (
                      <FormField label="Lưu ID vào state key">
                        <Input
                          placeholder="vd: don_hang_id"
                          value={s.saveOutputTo ?? ""}
                          onChange={(e) =>
                            updateStep(s.id, {
                              saveOutputTo: e.target.value || undefined,
                            })
                          }
                        />
                        <div className="text-[10px] text-muted/70 mt-0.5 px-0.5">
                          Bước sau dùng state này để liên kết
                        </div>
                      </FormField>
                    )}
                    <div className="pt-1 border-t border-border/60">
                      <ActionBarInspector
                        items={s.actions ?? []}
                        align="left"
                        embedded
                        onChange={(items) =>
                          updateStep(s.id, {
                            actions: items.length ? items : undefined,
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1 py-1.5 rounded border border-dashed border-border text-xs text-muted hover:border-accent hover:text-accent transition-colors"
          onClick={addStep}
        >
          <I.Plus size={12} /> Thêm bước
        </button>
      </>
    );
  })();
}
