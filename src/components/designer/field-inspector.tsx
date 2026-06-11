/* ==========================================================
   field-inspector.tsx — Inspector bên phải EntityDesigner.
   3 tab inline: Data (props field + RBAC + formula), Style, Events.
   Tách khỏi EntityDesigner.tsx (P2.7 refactor).
   ========================================================== */

import { EnumPicker } from "@/components/designer/EnumPicker";
import { FormulaEditor } from "@/components/designer/FormulaEditor";
import { sampleValueFor } from "@/components/designer/field-row";
import { I } from "@/components/Icons";
import { FormField, Input, Select, Switch, Tabs, Textarea } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { FALLBACK_FIELD_TYPE, ftLabel, getFieldTypes } from "@/lib/field-types";
import type { EntityField, FieldFormat } from "@/lib/object-types";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";

/** Áp dụng FieldFormat lên một giá trị mẫu để xem trước. */
function previewFormat(type: string, fmt: FieldFormat | undefined): string {
  if (!fmt) return "";
  if (type === "number" || type === "integer" || type === "currency" || type === "formula") {
    const raw = type === "currency" ? 1500000 : 12345.6;
    const decimals = fmt.decimals ?? (type === "currency" ? 0 : 2);
    let s = raw.toFixed(decimals);
    // Thousand separator
    const sep = fmt.thousandSep ?? (type === "currency" ? "period" : "none");
    if (sep !== "none") {
      const sepChar = sep === "comma" ? "," : sep === "period" ? "." : " ";
      const decChar = sep === "comma" ? "." : ",";
      const [intPart, decPart] = s.split(".");
      s =
        (intPart ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, sepChar) +
        (decPart !== undefined ? decChar + decPart : "");
    }
    const sym = fmt.currencySymbol ?? (type === "currency" ? "₫" : "");
    const pos = fmt.symbolPosition ?? "after";
    const withSym = sym ? (pos === "before" ? sym + s : s + sym) : s;
    return (fmt.prefix ?? "") + withSym + (fmt.suffix ?? "");
  }
  if (type === "date") {
    const f = fmt.dateFormat ?? "dd/MM/yyyy";
    if (f === "relative") return "2 ngày trước";
    return f.replace("dd", "25").replace("MM", "12").replace("yyyy", "2025");
  }
  if (type === "datetime") {
    const df = (fmt.dateFormat ?? "dd/MM/yyyy")
      .replace("dd", "25")
      .replace("MM", "12")
      .replace("yyyy", "2025");
    if (fmt.timeFormat === "relative") return "3 giờ trước";
    const tf = (fmt.timeFormat ?? "HH:mm")
      .replace("HH", "14")
      .replace("mm", "30")
      .replace("ss", "00")
      .replace("hh", "02")
      .replace("a", "PM");
    return `${df} ${tf}`;
  }
  if (type === "text" || type === "longtext") {
    const sample = "ví dụ văn bản";
    if (fmt.textTransform === "uppercase") return sample.toUpperCase();
    if (fmt.textTransform === "lowercase") return sample.toLowerCase();
    if (fmt.textTransform === "capitalize") return sample.replace(/\b\w/g, (c) => c.toUpperCase());
    return sample;
  }
  if (type === "bool" || type === "boolean") {
    return `${fmt.trueLabel ?? "Có"} / ${fmt.falseLabel ?? "Không"}`;
  }
  return "";
}

// ===== FieldFormatSection =====
interface FormatSectionProps {
  field: EntityField;
  onUpdate: (patch: Partial<EntityField>) => void;
  t: (k: string) => string;
}

