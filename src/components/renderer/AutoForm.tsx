import { I } from "@/components/Icons";
import { Button, FormField, Input, Select, Switch, Textarea } from "@/components/ui";
import { useEnum } from "@/hooks/useEnum";
import { pickLabel } from "@/lib/enum-label";
import { useLocale } from "@/stores/locale";
import type { EntityDef, FieldDef } from "@/types/entity";
import { zodResolver } from "@hookform/resolvers/zod";
import { type FieldErrors, useForm } from "react-hook-form";
import { z } from "zod";

interface AutoFormProps {
  entity: EntityDef;
  defaultValues?: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  submitLabel?: string;
}

// Build Zod schema từ entity FieldDef
function buildZodSchema(entity: EntityDef) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of entity.fields) {
    let s: z.ZodTypeAny;
    switch (f.type) {
      case "number":
      case "integer":
        s = z.coerce.number();
        if (f.min !== undefined) s = (s as z.ZodNumber).min(f.min);
        if (f.max !== undefined) s = (s as z.ZodNumber).max(f.max);
        break;
      case "boolean":
        s = z.coerce.boolean();
        break;
      case "email":
        s = z.string().email("Email không hợp lệ");
        break;
      case "url":
        s = z.string().url("URL không hợp lệ");
        break;
      case "date":
      case "datetime":
      case "time":
        s = z.string();
        break;
      default:
        s = z.string();
    }
    if (!f.required) s = s.optional().or(z.literal(""));
    else if (s instanceof z.ZodString) s = s.min(1, `${f.label} là bắt buộc`);
    shape[f.key] = s;
  }
  return z.object(shape);
}

export function AutoForm({ entity, defaultValues, onSubmit, submitLabel }: AutoFormProps) {
  const schema = buildZodSchema(entity);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues:
      defaultValues ?? Object.fromEntries(entity.fields.map((f) => [f.key, f.default ?? ""])),
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
    } catch (e) {
      console.error(e);
    }
  });

  const errors: FieldErrors = form.formState.errors;

  return (
    <form onSubmit={submit} className="space-y-4">
      {entity.fields.length === 0 && (
        <div className="text-muted text-center py-6 text-sm">Schema chưa có field nào.</div>
      )}
      {entity.fields.map((f) => (
        <FieldRenderer
          key={f.key}
          field={f}
          register={form.register}
          error={errors[f.key]?.message as string | undefined}
          value={form.watch(f.key)}
          setValue={(v) => form.setValue(f.key, v)}
        />
      ))}
      {entity.fields.length > 0 && (
        <div className="pt-3 flex items-center justify-end gap-2 border-t border-border">
          <Button type="button" variant="ghost" onClick={() => form.reset()}>
            Hủy
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={form.formState.isSubmitting}
            icon={
              form.formState.isSubmitting ? (
                <I.Loader size={13} className="animate-spin" />
              ) : (
                <I.Save size={13} />
              )
            }
          >
            {submitLabel ?? `Lưu ${entity.label}`}
          </Button>
        </div>
      )}
    </form>
  );
}

