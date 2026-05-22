import { useCallback, useState, useEffect } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, addEdge, useEdgesState, useNodesState,
  type Node, type Edge, type Connection, type NodeProps, MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button, Chip, FormField, Input, Select } from "@/components/ui";
import { I } from "@/components/Icons";
import type { IconName } from "@/lib/object-types";
import { pluginRegistry } from "@erp-framework/core";
import { createObjectsClient } from "@erp-framework/client";
import { AiAssistDrawer } from "@/components/designer/AiAssistDrawer";
import { WorkflowRunPanel } from "@/components/designer/WorkflowRunPanel";
import { useMcpClient } from "@/hooks/useMcpClient";
import { useUserObjects } from "@/stores/userObjects";
import type { WorkflowDesign } from "@/lib/ai-design-prompts";
import { useUI } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/useT";

const objectsClient = createObjectsClient("");

/* (string & {}) — giữ gợi ý 6 kind builtin nhưng cho phép kind tuỳ ý
   do workflow-node plugin thêm vào. */
type WorkflowNodeKind =
  | "trigger" | "action" | "condition" | "agent" | "approval" | "delay"
  | (string & {});

interface NodePaletteItem {
  kind: WorkflowNodeKind;
  label: string;
  desc: string;
  icon: IconName;
  color: string;
}

const NODE_PALETTE: NodePaletteItem[] = [
  { kind: "trigger",   label: "Trigger",   desc: "Khởi đầu workflow", icon: "Zap",      color: "var(--accent-2)" },
  { kind: "action",    label: "Action",    desc: "Gọi MCP tool",      icon: "Server",   color: "var(--accent)" },
  { kind: "condition", label: "Condition", desc: "If/else branching", icon: "GitBranch", color: "var(--warning)" },
  { kind: "agent",     label: "Agent",     desc: "Gọi LLM",           icon: "Sparkles", color: "var(--accent)" },
  { kind: "approval",  label: "Approval",  desc: "Chờ user duyệt",    icon: "User",     color: "var(--success)" },
  { kind: "delay",     label: "Delay",     desc: "Chờ N giây / đến giờ", icon: "Clock", color: "var(--muted)" },
];

/** Palette node = builtin + workflow-node plugin đã đăng ký trong registry. */
function getNodePalette(): NodePaletteItem[] {
  const builtinKinds = new Set(NODE_PALETTE.map((p) => p.kind));
  const fromPlugins: NodePaletteItem[] = pluginRegistry.listWorkflowNodes()
    .filter((p) => !builtinKinds.has(p.type))
    .map((p) => ({
      kind: p.type,
      label: p.label,
      desc: p.description ?? "Node từ plugin",
      icon: (p.icon ?? "Bolt") as IconName,
      color: "var(--muted)",
    }));
  return [...NODE_PALETTE, ...fromPlugins];
}

const INITIAL_NODES: Node<WfNodeData>[] = [
  { id: "n1", type: "wf", position: { x: 80,  y: 80 },  data: { kind: "trigger",   label: "Đơn hàng mới" } },
  { id: "n2", type: "wf", position: { x: 320, y: 80 },  data: { kind: "condition", label: "Tổng > 50tr ?" } },
  { id: "n3", type: "wf", position: { x: 560, y: 20 },  data: { kind: "approval",  label: "Sếp duyệt" } },
  { id: "n4", type: "wf", position: { x: 560, y: 160 }, data: { kind: "action",    label: "Tạo đơn ngay" } },
];
const INITIAL_EDGES: Edge[] = [
  { id: "e1", source: "n1", target: "n2", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "e2", source: "n2", target: "n3", label: "Yes", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "e3", source: "n2", target: "n4", label: "No",  markerEnd: { type: MarkerType.ArrowClosed } },
];

interface WfNodeData {
  kind: WorkflowNodeKind;
  label: string;
  config?: Record<string, unknown>;
  /** Index signature — bắt buộc để khớp ràng buộc Node<T> của @xyflow/react. */
  [key: string]: unknown;
}

function WfNode({ data }: NodeProps<Node<WfNodeData>>) {
  const meta = getNodePalette().find((p) => p.kind === data.kind);
  const IC = I[(meta?.icon ?? "Bot") as IconName];
  return (
    <div
      className="card px-3 py-2 min-w-[160px] shadow-md flex items-center gap-2"
      style={{ borderColor: meta?.color }}
    >
      <span
        className="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0"
        style={{ background: meta?.color }}
      >
        <IC size={14} />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">{meta?.label}</div>
        <div className="text-sm font-medium truncate">{data.label}</div>
      </div>
    </div>
  );
}

const NODE_TYPES = { wf: WfNode };

interface Props { workflowId: string }

export function WorkflowDesigner({ workflowId }: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowInner workflowId={workflowId} />
    </ReactFlowProvider>
  );
}