function FieldFormatSection({ field, onUpdate, t }: FormatSectionProps) {
  const fmt = field.format ?? {};
  const upd = (patch: Partial<FieldFormat>) => onUpdate({ format: { ...fmt, ...patch } });

  const isNumeric = ["number", "integer", "currency", "formula"].includes(field.type);
  const isDate = field.type === "date";
  const isDatetime = field.type === "datetime";
  const isText = field.type === "text" || field.type === "longtext";
  const isBool = field.type === "bool" || field.type === "boolean";
  const isCurrency = field.type === "currency";

  if (!isNumeric && !isDate && !isDatetime && !isText && !isBool) return null;

  const preview = previewFormat(field.type, fmt);

  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold pt-1 border-t border-border">
        {t("field.format")}
      </div>

      {/* Xem trước */}
      {preview && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent/8 border border-accent/20">
          <I.Eye size={12} className="text-accent shrink-0" />
          <span className="text-sm font-mono text-accent">{preview}</span>
        </div>
      )}

      {/* Số thập phân (number / currency) */}
      {isNumeric && (
        <FormField label={t("field.format_decimals")}>
          <Select
            value={String(fmt.decimals ?? (isCurrency ? 0 : 2))}
            onChange={(e) => upd({ decimals: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </FormField>
      )}

      {/* Phân cách nghìn */}
      {isNumeric && (
        <FormField label={t("field.format_thousand_sep")}>
          <Select
            value={fmt.thousandSep ?? (isCurrency ? "period" : "none")}
            onChange={(e) => upd({ thousandSep: e.target.value as FieldFormat["thousandSep"] })}
          >
            <option value="none">{t("field.format_sep_none")}</option>
            <option value="comma">{t("field.format_sep_comma")}</option>
            <option value="period">{t("field.format_sep_period")}</option>
            <option value="space">{t("field.format_sep_space")}</option>
          </Select>
        </FormField>
      )}

      {/* Currency: ký hiệu + vị trí */}
      {isCurrency && (
        <>
          <FormField label={t("field.format_currency_symbol")}>
            <div className="flex gap-1.5">
              {["₫", "$", "€", "£", "¥"].map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => upd({ currencySymbol: sym })}
                  className={cn(
                    "flex-1 h-8 rounded border text-sm font-mono transition-colors",
                    (fmt.currencySymbol ?? "₫") === sym
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border hover:bg-hover",
                  )}
                >
                  {sym}
                </button>
              ))}
              <Input
                className="w-14 font-mono text-center"
                maxLength={4}
                placeholder="..."
                value={
                  !["₫", "$", "€", "£", "¥"].includes(fmt.currencySymbol ?? "₫")
                    ? (fmt.currencySymbol ?? "")
                    : ""
                }
                onChange={(e) => e.target.value && upd({ currencySymbol: e.target.value })}
              />
            </div>
          </FormField>
          <FormField label={t("field.format_symbol_pos")}>
            <div className="grid grid-cols-2 gap-1">
              {(["before", "after"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => upd({ symbolPosition: pos })}
                  className={cn(
                    "h-8 rounded border text-xs transition-colors",
                    (fmt.symbolPosition ?? "after") === pos
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border hover:bg-hover",
                  )}
                >
                  {t(pos === "before" ? "field.format_symbol_before" : "field.format_symbol_after")}
                </button>
              ))}
            </div>
          </FormField>
        </>
      )}

      {/* Prefix / Suffix */}
      {isNumeric && (
        <div className="grid grid-cols-2 gap-2">
          <FormField label={t("field.format_prefix")}>
            <Input
              value={fmt.prefix ?? ""}
              placeholder="vd: +"
              onChange={(e) => upd({ prefix: e.target.value })}
            />
          </FormField>
          <FormField label={t("field.format_suffix")}>
            <Input
              value={fmt.suffix ?? ""}
              placeholder="vd: kg"
              onChange={(e) => upd({ suffix: e.target.value })}
            />
          </FormField>
        </div>
      )}

      {/* Date format */}
      {(isDate || isDatetime) && (
        <FormField label={t("field.format_date")}>
          <Select
            value={fmt.dateFormat ?? "dd/MM/yyyy"}
            onChange={(e) => upd({ dateFormat: e.target.value as FieldFormat["dateFormat"] })}
          >
            <option value="dd/MM/yyyy">dd/MM/yyyy</option>
            <option value="MM/dd/yyyy">MM/dd/yyyy</option>
            <option value="yyyy-MM-dd">yyyy-MM-dd (ISO)</option>
            <option value="relative">Tương đối (2 ngày trước)</option>
          </Select>
        </FormField>
      )}

      {/* Time format (datetime only) */}
      {isDatetime && (
        <FormField label={t("field.format_time")}>
          <Select
            value={fmt.timeFormat ?? "HH:mm"}
            onChange={(e) => upd({ timeFormat: e.target.value as FieldFormat["timeFormat"] })}
          >
            <option value="HH:mm">HH:mm (24h)</option>
            <option value="HH:mm:ss">HH:mm:ss</option>
            <option value="hh:mm a">hh:mm a (AM/PM)</option>
            <option value="relative">{t("field.format_time_relative")}</option>
          </Select>
        </FormField>
      )}

      {/* Text transform */}
      {isText && (
        <FormField label={t("field.format_text_transform")}>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                ["none", "field.format_transform_none"],
                ["uppercase", "field.format_transform_upper"],
                ["lowercase", "field.format_transform_lower"],
                ["capitalize", "field.format_transform_capitalize"],
              ] as const
            ).map(([val, key]) => (
              <button
                key={val}
                type="button"
                onClick={() => upd({ textTransform: val })}
                className={cn(
                  "h-8 rounded border text-xs transition-colors",
                  (fmt.textTransform ?? "none") === val
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border hover:bg-hover",
                )}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </FormField>
      )}

      {/* Boolean labels */}
      {isBool && (
        <div className="grid grid-cols-2 gap-2">
          <FormField label={t("field.format_true_label")}>
            <Input
              value={fmt.trueLabel ?? ""}
              placeholder="Có"
              onChange={(e) => upd({ trueLabel: e.target.value })}
            />
          </FormField>
          <FormField label={t("field.format_false_label")}>
            <Input
              value={fmt.falseLabel ?? ""}
              placeholder="Không"
              onChange={(e) => upd({ falseLabel: e.target.value })}
            />
          </FormField>
        </div>
      )}
    </div>
  );
}

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
  const viewerGroupsList = useUserObjects((s) => s.viewerGroupsList);
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
  const ft =
    getFieldTypes().find((f) => f.id === field.type) ?? getFieldTypes()[0] ?? FALLBACK_FIELD_TYPE;
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
                {getFieldTypes().map((ft) => (
                  <option key={ft.id} value={ft.id}>
                    {ftLabel(ft, t)}
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
                <Switch checked={!!field.unique} onChange={(v) => onUpdate({ unique: v })} />
              </div>
              <div className="col-span-2 flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                <div className="flex flex-col leading-tight">
                  <span className="text-sm">{t("field.default_visible")}</span>
                  <span className="text-[11px] text-muted">{t("field.default_visible_hint")}</span>
                </div>
                <Switch
                  checked={field.defaultVisible !== false}
                  onChange={(v) => onUpdate({ defaultVisible: v })}
                />
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
              <FormField label={t("field.enum")} hint={t("field.enum_hint")}>
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
                <FormField label={t("field.on_delete")} hint={t("field.on_delete_hint")}>
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

            {field.type === "collection" && (
              <>
                <FormField
                  label="Entity con (1-N)"
                  hint="Bảng con chứa các record thuộc về record cha hiện tại."
                >
                  <Select
                    value={field.ref ?? ""}
                    onChange={(e) => onUpdate({ ref: e.target.value })}
                  >
                    <option value="">— chọn entity con —</option>
                    {userEntities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField
                  label="Field FK trên entity con"
                  hint="Field trên entity con trỏ ngược về parent (vd 'don_hang_id')."
                >
                  <Select
                    value={field.fkField ?? ""}
                    onChange={(e) => onUpdate({ fkField: e.target.value })}
                    disabled={!field.ref}
                  >
                    <option value="">— chọn field —</option>
                    {(() => {
                      const child = userEntities.find((e) => e.id === field.ref);
                      const lookups = (child?.fields ?? []).filter(
                        (f) => f.type === "lookup" || f.type === "multi-lookup",
                      );
                      return lookups.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.name} ({f.label})
                        </option>
                      ));
                    })()}
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
                    checked={!!field.searchable}
                    onChange={(e) =>
                      onUpdate({ searchable: e.target.checked } as Partial<EntityField>)
                    }
                  />
                  {t("field.searchable")}
                </label>
              </div>
            </FormField>
            <FormField label={t("field.read_rbac")} hint={t("field.read_rbac_hint")}>
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
            {/* RBAC theo NHÓM người dùng — tầng 2 sau role (admin bypass).
                Rỗng = mọi nhóm. Có tick = user phải thuộc ít nhất 1 nhóm. */}
            {viewerGroupsList.length > 0 && (
              <>
                <FormField
                  label="Nhóm được đọc"
                  hint="Rỗng = mọi nhóm. Tick = chỉ thành viên nhóm (admin luôn được)."
                >
                  <div className="flex flex-wrap gap-2 text-sm">
                    {viewerGroupsList.map((g) => {
                      const cur = field.readableByGroups ?? [];
                      const on = cur.includes(g.id);
                      return (
                        <label key={g.id} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) =>
                              onUpdate({
                                readableByGroups: e.target.checked
                                  ? [...cur, g.id]
                                  : cur.filter((x) => x !== g.id),
                              } as Partial<EntityField>)
                            }
                          />
                          {g.name}
                        </label>
                      );
                    })}
                  </div>
                </FormField>
                <FormField
                  label="Nhóm được ghi"
                  hint="Vd: tổ kế toán sửa được giá, tổ kho thì không."
                >
                  <div className="flex flex-wrap gap-2 text-sm">
                    {viewerGroupsList.map((g) => {
                      const cur = field.writableByGroups ?? [];
                      const on = cur.includes(g.id);
                      return (
                        <label key={g.id} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) =>
                              onUpdate({
                                writableByGroups: e.target.checked
                                  ? [...cur, g.id]
                                  : cur.filter((x) => x !== g.id),
                              } as Partial<EntityField>)
                            }
                          />
                          {g.name}
                        </label>
                      );
                    })}
                  </div>
                </FormField>
              </>
            )}

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

            <FieldFormatSection field={field} onUpdate={onUpdate} t={t} />
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
