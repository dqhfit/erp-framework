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
          Inspector
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
          title="Delete field"
        >
          <I.Trash size={13} />
        </button>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "data", label: "Data" },
          { value: "style", label: "Style" },
          { value: "events", label: "Events" },
        ]}
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === "data" && (
          <>
            <FormField label={t("field.label")}>
              <Input value={field.label} onChange={(e) => onUpdate({ label: e.target.value })} />
            </FormField>
            <FormField label="Label (en)" hint="i18n nhãn tiếng Anh — vắng = fallback xuống label">
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
                <span className="text-sm">Required</span>
                <Switch checked={!!field.required} onChange={(v) => onUpdate({ required: v })} />
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                <span className="text-sm">Unique</span>
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
                label="Enum"
                hint="Chọn enum tái sử dụng từ /enums. Nhãn vi/en lấy theo locale."
              >
                <EnumPicker value={field.enumId} onChange={(id) => onUpdate({ enumId: id })} />
              </FormField>
            )}

            {(field.type === "lookup" || field.type === "multi-lookup") && (
              <>
                <FormField label="Reference entity">
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
                  label="Khi record đích bị xoá"
                  hint="restrict: chặn xoá (mặc định) · setnull: xoá ref · cascade: soft-delete chuỗi"
                >
                  <Select
                    value={(field as { onDelete?: string }).onDelete ?? "restrict"}
                    onChange={(e) => onUpdate({ onDelete: e.target.value } as Partial<EntityField>)}
                  >
                    <option value="restrict">Restrict (chặn)</option>
                    <option value="setnull">Set null</option>
                    <option value="cascade">Cascade (xoá chuỗi)</option>
                  </Select>
                </FormField>
              </>
            )}

            {field.type === "sequence" && (
              <>
                <FormField label="Prefix" hint='vd "INV-" → INV-0001'>
                  <Input
                    value={field.sequencePrefix ?? ""}
                    placeholder="INV-"
                    onChange={(e) =>
                      onUpdate({ sequencePrefix: e.target.value } as Partial<EntityField>)
                    }
                  />
                </FormField>
                <FormField label="Padding" hint="Số chữ số tối thiểu, vd 4 → 0001">
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
            <FormField label="Governance">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!field.unique}
                    onChange={(e) => onUpdate({ unique: e.target.checked } as Partial<EntityField>)}
                  />
                  Unique (chặn trùng giá trị)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!field.searchable}
                    onChange={(e) =>
                      onUpdate({ searchable: e.target.checked } as Partial<EntityField>)
                    }
                  />
                  Searchable (full-text search)
                </label>
              </div>
            </FormField>
            <FormField
              label="Đọc bởi (Read RBAC)"
              hint="Bỏ chọn hết = mọi role có quyền entity đều đọc"
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
            <FormField label="Ghi bởi (Write RBAC)" hint="Tương tự, bỏ chọn = mở">
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
            <FormField label="Width">
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
            <FormField label="Placeholder">
              <Input />
            </FormField>
            <FormField label={t("field.help_pos")}>
              <Select defaultValue="below">
                <option value="below">{t("field.help_below")}</option>
                <option value="tooltip">Trong tooltip</option>
              </Select>
            </FormField>
          </>
        )}

        {tab === "events" && (
          <>
            <FormField label="onChange">
              <Textarea
                className="font-mono"
                rows={4}
                defaultValue={"// vd: chạy workflow validate\nrun('validate_field', { value })"}
              />
            </FormField>
            <FormField label="onSubmit hook">
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