function WorkflowInner({ workflowId }: Props) {
  const t = useT();
  const mode = useUI((s) => s.mode);
  const inspectorVisible = useUI((s) => s.inspectorVisible);
  const isConsumer = mode === "consumer";

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WfNodeData>>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_EDGES);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragKind, setDragKind] = useState<WorkflowNodeKind | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [published, setPublished] = useState(false);
  const { tools: mcpTools } = useMcpClient();
  const setWorkflowContent = useUserObjects((s) => s.setWorkflowContent);

  // Load nội dung đã lưu khi đổi workflow
  useEffect(() => {
    const stored = useUserObjects.getState().workflowContent[workflowId] as
      { nodes?: Node<WfNodeData>[]; edges?: Edge[] } | undefined;
    if (stored?.nodes) setNodes(stored.nodes);
    if (stored?.edges) setEdges(stored.edges);
    setSelected(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  const save = () => {
    setWorkflowContent(workflowId, { nodes, edges });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  /* Publish: lưu bản nháp rồi chốt thành bản đang chạy (publishedGraph). */
  const publish = async () => {
    save();
    try {
      await objectsClient.workflows.publish(workflowId);
      setPublished(true);
      setTimeout(() => setPublished(false), 2500);
    } catch (e) {
      console.error("[workflow] publish lỗi:", e);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, workflowId]);

  // AI apply — replace toàn bộ nodes + edges
  const handleAiApply = (design: WorkflowDesign) => {
    const newNodes: Node<WfNodeData>[] = (design.nodes ?? []).map((n) => ({
      id: n.id,
      type: "wf",
      position: { x: n.x ?? 0, y: n.y ?? 0 },
      data: { kind: (n.type as WorkflowNodeKind) ?? "action", label: n.label, config: n.config },
    }));
    const newEdges: Edge[] = (design.edges ?? []).map((e, i) => ({
      id: "e_" + Date.now() + "_" + i,
      source: e.source,
      target: e.target,
      label: e.label,
      markerEnd: { type: MarkerType.ArrowClosed },
    }));
    setNodes(newNodes);
    setEdges(newEdges);
    setAiOpen(false);
  };

  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, markerEnd: { type: MarkerType.ArrowClosed } }, es)),
    [setEdges],
  );

  const sel = nodes.find((n) => n.id === selected);

  const addNode = (kind: WorkflowNodeKind, pos: { x: number; y: number }) => {
    const meta = getNodePalette().find((p) => p.kind === kind);
    const id = "n_" + Math.random().toString(36).slice(2, 7);
    setNodes((ns) => [...ns, {
      id, type: "wf", position: pos,
      data: { kind, label: meta?.label ?? "Node" },
    }]);
    setSelected(id);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="h-11 shrink-0 flex items-center px-3 gap-2 border-b border-border bg-panel">
        <div className="w-7 h-7 rounded-md bg-accent/15 text-accent flex items-center justify-center">
          <I.Workflow size={14} />
        </div>
        <div className="flex flex-col leading-tight">
          <div className="font-semibold text-base">Workflow {workflowId}</div>
          <div className="text-[11px] text-muted">{nodes.length} nodes · {edges.length} edges</div>
        </div>
        <div className="flex-1" />
        <Button variant="default" size="sm" icon={<I.Sparkles size={13} />} onClick={() => setAiOpen(true)}>
          AI Assist
        </Button>
        {/* Một đường chạy DUY NHẤT — mở WorkflowRunPanel (runner thật
            phía server). Không còn "Test Run" mô phỏng client tách rời. */}
        <Button variant="default" size="sm" icon={<I.Play size={13} />}
          onClick={() => setRunOpen(true)}>
          Chạy thử / Vận hành
        </Button>
        <Button variant="default" size="sm" icon={<I.Send size={13} />} onClick={publish}>
          Publish
        </Button>
        <Button variant="primary" size="sm" icon={<I.Save size={13} />} onClick={save}>
          {t("common.save")}
        </Button>
        {published && (
          <span className="text-xs text-accent flex items-center gap-1">
            <I.Bolt size={11} /> Đã publish
          </span>
        )}
        {saved && (
          <span className="text-xs text-success flex items-center gap-1">
            <I.Check size={11} /> {t("designer.saved")}
          </span>
        )}
      </div>
      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        objectType="workflow"
        current={nodes.length > 0 ? {
          name: `Workflow ${workflowId}`,
          nodes: nodes.map((n) => ({
            id: n.id, type: n.data.kind, label: n.data.label,
            x: n.position.x, y: n.position.y, config: n.data.config,
          })),
          edges: edges.map((e) => ({
            source: e.source, target: e.target,
            label: typeof e.label === "string" ? e.label : undefined,
          })),
        } : undefined}
        context={{
          mcpTools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
        }}
        onApply={handleAiApply}
      />

      {/* Chạy thử / Vận hành — runner THẬT phía server (executeWorkflow)
          + lịch cron + lịch sử run. Server nạp graph từ DB nên không
          cần truyền nodes/edges. Đây là đường chạy workflow duy nhất —
          kết quả chạy thử khớp chính xác với khi chạy nền/cron. */}
      <WorkflowRunPanel
        open={runOpen}
        onClose={() => setRunOpen(false)}
        workflowId={workflowId}
        workflowName={`Workflow ${workflowId}`}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Palette */}
        {!isConsumer && (
          <div className="w-[200px] shrink-0 border-r border-border bg-panel flex flex-col">
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Nodes</div>
              <div className="text-xs text-muted mt-0.5">{t("designer.drag_to_canvas")}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {getNodePalette().map((p) => {
                const IC = I[p.icon];
                return (
                  <div
                    key={p.kind}
                    draggable
                    onDragStart={(e) => {
                      setDragKind(p.kind);
                      e.dataTransfer.setData("application/x-wf-kind", p.kind);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onDragEnd={() => setDragKind(null)}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-md border border-border bg-bg-soft hover:border-accent/60 cursor-grab active:cursor-grabbing text-xs",
                      dragKind === p.kind && "dragging",
                    )}
                  >
                    <span className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0" style={{ background: p.color }}>
                      <IC size={12} />
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium">{p.label}</div>
                      <div className="text-[10px] text-muted truncate">{p.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Canvas */}
        <div
          className="flex-1 bg-bg relative"
          onDragOver={(e) => { if (dragKind) e.preventDefault(); }}
          onDrop={(e) => {
            e.preventDefault();
            const kind = e.dataTransfer.getData("application/x-wf-kind") as WorkflowNodeKind;
            if (!kind) return;
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            addNode(kind, { x: e.clientX - rect.left - 80, y: e.clientY - rect.top - 30 });
            setDragKind(null);
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            fitView
            attributionPosition="bottom-left"
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} color="hsl(var(--border) / 0.7)" />
            <Controls className="!bg-panel !border !border-border" />
            <MiniMap
              className="!bg-panel !border !border-border"
              nodeColor={(n) => {
                const meta = getNodePalette().find((p) => p.kind === (n.data as WfNodeData).kind);
                return meta?.color ?? "var(--muted)";
              }}
              maskColor="hsl(var(--bg) / 0.6)"
            />
          </ReactFlow>
        </div>

        {/* Inspector */}
        {!isConsumer && inspectorVisible && (
          <aside className="w-[280px] shrink-0 border-l border-border bg-panel overflow-y-auto">
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Inspector</div>
            </div>
            {sel ? (
              <div className="p-3 space-y-3">
                <FormField label="Label">
                  <Input
                    value={sel.data.label}
                    onChange={(e) => setNodes((ns) => ns.map((n) =>
                      n.id === sel.id ? { ...n, data: { ...n.data, label: e.target.value } } : n
                    ))}
                  />
                </FormField>
                <FormField label="Loại node">
                  <div className="h-9 px-3 flex items-center text-sm border border-border rounded-md bg-bg-soft">
                    <Chip variant="accent">{sel.data.kind}</Chip>
                  </div>
                </FormField>
                {sel.data.kind === "action" && (
                  <FormField label="MCP Tool">
                    <Select>
                      <option>sales.order.list</option>
                      <option>sales.order.create</option>
                      <option>crm.customer.get</option>
                      <option>notif.email.send</option>
                    </Select>
                  </FormField>
                )}
                {sel.data.kind === "condition" && (
                  <FormField label={t("field.wait_minutes")}>
                    <Input type="number" defaultValue={30} />
                  </FormField>
                )}
                {sel.data.kind === "agent" && (
                  <FormField label="Agent">
                    <Select>
                      <option value="">{t("field.choose_agent")}</option>
                      <option value="a_sales">Trợ lý Sales</option>
                      <option value="a_kho">Trợ lý Kho</option>
                      <option value="a_finance">Trợ lý Kế toán</option>
                    </Select>
                  </FormField>
                )}
                {sel.data.kind === "approval" && (
                  <FormField label={t("field.approved_by")}>
                    <Input placeholder="role:manager / user:id" />
                  </FormField>
                )}
                <Button
                  variant="danger"
                  size="sm"
                  icon={<I.Trash size={12} />}
                  onClick={() => {
                    setNodes((ns) => ns.filter((n) => n.id !== sel.id));
                    setEdges((es) => es.filter((e) => e.source !== sel.id && e.target !== sel.id));
                    setSelected(null);
                  }}
                >
                  {t("designer.delete_node")}
                </Button>
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-muted">
                {t("designer.select_node")}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