interface FieldRendererProps {
  field: FieldDef;
  register: ReturnType<typeof useForm>["register"];
  error?: string;
  value: unknown;
  setValue: (v: unknown) => void;
}
function FieldRenderer({ field, register, error, value, setValue }: FieldRendererProps) {
  const label = field.label + (field.required ? " *" : "");
  const reg = register(field.key);

  return (
    <FormField label={label} hint={field.description} error={error}>
      {field.type === "textarea" ? (
        <Textarea rows={3} placeholder={field.placeholder} {...reg} />
      ) : field.type === "boolean" ? (
        <Switch checked={!!value} onChange={(v) => setValue(v)} label="Có / Không" />
      ) : field.type === "select" ? (
        <Select {...reg}>
          <option value="">— chọn —</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : field.type === "enum" ? (
        <EnumSelect enumId={field.enumId} reg={reg} />
      ) : field.type === "multi-enum" ? (
        <EnumMultiSelect
          enumId={field.enumId}
          value={Array.isArray(value) ? (value as string[]) : []}
          setValue={(vs) => setValue(vs)}
        />
      ) : field.type === "lookup" ? (
        <Input placeholder={field.placeholder ?? "ID record đích"} {...reg} />
      ) : field.type === "multi-lookup" ? (
        <MultiLookupInput
          value={Array.isArray(value) ? (value as string[]) : []}
          setValue={(vs) => setValue(vs)}
          placeholder={field.placeholder ?? "Nhập ID, ngăn cách bằng dấu phẩy"}
        />
      ) : field.type === "date" || field.type === "datetime" ? (
        <Input type={field.type === "datetime" ? "datetime-local" : "date"} {...reg} />
      ) : field.type === "time" ? (
        <Input type="time" {...reg} />
      ) : field.type === "number" || field.type === "integer" ? (
        <Input
          type="number"
          step={field.type === "integer" ? "1" : "any"}
          placeholder={field.placeholder}
          {...reg}
        />
      ) : field.type === "email" ? (
        <Input type="email" placeholder={field.placeholder ?? "name@example.com"} {...reg} />
      ) : field.type === "url" ? (
        <Input type="url" placeholder={field.placeholder ?? "https://"} {...reg} />
      ) : field.type === "file" || field.type === "image" ? (
        <Input type="file" accept={field.type === "image" ? "image/*" : undefined} {...reg} />
      ) : (
        <Input placeholder={field.placeholder} {...reg} />
      )}
    </FormField>
  );
}

/* ─── Enum renderers (đa ngôn ngữ — chọn nhãn theo locale) ─── */

interface EnumSelectProps {
  enumId?: string;
  reg: ReturnType<ReturnType<typeof useForm>["register"]>;
}
function EnumSelect({ enumId, reg }: EnumSelectProps) {
  const e = useEnum(enumId);
  const lang = useLocale((s) => s.lang);
  if (!enumId) return <div className="text-xs text-muted italic">Chưa cấu hình enum.</div>;
  if (!e) return <div className="text-xs text-muted italic">Đang tải enum...</div>;
  return (
    <Select {...reg}>
      <option value="">— chọn —</option>
      {e.values.map((v) => (
        <option key={v.value} value={v.value}>
          {pickLabel(v, lang)}
        </option>
      ))}
    </Select>
  );
}

interface EnumMultiSelectProps {
  enumId?: string;
  value: string[];
  setValue: (vs: string[]) => void;
}
/* Multi-lookup input — đơn giản nhập IDs cách bằng dấu phẩy; v2 sẽ thay
   bằng record picker thật khi có index records.search. */
interface MultiLookupInputProps {
  value: string[];
  setValue: (vs: string[]) => void;
  placeholder?: string;
}
function MultiLookupInput({ value, setValue, placeholder }: MultiLookupInputProps) {
  const text = value.join(", ");
  return (
    <Input
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const next = e.target.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        setValue(next);
      }}
    />
  );
}

function EnumMultiSelect({ enumId, value, setValue }: EnumMultiSelectProps) {
  const e = useEnum(enumId);
  const lang = useLocale((s) => s.lang);
  if (!enumId) return <div className="text-xs text-muted italic">Chưa cấu hình enum.</div>;
  if (!e) return <div className="text-xs text-muted italic">Đang tải enum...</div>;
  const toggle = (val: string) => {
    setValue(value.includes(val) ? value.filter((x) => x !== val) : [...value, val]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {e.values.map((v) => {
        const on = value.includes(v.value);
        return (
          <button
            key={v.value}
            type="button"
            onClick={() => toggle(v.value)}
            className={`chip ${on ? "chip-accent" : ""}`}
          >
            {pickLabel(v, lang)}
          </button>
        );
      })}
    </div>
  );
}
