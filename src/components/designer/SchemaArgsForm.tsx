/* ==========================================================
   SchemaArgsForm — Render form tự động từ JSON Schema
   của MCP tool.inputSchema. Hỗ trợ:
     - string (text / textarea theo format / enum → select)
     - number / integer
     - boolean → Switch
     - array (chuỗi cách bằng newline → JSON array)
     - object (textarea JSON raw)
     - không có schema → fallback 1 textarea JSON
   Ngoài ra có "Raw JSON" details để edit thẳng object.
   ========================================================== */
import { useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Chip, FormField, Input, Select, Switch } from "@/components/ui";

// JSON Schema shape lỏng — chỉ định nghĩa các field thường gặp
interface PropSchema {
  type?: string;
  description?: string;
  enum?: unknown[];
  format?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  items?: { type?: string };
}

interface InputSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

interface SchemaArgsFormProps {
  schema?: InputSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function SchemaArgsForm({ schema, value, onChange }: SchemaArgsFormProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [rawText, setRawText] = useState<string>(() => JSON.stringify(value, null, 2));
  const [rawError, setRawError] = useState<string | null>(null);

  const props = useMemo(() => {
    if (!schema?.properties) return [] as Array<[string, PropSchema]>;
    return Object.entries(schema.properties).map(
      ([k, v]) => [k, (v ?? {}) as PropSchema] as [string, PropSchema],
    );
  }, [schema]);

  const required = schema?.required ?? [];

  const set = (key: string, v: unknown) => {
    // null/undefined/"" → xoá khỏi args để giữ JSON gọn
    const next = { ...value };
    if (v === "" || v === null || v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
    setRawText(JSON.stringify(next, null, 2));
  };

  const applyRaw = () => {
    try {
      const parsed = JSON.parse(rawText || "{}");
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
        throw new Error("Phải là object JSON ở cấp ngoài cùng");
      }
      onChange(parsed);
      setRawError(null);
    } catch (e) {
      setRawError((e as Error).message);
    }
  };

  // Trường hợp tool không khai báo schema — fallback raw editor
  if (!props.length) {
    return (
      <FormField label="Args JSON" hint="Tool không khai báo input schema — gõ tay JSON nếu cần.">
        <textarea
          className="input font-mono text-xs"
          rows={3}
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value);
          }}
          onBlur={applyRaw}
          placeholder='{ "limit": 10 }'
        />
        {rawError && <div className="text-xs text-danger mt-1">⚠ {rawError}</div>}
      </FormField>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase text-muted tracking-wider font-semibold">
          Tham số gọi tool
        </div>
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="text-[11px] text-muted hover:text-text flex items-center gap-1 font-mono"
        >
          {"{}"} {showRaw ? "Ẩn" : "Xem"} JSON
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        {props.map(([key, p]) => (
          <PropField
            key={key}
            name={key}
            schema={p}
            required={required.includes(key)}
            value={value[key]}
            onChange={(v) => set(key, v)}
          />
        ))}
      </div>

      {showRaw && (
        <div className="space-y-1.5 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted">Raw JSON (edit + Blur để áp dụng)</span>
            <Button variant="ghost" size="sm" onClick={applyRaw} icon={<I.Check size={11} />}>
              Áp dụng
            </Button>
          </div>
          <textarea
            className="input font-mono text-xs"
            rows={4}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            onBlur={applyRaw}
          />
          {rawError && <div className="text-xs text-danger">⚠ {rawError}</div>}
        </div>
      )}
    </div>
  );
}

// ============= Single property =============
interface PropFieldProps {
  name: string;
  schema: PropSchema;
  required: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
}

