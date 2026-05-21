/* ==========================================================
   McpBindingsEditor — Editor cho mapping arg của 5 op MCP.
   - Mỗi op (list/get/create/update/delete) có:
       tool: string (tên MCP tool)
       args: Array<{ key, kind: 'literal'|'field'|'formula', value }>
   - UI: collapsible card cho từng op, table args, picker.
   ========================================================== */
import { useMemo, useState } from "react";
import { Button, Card, Chip, FormField, Input, Select } from "@/components/ui";
import { I } from "@/components/Icons";
import { cn } from "@/lib/utils";

export type McpOp = "list" | "get" | "create" | "update" | "delete";
export type ArgKind = "literal" | "field" | "formula";

export interface McpArg {
  key: string;
  kind: ArgKind;
  value: string; // literal text / field name / formula expression
}

export interface McpOpBinding {
  tool?: string;
  args: McpArg[];
}

export type McpBindings = Partial<Record<McpOp, McpOpBinding>>;

interface McpBindingsEditorProps {
  /** Bindings hiện tại của entity */
  value: McpBindings;
  onChange: (next: McpBindings) => void;
  /** Field keys của entity → dropdown nguồn "field" */
  fieldKeys: string[];
  /** Available MCP tool names (từ McpClient.listTools) */
  availableTools?: string[];
  /** Prefix gợi ý (vd: "crm.customer") */
  toolPrefix?: string;
}

const OPS: McpOp[] = ["list", "get", "create", "update", "delete"];
const OP_HINT: Record<McpOp, string> = {
  list:   "Liệt kê / search bản ghi. Args thường: filter, limit, offset, sort.",
  get:    "Lấy 1 bản ghi theo PK. Args thường: id.",
  create: "Tạo mới. Args = data fields cần ghi.",
  update: "Cập nhật. Args thường: id + các field cần đổi.",
  delete: "Xoá. Args thường: id.",
};
const OP_COLOR: Record<McpOp, string> = {
  list:   "text-accent",
  get:    "text-accent-2",
  create: "text-success",
  update: "text-warning",
  delete: "text-danger",
};

const DEFAULT_ARGS: Record<McpOp, McpArg[]> = {
  list:   [{ key: "limit", kind: "literal", value: "50" }],
  get:    [{ key: "id",    kind: "field",   value: "id" }],
  create: [],
  update: [{ key: "id",    kind: "field",   value: "id" }],
  delete: [{ key: "id",    kind: "field",   value: "id" }],
};

