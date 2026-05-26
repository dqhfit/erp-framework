import { useEffect, useState } from "react";
import { SchemaArgsForm } from "@/components/designer/SchemaArgsForm";
import { I } from "@/components/Icons";
import { Button, Chip, FormField, Modal, Select, Tabs } from "@/components/ui";
import { callMcpTool, useMcpClient } from "@/hooks/useMcpClient";
import { useT } from "@/hooks/useT";
import { type InferredField, inferSchema, normalizeRows, toFieldDefs } from "@/lib/schema-infer";
import type { FieldDef } from "@/types/entity";

/** Định dạng một ô dữ liệu để hiển thị trong bảng. */
function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export interface McpImportResult {
  fields: FieldDef[];
  mode: "replace" | "append";
  /** schema = chỉ field; snapshot = nhập kèm dữ liệu mẫu vào DB */
  dataMode: "schema" | "snapshot";
  /** Dòng dữ liệu mẫu (dùng khi dataMode = snapshot) */
  rows: Record<string, unknown>[];
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
  const t = useT();
  const { tools, connecting, error: mcpError } = useMcpClient();
  const [tool, setTool] = useState<string>("");
  const [argsObj, setArgsObj] = useState<Record<string, unknown>>({});
  const [step, setStep] = useState<Step>("select");
  const [loading, setLoading] = useState(false);
  const [inferred, setInferred] = useState<InferredField[]>([]);
  const [sampleData, setSampleData] = useState<unknown>(null);
  const [sampleRows, setSampleRows] = useState<Record<string, unknown>[]>([]);
  const [previewTab, setPreviewTab] = useState<"schema" | "data" | "raw">("schema");
  const [errMsg, setErrMsg] = useState("");
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [dataMode, setDataMode] = useState<"schema" | "snapshot">("schema");

  // Reset khi đóng / chọn tool khác
  useEffect(() => {
    if (!open) {
      setStep("select");
      setInferred([]);
      setErrMsg("");
      setSampleData(null);
      setSampleRows([]);
      setPreviewTab("schema");
      setDataMode("schema");
    }
  }, [open]);
  useEffect(() => {
    if (tools.length && !tool) setTool(tools[0]?.name ?? "");
  }, [tools, tool]);

  // Khi đổi tool → reset args + pre-fill default từ schema
  useEffect(() => {
    if (!tool) return;
    const tdef = tools.find((x) => x.name === tool);
    const props = tdef?.inputSchema?.properties ?? {};
    const defaults: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      const d = (v as { default?: unknown }).default;
      if (d !== undefined) defaults[k] = d;
    }
    setArgsObj(defaults);
  }, [tools.find, tool]);

  const fetchSample = async () => {
    if (!tool) return;
    setLoading(true);
    setErrMsg("");
    try {
      const data = await callMcpTool(tool, argsObj);
      const rows = normalizeRows(data);
      if (!rows.length) {
        setErrMsg(t("mcpimport.zero_rows"));
        setStep("error");
        return;
      }
      setSampleData(data);
      setSampleRows(rows as Record<string, unknown>[]);
      setInferred(inferSchema(rows));
      setPreviewTab("schema");
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
      dataMode,
      rows: sampleRows,
      tool,
      args: argsObj,
      availableTools: tools.map((tl) => tl.name),
    });
    onClose();
  };

  const selectedTool = tools.find((tl) => tl.name === tool);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("mcpimport.title")}
      width={700}
      footer={
        step === "preview" ? (
          <>
            <div className="flex items-center gap-2 text-xs mr-auto">
              <span className="text-muted">{t("mcpimport.apply_label")}</span>
              <button
                type="button"
                onClick={() => setMode("replace")}
                className={`chip ${mode === "replace" ? "chip-accent" : ""}`}
              >
                {t("mcpimport.mode_replace")}
              </button>
              <button
                type="button"
                onClick={() => setMode("append")}
                className={`chip ${mode === "append" ? "chip-accent" : ""}`}
              >
                {t("mcpimport.mode_append")}
              </button>
            </div>
            <Button variant="ghost" onClick={() => setStep("select")}>
              {t("mcpimport.back")}
            </Button>
            <Button variant="primary" onClick={handleApply} icon={<I.Check size={13} />}>
              {t("mcpimport.apply_n", {
                count: inferred.filter((i) => !i._skip).length,
              })}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        )
      }
    >
      {step === "select" && (
        <div className="space-y-4">
          {mcpError && (
            <div className="text-xs bg-danger/10 border border-danger/30 text-danger rounded-sm p-2">
              {t("mcpimport.mcp_error", { error: mcpError })}
            </div>
          )}
          <FormField
            label={t("mcpimport.tool_label")}
            hint={
              connecting
                ? t("mcpimport.connecting")
                : t("mcpimport.tools_count", { count: tools.length })
            }
          >
            <Select
              value={tool}
              onChange={(e) => setTool(e.target.value)}
              disabled={connecting || !tools.length}
            >
              {tools.length === 0 && <option value="">{t("mcpimport.no_tool")}</option>}
              {tools.map((tl) => (
                <option key={tl.name} value={tl.name}>
                  {tl.name}
                </option>
              ))}
            </Select>
          </FormField>
          {selectedTool?.description && (
            <div className="text-xs text-muted bg-bg-soft border border-border rounded-sm p-2">
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
            {loading ? t("mcpimport.calling") : t("mcpimport.fetch_btn")}
          </Button>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-3">
          <div className="text-sm">
            <span className="text-muted">{t("mcpimport.detected")}</span>{" "}
            <span className="font-semibold">
              {t("mcpimport.n_fields", { count: inferred.length })}
            </span>{" "}
            <span className="text-muted">{t("mcpimport.from")}</span>{" "}
            <span className="font-mono text-accent">{tool}</span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted">{t("mcpimport.data_apply")}</span>
            <button
              type="button"
              onClick={() => setDataMode("schema")}
              className={`chip ${dataMode === "schema" ? "chip-accent" : ""}`}
            >
              {t("mcpimport.data_schema_only")}
            </button>
            <button
              type="button"
              onClick={() => setDataMode("snapshot")}
              className={`chip ${dataMode === "snapshot" ? "chip-accent" : ""}`}
            >
              {t("mcpimport.data_snapshot", { count: sampleRows.length })}
            </button>
          </div>

          <Tabs
            value={previewTab}
            onChange={setPreviewTab}
            options={[
              { value: "schema", label: t("mcpimport.tab_schema", { count: inferred.length }) },
              { value: "data", label: t("mcpimport.tab_data", { count: sampleRows.length }) },
              { value: "raw", label: t("mcpimport.tab_raw") },
            ]}
          />

          {previewTab === "schema" && (
            <div className="border border-border rounded-sm overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-panel-2 text-muted uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-2 py-1.5">✓</th>
                    <th className="text-left px-2 py-1.5">Key</th>
                    <th className="text-left px-2 py-1.5">{t("mcpimport.col_label")}</th>
                    <th className="text-left px-2 py-1.5">{t("mcpimport.col_type")}</th>
                    <th className="text-left px-2 py-1.5">{t("mcpimport.col_sample")}</th>
                    <th className="text-right px-2 py-1.5" title={t("mcpimport.null_ratio")}>
                      {t("mcpimport.col_null")}
                    </th>
                    <th className="text-right px-2 py-1.5" title={t("mcpimport.unique_count")}>
                      {t("mcpimport.col_unique")}
                    </th>
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
                          className="input h-6! text-xs! px-1.5!"
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
                        {f.sample == null
                          ? "—"
                          : typeof f.sample === "object"
                            ? JSON.stringify(f.sample).slice(0, 50)
                            : String(f.sample).slice(0, 50)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-muted">
                        {f.nullCount}/{f.totalCount}
                      </td>
                      <td className="px-2 py-1.5 text-right text-muted">{f.uniqueCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {previewTab === "data" &&
            (inferred.length === 0 || sampleRows.length === 0 ? (
              <div className="text-xs text-muted p-3">{t("mcpimport.no_data")}</div>
            ) : (
              <div className="border border-border rounded-sm overflow-auto max-h-[340px]">
                <table className="w-full text-xs">
                  <thead className="bg-panel-2 text-muted uppercase tracking-wide">
                    <tr>
                      {inferred.map((f) => (
                        <th key={f.key} className="text-left px-2 py-1.5 whitespace-nowrap">
                          {f.label || f.key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sampleRows.slice(0, 50).map((row, ri) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: list ổn định, không reorder
                      <tr key={ri} className="border-t border-border hover:bg-hover/30">
                        {inferred.map((f) => {
                          const v = row[f.key];
                          const num = f.type === "number";
                          return (
                            <td
                              key={f.key}
                              className={`px-2 py-1.5 max-w-[220px] truncate ${num ? "text-right tabular-nums" : ""}`}
                              title={formatCell(v)}
                            >
                              {formatCell(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sampleRows.length > 50 && (
                  <div className="text-[11px] text-muted px-2 py-1 border-t border-border">
                    {t("mcpimport.rows_limit", { total: sampleRows.length })}
                  </div>
                )}
              </div>
            ))}

          {previewTab === "raw" && (
            <pre className="bg-bg-soft border border-border rounded-sm p-2 max-h-[340px] overflow-auto font-mono text-xs">
              {JSON.stringify(sampleData, null, 2).slice(0, 5000)}
            </pre>
          )}
        </div>
      )}

      {step === "error" && (
        <div className="text-center py-6">
          <div className="w-12 h-12 rounded-full bg-danger/15 text-danger flex items-center justify-center mx-auto mb-3">
            <I.AlertCircle size={24} />
          </div>
          <div className="font-semibold mb-1">{t("mcpimport.infer_fail")}</div>
          <pre className="text-xs text-danger bg-bg-soft border border-border rounded-sm p-2 mt-3 text-left max-h-[200px] overflow-auto">
            {errMsg}
          </pre>
          <Button variant="default" onClick={() => setStep("select")} className="mt-3">
            {t("mcpimport.retry")}
          </Button>
        </div>
      )}
    </Modal>
  );
}
