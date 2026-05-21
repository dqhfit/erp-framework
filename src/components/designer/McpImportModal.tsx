import { useState, useEffect } from "react";
import { useMcpClient, callMcpTool } from "@/hooks/useMcpClient";
import { normalizeRows, inferSchema, toFieldDefs, type InferredField } from "@/lib/schema-infer";
import { Modal, Button, Select, FormField, Chip } from "@/components/ui";
import { I } from "@/components/Icons";
import { SchemaArgsForm } from "@/components/designer/SchemaArgsForm";
import type { FieldDef } from "@/types/entity";

export interface McpImportResult {
  fields: FieldDef[];
  mode: "replace" | "append";
  /** Tool đã dùng để fetch sample */
  tool: string;
  /** Args đã gửi khi gọi tool */
  args: Record<string, unknown>;
  /** Tất cả tool name MCP hiện có — dùng để auto-match sibling op */
  availableTools: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (result: McpImportResult) => void;
}

type Step = "select" | "preview" | "error";

export function McpImportModal({ open, onClose, onApply }: Props) {
  const { tools, connecting, error: mcpError } = useMcpClient();
  const [tool, setTool] = useState<string>("");
  const [argsObj, setArgsObj] = useState<Record<string, unknown>>({});
  const [step, setStep] = useState<Step>("select");
  const [loading, setLoading] = useState(false);
  const [inferred, setInferred] = useState<InferredField[]>([]);
  const [sampleData, setSampleData] = useState<unknown>(null);
  const [errMsg, setErrMsg] = useState("");
  const [mode, setMode] = useState<"replace" | "append">("replace");

  // Reset khi đóng / chọn tool khác
  useEffect(() => {
    if (!open) {
      setStep("select"); setInferred([]); setErrMsg(""); setSampleData(null);
    }
  }, [open]);
  useEffect(() => {
    if (tools.length && !tool) setTool(tools[0]!.name);
  }, [tools, tool]);

  // Khi đổi tool → reset args + pre-fill default từ schema
  useEffect(() => {
    if (!tool) return;
    const t = tools.find((x) => x.name === tool);
    const props = t?.inputSchema?.properties ?? {};
    const defaults: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      const d = (v as { default?: unknown }).default;
      if (d !== undefined) defaults[k] = d;
    }
    setArgsObj(defaults);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const fetchSample = async () => {
    if (!tool) return;
    setLoading(true); setErrMsg("");
    try {
      const data = await callMcpTool(tool, argsObj);
      const rows = normalizeRows(data);
      if (!rows.length) {
        setErrMsg("Tool trả về 0 row — không thể infer schema");
        setStep("error");
        return;
      }
      setSampleData(data);
      setInferred(inferSchema(rows));
      setStep("preview");
    } catch (e) {
      setErrMsg((e as Error).message);
      setStep("error");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    const fields = toFieldDefs(inferred.filter((i) => !i._skip));
    onApply({
      fields,
      mode,
      tool,
      args: argsObj,
      availableTools: tools.map((t) => t.name),
    });
    onClose();
  };

  const selectedTool = tools.find((t) => t.name === tool);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import schema từ MCP"
      width={700}
      footer={
        step === "preview" ? (
          <>
            <div className="flex items-center gap-2 text-xs mr-auto">
              <span className="text-muted">Áp dụng:</span>
              <button
                onClick={() => setMode("replace")}
                className={`chip ${mode === "replace" ? "chip-accent" : ""}`}>
                Thay thế toàn bộ
              </button>
              <button
                onClick={() => setMode("append")}
                className={`chip ${mode === "append" ? "chip-accent" : ""}`}>
                Thêm vào sau
              </button>
            </div>
            <Button variant="ghost" onClick={() => setStep("select")}>← Quay lại</Button>
            <Button variant="primary" onClick={handleApply} icon={<I.Check size={13} />}>
              Áp dụng {inferred.filter((i) => !i._skip).length} fields
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
        )
      }
    >
      {step === "select" && (
        <div className="space-y-4">
          {mcpError && (
            <div className="text-xs bg-danger/10 border border-danger/30 text-danger rounded p-2">
              ⚠ MCP error: {mcpError}
            </div>
          )}
          <FormField label="MCP Tool" hint={connecting ? "Đang kết nối MCP..." : `${tools.length} tool có sẵn`}>
            <Select value={tool} onChange={(e) => setTool(e.target.value)} disabled={connecting || !tools.length}>
              {tools.length === 0 && <option value="">— chưa có tool —</option>}
              {tools.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </Select>
          </FormField>
          {selectedTool?.description && (
            <div className="text-xs text-muted bg-bg-soft border border-border rounded p-2">
              {selectedTool.description}
            </div>
          )}
          <SchemaArgsForm
            schema={selectedTool?.inputSchema}
            value={argsObj}
            onChange={setArgsObj}
          />
          <Button
            variant="primary"
            onClick={fetchSample}
            disabled={!tool || loading}
            icon={loading ? <I.Loader size={14} className="animate-spin" /> : <I.Play size={14} />}
            className="w-full justify-center"
          >
            {loading ? "Đang gọi tool..." : "Lấy sample + infer schema"}
          </Button>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-3">
          <div className="text-sm">
            <span className="text-muted">Phát hiện</span>{" "}
            <span className="font-semibold">{inferred.length} fields</span>{" "}
            <span className="text-muted">từ</span>{" "}
            <span className="font-mono text-accent">{tool}</span>
          </div>
          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-panel-2 text-muted uppercase tracking-wide">
                <tr>
                  <th className="text-left px-2 py-1.5">✓</th>
                  <th className="text-left px-2 py-1.5">Key</th>
                  <th className="text-left px-2 py-1.5">Label</th>
                  <th className="text-left px-2 py-1.5">Type</th>
                  <th className="text-left px-2 py-1.5">Sample</th>
                  <th className="text-right px-2 py-1.5" title="Tỷ lệ null">Null</th>
                  <th className="text-right px-2 py-1.5" title="Số giá trị unique">Unique</th>
                </tr>
              </thead>
              <tbody>
                {inferred.map((f, i) => (
                  <tr key={f.key} className="border-t border-border hover:bg-hover/30">
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={!f._skip}
                        onChange={(e) => {
                          const next = [...inferred];
                          next[i] = { ...f, _skip: !e.target.checked };
                          setInferred(next);
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-muted">{f.key}</td>
                    <td className="px-2 py-1.5">
                      <input
                        className="input !h-6 !text-xs !px-1.5"
                        value={f.label}
                        onChange={(e) => {
                          const next = [...inferred];
                          next[i] = { ...f, label: e.target.value };
                          setInferred(next);
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Chip variant="accent">{f.type}</Chip>
                    </td>
                    <td className="px-2 py-1.5 text-muted truncate max-w-[200px]">
                      {f.sample == null ? "—" : typeof f.sample === "object" ? JSON.stringify(f.sample).slice(0, 50) : String(f.sample).slice(0, 50)}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted">{f.nullCount}/{f.totalCount}</td>
                    <td className="px-2 py-1.5 text-right text-muted">{f.uniqueCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted">Xem raw response</summary>
            <pre className="mt-2 bg-bg-soft border border-border rounded p-2 max-h-[200px] overflow-auto font-mono">
              {JSON.stringify(sampleData, null, 2).slice(0, 2000)}
            </pre>
          </details>
        </div>
      )}

      {step === "error" && (
        <div className="text-center py-6">
          <div className="w-12 h-12 rounded-full bg-danger/15 text-danger flex items-center justify-center mx-auto mb-3">
            <I.AlertCircle size={24} />
          </div>
          <div className="font-semibold mb-1">Không infer được schema</div>
          <pre className="text-xs text-danger bg-bg-soft border border-border rounded p-2 mt-3 text-left max-h-[200px] overflow-auto">
            {errMsg}
          </pre>
          <Button variant="default" onClick={() => setStep("select")} className="mt-3">← Thử lại</Button>
        </div>
      )}
    </Modal>
  );
}