export function McpBindingsEditor({
  value, onChange, fieldKeys, availableTools = [], toolPrefix = "",
}: McpBindingsEditorProps) {
  const [openOp, setOpenOp] = useState<McpOp | null>("list");

  const update = (op: McpOp, patch: Partial<McpOpBinding>) => {
    const cur = value[op] ?? { tool: "", args: [] };
    onChange({ ...value, [op]: { ...cur, ...patch } });
  };

  const ensureBinding = (op: McpOp): McpOpBinding => {
    if (value[op]) return value[op]!;
    const initial: McpOpBinding = {
      tool: toolPrefix ? `${toolPrefix}.${op}` : "",
      args: DEFAULT_ARGS[op] ?? [],
    };
    onChange({ ...value, [op]: initial });
    return initial;
  };

  return (
    <div className="space-y-2">
      {OPS.map((op) => {
        const binding = value[op];
        const isOpen = openOp === op;
        const argCount = binding?.args?.length ?? 0;
        return (
          <Card key={op} className={cn("p-0 overflow-hidden", isOpen && "border-accent/50")}>
            <button
              type="button"
              onClick={() => {
                if (!binding) ensureBinding(op);
                setOpenOp(isOpen ? null : op);
              }}
              className="w-full px-3 h-11 flex items-center gap-3 hover:bg-hover/30 transition-colors"
            >
              <div className={cn("w-16 font-mono text-xs uppercase font-semibold", OP_COLOR[op])}>{op}</div>
              <I.ArrowRight size={11} className="text-muted shrink-0" />
              <div className="flex-1 text-sm font-mono text-left truncate">
                {binding?.tool || <span className="text-muted italic">— chưa map —</span>}
              </div>
              {binding?.tool && (
                <Chip variant="success">{argCount} args</Chip>
              )}
              <I.ChevronDown size={12} className={cn("text-muted transition-transform", isOpen && "rotate-180")} />
            </button>

            {isOpen && (
              <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border bg-bg-soft/30">
                <p className="text-xs text-muted">{OP_HINT[op]}</p>

                {/* Tool picker */}
                <FormField label="MCP Tool">
                  <div className="flex gap-2">
                    {availableTools.length > 0 ? (
                      <Select
                        value={binding?.tool ?? ""}
                        onChange={(e) => update(op, { tool: e.target.value })}
                      >
                        <option value="">— chọn tool —</option>
                        {availableTools.map((t) => <option key={t} value={t}>{t}</option>)}
                      </Select>
                    ) : (
                      <Input
                        className="font-mono"
                        value={binding?.tool ?? ""}
                        onChange={(e) => update(op, { tool: e.target.value })}
                        placeholder={toolPrefix ? `${toolPrefix}.${op}` : `entity.${op}`}
                      />
                    )}
                  </div>
                </FormField>

                {/* Args table */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[11px] uppercase text-muted tracking-wider">Tham số</div>
                    <Button
                      variant="ghost" size="sm"
                      icon={<I.Plus size={11} />}
                      onClick={() => {
                        const args = [...(binding?.args ?? []), { key: "", kind: "literal" as ArgKind, value: "" }];
                        update(op, { args });
                      }}
                    >
                      Thêm arg
                    </Button>
                  </div>

                  <ArgsTable
                    args={binding?.args ?? []}
                    fieldKeys={fieldKeys}
                    onChange={(args) => update(op, { args })}
                  />
                </div>

                {/* Preview JSON */}
                <PreviewBox binding={binding ?? { args: [] }} />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ============= Args Table =============
interface ArgsTableProps {
  args: McpArg[];
  fieldKeys: string[];
  onChange: (next: McpArg[]) => void;
}
function ArgsTable({ args, fieldKeys, onChange }: ArgsTableProps) {
  if (args.length === 0) {
    return <div className="text-xs text-muted italic p-3 border border-dashed border-border rounded text-center">Chưa có arg</div>;
  }
  const upd = (idx: number, patch: Partial<McpArg>) => {
    onChange(args.map((a, i) => i === idx ? { ...a, ...patch } : a));
  };
  const del = (idx: number) => onChange(args.filter((_, i) => i !== idx));

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="grid grid-cols-[1fr_120px_2fr_28px] text-[10px] uppercase text-muted bg-panel-2 px-2 py-1 gap-2">
        <div>Key</div>
        <div>Nguồn</div>
        <div>Giá trị</div>
        <div></div>
      </div>
      {args.map((a, i) => (
        <div key={i} className="grid grid-cols-[1fr_120px_2fr_28px] gap-2 px-2 py-1.5 border-t border-border items-center">
          <Input
            className="h-8 text-xs font-mono"
            value={a.key}
            onChange={(e) => upd(i, { key: e.target.value })}
            placeholder="param_name"
          />
          <Select
            className="h-8 text-xs"
            value={a.kind}
            onChange={(e) => upd(i, { kind: e.target.value as ArgKind, value: "" })}
          >
            <option value="literal">Literal</option>
            <option value="field">Field</option>
            <option value="formula">Formula</option>
          </Select>
          {a.kind === "field" ? (
            <Select
              className="h-8 text-xs font-mono"
              value={a.value}
              onChange={(e) => upd(i, { value: e.target.value })}
            >
              <option value="">— chọn field —</option>
              {fieldKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
          ) : (
            <Input
              className="h-8 text-xs font-mono"
              value={a.value}
              onChange={(e) => upd(i, { value: e.target.value })}
              placeholder={a.kind === "formula" ? "{price} * 1.1" : `value cho ${a.key || "?"}`}
            />
          )}
          <Button variant="ghost" size="sm" icon={<I.Trash size={10} />} onClick={() => del(i)} />
        </div>
      ))}
    </div>
  );
}

// ============= Preview =============
function PreviewBox({ binding }: { binding: McpOpBinding }) {
  const preview = useMemo(() => {
    const args: Record<string, unknown> = {};
    for (const a of binding.args ?? []) {
      if (!a.key) continue;
      if (a.kind === "literal") {
        // Try parse as JSON literal (số / bool / null), không thì giữ string
        const v = a.value;
        if (v === "true") args[a.key] = true;
        else if (v === "false") args[a.key] = false;
        else if (v === "null") args[a.key] = null;
        else if (v !== "" && !Number.isNaN(Number(v))) args[a.key] = Number(v);
        else args[a.key] = v;
      } else if (a.kind === "field") {
        args[a.key] = `<row.${a.value || "?"}>`;
      } else {
        args[a.key] = `<formula: ${a.value || "?"}>`;
      }
    }
    return { tool: binding.tool, args };
  }, [binding]);

  return (
    <div className="rounded-md border border-border bg-bg p-2 text-xs">
      <div className="text-[10px] uppercase text-muted mb-1 tracking-wider">Preview JSON-RPC call</div>
      <pre className="font-mono text-[11px] leading-relaxed text-text whitespace-pre-wrap break-all m-0">
{JSON.stringify(preview, null, 2)}
      </pre>
    </div>
  );
}
