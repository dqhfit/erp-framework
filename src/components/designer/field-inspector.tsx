/* ==========================================================
   field-inspector.tsx — Inspector bên phải EntityDesigner.
   3 tab inline: Data (props field + RBAC + formula), Style, Events.
   Tách khỏi EntityDesigner.tsx (P2.7 refactor).
   ========================================================== */
import { I } from "@/components/Icons";
import { EnumPicker } from "@/components/designer/EnumPicker";
import { sampleValueFor } from "@/components/designer/field-row";
import { FormulaEditor } from "@/components/designer/FormulaEditor";
import {
  FormField,
  Input,
  Select,
  Switch,
  Tabs,
  Textarea,
} from "@/components/ui";
import { useT } from "@/hooks/useT";
import { getFieldTypes } from "@/lib/field-types";
import type { EntityField } from "@/lib/object-types";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";

export interface FieldInspectorProps {
  field: EntityField | undefined;
  onUpdate: (patch: Partial<EntityField>) => void;
  onDelete: () => void;
  tab: "data" | "style" | "events";
  setTab: (t: "data" | "style" | "events") => void;
  /** Field khác trong entity, dùng cho formula picker */
  siblingFields?: EntityField[];
}

export function FieldInspector({
  field,
  onUpdate,
  onDelete,
  tab,
  setTab,
  siblingFields = [],
}: FieldInspectorProps) {
  const t = useT();
  const userEntities = useUserObjects((s) => s.entities);
  if (!field) {
    return (
      <aside className="w-[320px] shrink-0 border-l border-border bg-panel flex flex-col">
        <div className="h-11 shrink-0 px-3 flex items-center border-b border-border text-sm font-semibold">
          {t("designer.inspector")}
        </div>
        <div className="flex-1 flex items-center justify-center text-center px-6 text-sm text-muted">
          {t("designer.select_field")}
        </div>
      </aside>
    );
  }
  const ft = getFieldTypes().find((f) => f.id === field.type) ?? getFieldTypes()[0]!;
  const IC = I[ft.icon] ?? I.Type;

  return (
    <aside className="w-[320px] shrink-0 border-l border-border bg-panel flex flex-col">
      <div className="h-11 shrink-0 px-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-sm bg-panel-2 border border-border flex items-center justify-center text-muted">
            <IC size={12} />
          </div>
          <div className="text-sm font-semibold truncate">{field.label}</div>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="w-7 h-7 rounded-sm hover:bg-danger/15 text-muted hover:text-danger flex items-center justify-center"
          title={t("field.delete")}
        >
          <I.Trash size={13} />
        </button>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "data", label: t("field.tab_data") },
          { value: "style", label: t("field.tab_style") },
          { value: "events", label: t("field.tab_events") },
        ]}
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === "data" && (
          <>
            <FormField label={t("field.label")}>
              <Input value={field.label} onChange={(e) => onUpdate({ label: e.target.value })} />
            </FormField>
            <FormField label={t("field.label_en")} hint={t("field.label_en_hint")}>
              <Input
                value={field.labelEn ?? ""}
                placeholder="Optional English label"
                onChange={(e) => onUpdate({ labelEn: e.target.value } as Partial<EntityField>)}
              />
            </FormField>
            <FormField label={t("field.name")} hint={t("field.name_hint")}>
              <Input
                className="font-mono"
                value={field.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
              />
            </FormField>
            <FormField label={t("field.type")}>
              <Select value={field.type} onChange={(e) => onUpdate({ type: e.target.value })}>
                {getFieldTypes().map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                <span className="text-sm">{t("field.required")}</span>
                <Switch checked={!!field.required} onChange={(v) => onUpdate({ required: v })} />
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                <span className="text-sm">{t("field.unique")}</span>
                <Switch checked={false} onChange={() => {}} />
              </div>
            </div>

            {field.type === "select" && (
              <FormField label={t("field.options")} hint={t("field.options_hint")}>
                <Textarea
                  className="font-mono"
                  rows={4}
                  value={(field.options ?? []).join("\n")}
                  onChange={(e) =>
                    onUpdate({ options: e.target.value.split("\n").filter(Boolean) })
                  }
                />
              </FormField>
            )}

            {(field.type === "enum" || field.type === "multi-enum") && (
              <FormField
                label={t("field.enum")}
                hint={t("field.enum_hint")}
              >
                <EnumPicker value={field.enumId} onChange={(id) => onUpdate({ enumId: id })} />
              </FormField>
            )}

            {(field.type === "lookup" || field.type === "multi-lookup") && (
              <>
                <FormField label={t("field.ref_entity")}>
                  <Select
                    value={field.ref ?? ""}
                    onChange={(e) => onUpdate({ ref: e.target.value })}
                  >
                    <option value="">{t("field.choose_entity")}</option>
                    {userEntities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField
                  label={t("field.on_delete")}
                  hint={t("field.on_delete_hint")}
                >
                  <Select
                    value={(field as { onDelete?: string }).onDelete ?? "restrict"}
                    onChange={(e) => onUpdate({ onDelete: e.target.value } as Partial<EntityField>)}
                  >
                    <option value="restrict">{t("field.restrict")}</option>
                    <option value="setnull">{t("field.setnull")}</option>
                    <option value="cascade">{t("field.cascade")}</option>
                  </Select>
                </FormField>
              </>
            )}

            {field.type === "sequence" && (
              <>
                <FormField label={t("field.seq_prefix")} hint={t("field.seq_prefix_hint")}>
                  <Input
                    value={field.sequencePrefix ?? ""}
                    placeholder="INV-"
                    onChange={(e) =>
                      onUpdate({ sequencePrefix: e.target.value } as Partial<EntityField>)
                    }
                  />
                </FormField>
                <FormField label={t("field.seq_padding")} hint={t("field.seq_padding_hint")}>
                  <Input
                    type="number"
                    min={0}
                    max={12}
                    value={field.sequencePadding ?? 0}
                    onChange={(e) =>
                      onUpdate({ sequencePadding: Number(e.target.value) } as Partial<EntityField>)
                    }
                  />
                </FormField>
              </>
            )}

            {/* Governance controls — áp dụng cho mọi field type. */}
            <FormField label={t("field.governance")}>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!field.unique}
                    onChange={(e) => onUpdate({ unique: e.target.checked } as Partial<EntityField>)}
                  />
                  {t("field.unique_constraint")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!field.searchable}
                    onChange={(e) =>
                      onUpdate({ searchable: e.target.checked } as Partial<EntityField>)
                    }
                  />
                  {t("field.searchable")}
                </label>
              </div>
            </FormField>
            <FormField
              label={t("field.read_rbac")}
              hint={t("field.read_rbac_hint")}
            >
              <div className="flex gap-3 text-sm">
                {(["admin", "editor", "viewer"] as const).map((r) => {
                  const cur = field.readableBy ?? [];
                  const on = cur.includes(r);
                  return (
                    <label key={r} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          onUpdate({
                            readableBy: e.target.checked ? [...cur, r] : cur.filter((x) => x !== r),
                          } as Partial<EntityField>)
                        }
                      />
                      {r}
                    </label>
                  );
                })}
              </div>
            </FormField>
            <FormField label={t("field.write_rbac")} hint={t("field.write_rbac_hint")}>
              <div className="flex gap-3 text-sm">
                {(["admin", "editor", "viewer"] as const).map((r) => {
                  const cur = field.writableBy ?? [];
                  const on = cur.includes(r);
                  return (
                    <label key={r} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          onUpdate({
                            writableBy: e.target.checked ? [...cur, r] : cur.filter((x) => x !== r),
                          } as Partial<EntityField>)
                        }
                      />
                      {r}
                    </label>
                  );
                })}
              </div>
            </FormField>

            {field.type === "formula" && (
              <FormulaEditor
                value={field.formula ?? ""}
                onChange={(next) => onUpdate({ formula: next })}
                availableFields={siblingFields.map((f) => ({
                  key: f.name,
                  label: f.label,
                  type: f.type,
                }))}
                sampleRow={Object.fromEntries(
                  siblingFields.map((f) => [f.name, sampleValueFor(f.type)]),
                )}
              />
            )}

            <FormField label={t("field.desc")}>
              <Textarea rows={2} placeholder={t("field.desc_placeholder")} />
            </FormField>
          </>
        )}

        {tab === "style" && (
          <>
            <FormField label={t("field.width")}>
              <div className="grid grid-cols-3 gap-1">
                {["1/3", "1/2", "Full"].map((w) => (
                  <button
                    type="button"
                    key={w}
                    className={cn("btn btn-sm", w === "Full" ? "btn-primary" : "btn-default")}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </FormField>
            <FormField label={t("field.placeholder")}>
              <Input />
            </FormField>
            <FormField label={t("field.help_pos")}>
              <Select defaultValue="below">
                <option value="below">{t("field.help_below")}</option>
                <option value="tooltip">{t("field.help_tooltip")}</option>
              </Select>
            </FormField>
          </>
        )}

        {tab === "events" && (
          <>
            <FormField label={t("field.on_change")}>
              <Textarea
                className="font-mono"
                rows={4}
                defaultValue={"// vd: chạy workflow validate\nrun('validate_field', { value })"}
              />
            </FormField>
            <FormField label={t("field.on_submit_hook")}>
              <Select>
                <option>— none —</option>
                <option>w_approve_big_order</option>
              </Select>
            </FormField>
          </>
        )}
      </div>
    </aside>
  );
}