function PropField({ name, schema, required, value, onChange }: PropFieldProps) {
  const t = schema.type ?? "string";
  const hint = schema.description;
  const label = (
    <span className="font-mono">
      {name}
      {required && <span className="text-danger ml-0.5">*</span>}
      <span className="text-muted text-[10px] ml-1.5 font-sans">({t})</span>
    </span>
  );

  // enum → Select
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return (
      <FormField label={label} hint={hint}>
        <Select
          value={value == null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        >
          {!required && <option value="">— bỏ trống —</option>}
          {schema.enum.map((opt, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: list ổn định, không reorder
            <option key={i} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </Select>
      </FormField>
    );
  }

  // boolean → Switch
  if (t === "boolean") {
    return (
      <FormField label={label} hint={hint}>
        <Switch
          checked={value === true}
          onChange={(v) => onChange(v)}
          label={value === true ? "true" : "false"}
        />
      </FormField>
    );
  }

  // number / integer → number input
  if (t === "number" || t === "integer") {
    return (
      <FormField label={label} hint={hint}>
        <Input
          type="number"
          step={t === "integer" ? 1 : "any"}
          min={schema.minimum}
          max={schema.maximum}
          value={value == null ? "" : String(value)}
          onChange={(e) => {
            const s = e.target.value;
            if (s === "") return onChange(undefined);
            const n = Number(s);
            onChange(Number.isFinite(n) ? n : s);
          }}
          placeholder={schema.default != null ? `default: ${schema.default}` : ""}
        />
      </FormField>
    );
  }

  // array → newline-separated; convert items theo schema.items.type
  if (t === "array") {
    const itemType = schema.items?.type ?? "string";
    const text = Array.isArray(value) ? value.join("\n") : "";
    return (
      <FormField label={label} hint={hint ?? `Mỗi dòng một phần tử (${itemType})`}>
        <textarea
          className="input font-mono text-xs"
          rows={2}
          value={text}
          onChange={(e) => {
            const lines = e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s !== "");
            if (lines.length === 0) return onChange(undefined);
            if (itemType === "number" || itemType === "integer") {
              onChange(lines.map((s) => Number(s)));
            } else if (itemType === "boolean") {
              onChange(lines.map((s) => s === "true"));
            } else {
              onChange(lines);
            }
          }}
          placeholder="item1&#10;item2"
        />
      </FormField>
    );
  }

  // object → raw JSON
  if (t === "object") {
    return (
      <FormField label={label} hint={hint ?? "JSON object"}>
        <textarea
          className="input font-mono text-xs"
          rows={3}
          value={value ? JSON.stringify(value, null, 2) : ""}
          onChange={(e) => {
            const s = e.target.value;
            if (!s.trim()) return onChange(undefined);
            try {
              onChange(JSON.parse(s));
            } catch {
              /* keep current value, wait for valid JSON */
            }
          }}
          placeholder='{ "key": "value" }'
        />
      </FormField>
    );
  }

  // string + format → date / datetime / textarea cho long
  if (t === "string") {
    const fmt = schema.format;
    if (fmt === "date") {
      return (
        <FormField label={label} hint={hint}>
          <Input
            type="date"
            value={value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </FormField>
      );
    }
    if (fmt === "date-time" || fmt === "datetime") {
      return (
        <FormField label={label} hint={hint}>
          <Input
            type="datetime-local"
            value={value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </FormField>
      );
    }
    // Long text: nếu hint dài hoặc tên gợi ý
    const isLong = /description|content|body|note|prompt/i.test(name);
    if (isLong) {
      return (
        <FormField label={label} hint={hint}>
          <textarea
            className="input font-mono text-xs"
            rows={2}
            value={value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value || undefined)}
            placeholder={schema.default != null ? `default: ${schema.default}` : ""}
          />
        </FormField>
      );
    }
    return (
      <FormField label={label} hint={hint}>
        <Input
          value={value == null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder={schema.default != null ? `default: ${schema.default}` : `nhập ${name}...`}
        />
      </FormField>
    );
  }

  // Unknown type → string fallback + warning
  return (
    <FormField
      label={
        <span className="font-mono">
          {name} <Chip variant="warning">{t}</Chip>
        </span>
      }
      hint={hint ?? "Kiểu dữ liệu chưa hỗ trợ — gõ tay"}
    >
      <Input
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    </FormField>
  );
}
