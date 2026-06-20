/* DiagramTab — sơ đồ ERD module (ReactFlow) + đổi tên/kind node + AI
   normalize names. Tách từ settings.migration.tsx (pilot refactor). */
import { createMigrationClient } from "@erp-framework/client";
import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { ErrorHint } from "@/components/migration/ErrorHint";
import { Button, Card, Chip, EmptyState, FormField, Input, Modal } from "@/components/ui";
import { useT } from "@/hooks/useT";

const migration = createMigrationClient("");

interface DiagramNode {
  id: string;
  kind: "entity" | "enum";
  entityName: string;
  label: string;
  fieldCount: number;
  enumValueCount: number;
}
interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  column: string;
  refColumn: string;
}

export function DiagramTab({
  moduleName,
  onChanged,
}: {
  moduleName: string;
  onChanged: () => void;
}) {
  const t = useT();
  const [data, setData] = useState<{ nodes: DiagramNode[]; edges: DiagramEdge[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    migration
      .getDiagram(moduleName)
      .then(setData)
      .catch(() => setData(null));
  }, [moduleName]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return <div className="text-sm text-muted p-4">{t("mig.diagram_loading")}</div>;
  }
  if (data.nodes.length === 0) {
    return (
      <EmptyState
        icon={<I.GitBranch size={28} />}
        title={t("mig.diagram_empty_title")}
        hint={t("mig.diagram_empty_hint")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 h-[calc(100vh-12rem)]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted">
          {t("mig.diagram_stats", {
            tables: data.nodes.length,
            entities: data.nodes.filter((n) => n.kind === "entity").length,
            enums: data.nodes.filter((n) => n.kind === "enum").length,
            edges: data.edges.length,
          })}
        </div>
        <NormalizeNamesButton
          moduleName={moduleName}
          onApplied={() => {
            load();
            onChanged();
          }}
        />
      </div>
      <div className="grid grid-cols-[1fr_300px] gap-3 flex-1 min-h-0">
        <DiagramCanvas data={data} selectedId={selectedId} onSelect={setSelectedId} />
        <DiagramSidebar
          moduleName={moduleName}
          node={data.nodes.find((n) => n.id === selectedId) ?? null}
          allNodes={data.nodes}
          onApplied={() => {
            load();
            onChanged();
          }}
        />
      </div>
    </div>
  );
}

function DiagramCanvas({
  data,
  selectedId,
  onSelect,
}: {
  data: { nodes: DiagramNode[]; edges: DiagramEdge[] };
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Layout grid đơn giản: ~5 col, mỗi cell 240x110.
  const layoutMemo = useMemo(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(data.nodes.length)));
    return data.nodes.map((n, i) => ({
      ...n,
      x: (i % cols) * 240,
      y: Math.floor(i / cols) * 110,
    }));
  }, [data.nodes]);

  const flowNodes: Node[] = layoutMemo.map((n) => ({
    id: n.id,
    type: "default",
    position: { x: n.x, y: n.y },
    data: { label: <NodeLabel node={n} /> },
    style: {
      border:
        selectedId === n.id ? "2px solid var(--color-accent)" : "1px solid var(--color-border)",
      background: n.kind === "enum" ? "rgba(34,197,94,0.05)" : "var(--color-bg)",
      borderRadius: 6,
      padding: 4,
      width: 200,
    },
  }));

  const flowEdges: Edge[] = data.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.column,
    labelStyle: { fontSize: 10, fill: "var(--color-muted)" },
    style: { stroke: "var(--color-border)" },
    markerEnd: { type: MarkerType.ArrowClosed },
  }));

  return (
    <div className="border border-border rounded overflow-hidden bg-surface/30">
      <ReactFlowProvider>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodeClick={(_, n) => onSelect(n.id)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

function NodeLabel({ node }: { node: DiagramNode }) {
  const t = useT();
  return (
    <div className="text-left">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted truncate">{node.id}</span>
        <Chip variant={node.kind === "enum" ? "accent" : "default"} className="text-[9px]!">
          {node.kind}
        </Chip>
      </div>
      <div className="text-sm font-medium truncate">{node.entityName}</div>
      <div className="text-[10px] text-muted truncate">{node.label}</div>
      <div className="text-[10px] text-muted">
        {node.kind === "enum"
          ? t("mig.diagram_node_values", { count: node.enumValueCount })
          : t("mig.diagram_node_columns", { count: node.fieldCount })}
      </div>
    </div>
  );
}

function DiagramSidebar({
  moduleName,
  node,
  allNodes,
  onApplied,
}: {
  moduleName: string;
  node: DiagramNode | null;
  allNodes: DiagramNode[];
  onApplied: () => void;
}) {
  const t = useT();
  if (!node) {
    return (
      <Card className="p-3 text-xs text-muted">
        {t("mig.diagram_click_hint")}
        <div className="mt-2">
          {t("mig.diagram_total", {
            total: allNodes.length,
            entities: allNodes.filter((n) => n.kind === "entity").length,
            enums: allNodes.filter((n) => n.kind === "enum").length,
          })}
        </div>
      </Card>
    );
  }
  return <DiagramNodeActions moduleName={moduleName} node={node} onApplied={onApplied} />;
}

function DiagramNodeActions({
  moduleName,
  node,
  onApplied,
}: {
  moduleName: string;
  node: DiagramNode;
  onApplied: () => void;
}) {
  const t = useT();
  const [newName, setNewName] = useState(node.entityName);
  const [newKind, setNewKind] = useState<"entity" | "enum">(node.kind);
  const [changes, setChanges] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Reset khi đổi node selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chủ ý reset form khi node.id đổi (chọn node khác)
  useEffect(() => {
    setNewName(node.entityName);
    setNewKind(node.kind);
    setChanges([]);
    setErr("");
  }, [node.id, node.entityName, node.kind]);

  const apply = async (action: Parameters<typeof migration.applyChange>[0]["action"]) => {
    setBusy(true);
    setErr("");
    setChanges([]);
    try {
      const r = await migration.applyChange({ module: moduleName, action });
      setChanges(r.changes);
      onApplied();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-3 space-y-3 text-xs overflow-y-auto">
      <div>
        <div className="font-mono text-[10px] text-muted">{node.id}</div>
        <div className="font-medium">{node.entityName}</div>
        <div className="text-muted">{node.label}</div>
      </div>

      <div className="border-t border-border pt-2">
        <FormField label={t("mig.diagram_rename_entity")}>
          <div className="flex gap-1">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button
              size="sm"
              variant="primary"
              disabled={busy || newName === node.entityName}
              onClick={() => apply({ type: "renameEntity", tableName: node.id, newName })}
            >
              {t("common.apply")}
            </Button>
          </div>
        </FormField>
        <div className="text-[10px] text-muted mt-1">
          {t("mig.diagram_rename_cascade", { name: node.entityName })}
        </div>
      </div>

      <div className="border-t border-border pt-2">
        <FormField label={t("mig.diagram_change_kind")}>
          <div className="flex gap-1">
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as "entity" | "enum")}
              className="flex-1 px-2 h-7 border border-border rounded bg-bg text-sm outline-none focus:border-accent"
            >
              <option value="entity">entity</option>
              <option value="enum">enum</option>
            </select>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || newKind === node.kind}
              onClick={() => apply({ type: "changeKind", tableName: node.id, newKind })}
            >
              {t("common.apply")}
            </Button>
          </div>
        </FormField>
        <div className="text-[10px] text-muted mt-1">
          {t(
            newKind === "enum"
              ? "mig.diagram_kind_cascade_enum"
              : "mig.diagram_kind_cascade_entity",
          )}
        </div>
      </div>

      {err && <div className="text-danger">{err}</div>}
      {changes.length > 0 && (
        <div className="border-t border-border pt-2">
          <div className="text-success font-medium mb-1">{t("mig.diagram_applied")}</div>
          <ul className="text-[11px] text-muted space-y-0.5 list-disc pl-4">
            {changes.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: danh sách thay đổi tĩnh chỉ-đọc, chuỗi có thể trùng
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ── Nút AI normalize names — gợi ý rename hàng loạt ─── */

interface NormalizeRename {
  kind: "entity" | "enum" | "field" | "proc";
  table?: string;
  column?: string;
  currentName: string;
  suggestedName: string;
  reason: string;
  severity: "high" | "medium" | "low";
}

interface NormalizeResult {
  renames: NormalizeRename[];
  summary?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  error?: string;
}

function NormalizeNamesButton({
  moduleName,
  onApplied,
}: {
  moduleName: string;
  onApplied: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NormalizeResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const r = await migration.normalizeNamesAi(moduleName);
      setResult(r);
      setShowModal(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="default"
        disabled={busy}
        onClick={run}
        icon={busy ? <I.Loader size={12} /> : <I.Wand size={12} />}
      >
        {busy ? t("mig.normalize_busy") : t("mig.normalize_btn")}
      </Button>
      {err && <span className="text-[11px] text-danger">{err}</span>}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={t("mig.normalize_modal_title")}
        width={900}
      >
        {result && (
          <NormalizeRenameView
            result={result}
            moduleName={moduleName}
            onApplied={() => {
              onApplied();
              setShowModal(false);
            }}
          />
        )}
      </Modal>
    </>
  );
}

function NormalizeRenameView({
  result,
  moduleName,
  onApplied,
}: {
  result: NormalizeResult;
  moduleName: string;
  onApplied: () => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState<Set<number>>(() => {
    // Mặc định: tick all severity=high.
    return new Set(
      result.renames.map((_, i) => i).filter((i) => result.renames[i]?.severity === "high"),
    );
  });
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<string[]>([]);
  const [err, setErr] = useState("");

  const toggle = (i: number) => {
    const next = new Set(picked);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setPicked(next);
  };

  const applyPicked = async () => {
    setBusy(true);
    setErr("");
    setApplied([]);
    const logs: string[] = [];
    try {
      for (const i of [...picked].sort((a, b) => a - b)) {
        const r = result.renames[i];
        if (!r) continue;
        try {
          if (r.kind === "entity" || r.kind === "enum") {
            if (!r.table) continue;
            const out = await migration.applyChange({
              module: moduleName,
              action: { type: "renameEntity", tableName: r.table, newName: r.suggestedName },
            });
            logs.push(
              `✓ ${r.kind} ${r.currentName} → ${r.suggestedName} (${out.changes.length} change)`,
            );
          } else if (r.kind === "field") {
            if (!r.table || !r.column) continue;
            const out = await migration.applyChange({
              module: moduleName,
              action: {
                type: "renameField",
                tableName: r.table,
                columnName: r.column,
                newField: r.suggestedName,
              },
            });
            logs.push(
              `✓ field ${r.table}.${r.column} → ${r.suggestedName} (${out.changes.length} change)`,
            );
          } else {
            // proc: chưa có applyChange action cho proc rename (targetProcName).
            // Skip với warning.
            logs.push(
              `! Skip proc ${r.currentName} → ${r.suggestedName} (chưa support — sửa tay trong YAML).`,
            );
          }
        } catch (e) {
          logs.push(`✗ ${r.currentName}: ${(e as Error).message}`);
        }
      }
      setApplied(logs);
      onApplied();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result.error) {
    return (
      <div className="p-2 rounded border border-danger/40 bg-danger/5 text-xs">
        <div className="text-danger font-medium">
          {t("mig.normalize_llm_fail")} {result.error}
        </div>
        <ErrorHint code={result.error} />
      </div>
    );
  }

  if (result.renames.length === 0) {
    return (
      <div className="text-sm text-success">
        {t("mig.normalize_ok")}
        {result.summary && <div className="text-muted text-xs mt-2">{result.summary}</div>}
      </div>
    );
  }

  const severityCount = {
    high: result.renames.filter((r) => r.severity === "high").length,
    medium: result.renames.filter((r) => r.severity === "medium").length,
    low: result.renames.filter((r) => r.severity === "low").length,
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="text-muted flex gap-3 flex-wrap">
        <span>{t("mig.normalize_count", { count: result.renames.length })}</span>
        <span className="text-danger">H={severityCount.high}</span>
        <span className="text-warning">M={severityCount.medium}</span>
        <span>L={severityCount.low}</span>
        <span className="ml-auto">
          {result.tokensIn}+{result.tokensOut} tokens · {(result.durationMs / 1000).toFixed(1)}s
        </span>
      </div>
      {result.summary && (
        <div className="p-2 rounded border border-accent/30 bg-accent/5 text-[11px]">
          {result.summary}
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => setPicked(new Set(result.renames.map((_, i) => i)))}
          className="px-2 h-6 border border-border rounded hover:bg-surface"
        >
          {t("mig.normalize_select_all")}
        </button>
        <button
          type="button"
          onClick={() => setPicked(new Set())}
          className="px-2 h-6 border border-border rounded hover:bg-surface"
        >
          {t("mig.normalize_deselect")}
        </button>
        <div className="ml-auto text-muted">
          {t("mig.normalize_selected", { count: picked.size })}
        </div>
      </div>
      <div className="border border-border rounded overflow-hidden max-h-96 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-surface text-muted sticky top-0">
            <tr>
              <th className="text-left px-2 py-1 w-6"></th>
              <th className="text-left px-2 py-1">{t("mig.normalize_col_kind")}</th>
              <th className="text-left px-2 py-1">{t("mig.normalize_col_current")}</th>
              <th className="text-left px-2 py-1">{t("mig.normalize_col_suggested")}</th>
              <th className="text-left px-2 py-1">{t("mig.normalize_col_reason")}</th>
              <th className="text-left px-2 py-1 w-12">{t("mig.normalize_col_sev")}</th>
            </tr>
          </thead>
          <tbody>
            {result.renames.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: chọn theo index (picked.has(i)/toggle(i)), không có id riêng
              <tr key={i} className="border-t border-border hover:bg-surface">
                <td className="px-2 py-1">
                  <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                </td>
                <td className="px-2 py-1">
                  <Chip className="text-[9px]!">{r.kind}</Chip>
                </td>
                <td className="px-2 py-1">
                  <code>{r.currentName}</code>
                  {r.table && (
                    <div className="text-[9px] text-muted">
                      {r.table}
                      {r.column ? `.${r.column}` : ""}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1">
                  <code className="text-accent">{r.suggestedName}</code>
                </td>
                <td className="px-2 py-1 text-muted">{r.reason}</td>
                <td className="px-2 py-1">
                  <Chip
                    variant={
                      r.severity === "high"
                        ? "danger"
                        : r.severity === "medium"
                          ? "warning"
                          : "default"
                    }
                    className="text-[9px]!"
                  >
                    {r.severity[0]?.toUpperCase()}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <div className="text-danger">{err}</div>}
      {applied.length > 0 && (
        <div className="border-t border-border pt-2 max-h-48 overflow-y-auto">
          <div className="text-success font-medium mb-1">{t("mig.normalize_results")}</div>
          <ul className="text-[11px] text-muted space-y-0.5">
            {applied.map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: danh sách kết quả tĩnh chỉ-đọc, chuỗi có thể trùng
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2 justify-end pt-2 border-t border-border">
        <Button
          size="sm"
          variant="primary"
          disabled={busy || picked.size === 0}
          onClick={applyPicked}
        >
          {busy
            ? t("mig.normalize_applying")
            : t("mig.normalize_apply_btn", { count: picked.size })}
        </Button>
      </div>
    </div>
  );
}
