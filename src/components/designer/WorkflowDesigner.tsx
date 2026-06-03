import {
  addEdge,
  Background,
  BaseEdge,
  type Connection,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import "@xyflow/react/dist/style.css";
import { createObjectsClient } from "@erp-framework/client";
import { pluginRegistry, type WfPort } from "@erp-framework/core";
import { AiAssistDrawer } from "@/components/designer/AiAssistDrawer";
import { MobileDesignerNotice } from "@/components/designer/MobileDesignerNotice";
import { WorkflowRunPanel } from "@/components/designer/WorkflowRunPanel";
import { I } from "@/components/Icons";
import { Button, Chip, FormField, Input, Select, Textarea } from "@/components/ui";
import { useMcpClient } from "@/hooks/useMcpClient";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useT } from "@/hooks/useT";
import type { WorkflowDesign } from "@/lib/ai-design-prompts";
import type { IconName, WorkflowTriggerType } from "@/lib/object-types";
import { cn } from "@/lib/utils";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

const objectsClient = createObjectsClient("");

/* (string & {}) — giữ gợi ý 6 kind builtin nhưng cho phép kind tuỳ ý
   do workflow-node plugin thêm vào. */
type WorkflowNodeKind =
  | "trigger"
  | "action"
  | "condition"
  | "agent"
  | "approval"
  | "delay"
  | "code"
  | "procedure"
  | (string & {});

interface NodePaletteItem {
  kind: WorkflowNodeKind;
  label: string;
  desc: string;
  icon: IconName;
  color: string;
}

const NODE_PALETTE: NodePaletteItem[] = [
  {
    kind: "trigger",
    label: "Trigger",
    desc: "Khởi đầu workflow",
    icon: "Zap",
    color: "var(--accent-2)",
  },
  { kind: "action", label: "Action", desc: "Gọi MCP tool", icon: "Server", color: "var(--accent)" },
  {
    kind: "condition",
    label: "Condition",
    desc: "If/else branching",
    icon: "GitBranch",
    color: "var(--warning)",
  },
  { kind: "agent", label: "Agent", desc: "Gọi LLM", icon: "Sparkles", color: "var(--accent)" },
  {
    kind: "agent_chain",
    label: "Agent Chain",
    desc: "Chuỗi agent tuần tự",
    icon: "Bot",
    color: "var(--accent)",
  },
  {
    kind: "approval",
    label: "Approval",
    desc: "Chờ user duyệt",
    icon: "User",
    color: "var(--success)",
  },
  {
    kind: "delay",
    label: "Delay",
    desc: "Chờ N giây / đến giờ",
    icon: "Clock",
    color: "var(--muted)",
  },
  {
    kind: "code",
    label: "Code",
    desc: "Chạy JS sandbox",
    icon: "Terminal",
    color: "var(--accent-2)",
  },
  {
    kind: "procedure",
    label: "Procedure",
    desc: "Gọi native procedure",
    icon: "Package",
    color: "var(--accent)",
  },
];

/** Palette node = builtin + workflow-node plugin đã đăng ký trong registry. */
function getNodePalette(): NodePaletteItem[] {
  const builtinKinds = new Set(NODE_PALETTE.map((p) => p.kind));
  const fromPlugins: NodePaletteItem[] = pluginRegistry
    .listWorkflowNodes()
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
  {
    id: "n1",
    type: "wf",
    position: { x: 80, y: 80 },
    data: { kind: "trigger", label: "Đơn hàng mới" },
  },
  {
    id: "n2",
    type: "wf",
    position: { x: 320, y: 80 },
    data: { kind: "condition", label: "Tổng > 50tr ?" },
  },
  {
    id: "n3",
    type: "wf",
    position: { x: 560, y: 20 },
    data: { kind: "approval", label: "Sếp duyệt" },
  },
  {
    id: "n4",
    type: "wf",
    position: { x: 560, y: 160 },
    data: { kind: "action", label: "Tạo đơn ngay" },
  },
];
const INITIAL_EDGES: Edge[] = [
  { id: "e1", type: "wf", source: "n1", target: "n2", markerEnd: { type: MarkerType.ArrowClosed } },
  {
    id: "e2",
    type: "wf",
    source: "n2",
    sourceHandle: "yes",
    target: "n3",
    label: "Yes",
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: "e3",
    type: "wf",
    source: "n2",
    sourceHandle: "no",
    target: "n4",
    label: "No",
    markerEnd: { type: MarkerType.ArrowClosed },
  },
];

interface WfNodeData {
  kind: WorkflowNodeKind;
  label: string;
  config?: Record<string, unknown>;
  /** Index signature — bắt buộc để khớp ràng buộc Node<T> của @xyflow/react. */
  [key: string]: unknown;
}

/* Kích thước layout node: header cố định + mỗi cổng dữ liệu một hàng.
   Handle data được đặt top tuyệt đối theo HEADER_H + index*ROW. */
const NODE_HEADER_H = 42;
const NODE_PORT_ROW = 20;

function nodePorts(data: WfNodeData, key: "inputs" | "outputs"): WfPort[] {
  const v = data.config?.[key];
  return Array.isArray(v) ? (v as WfPort[]) : [];
}

function WfNode({ data }: NodeProps<Node<WfNodeData>>) {
  const t = useT();
  const meta = getNodePalette().find((p) => p.kind === data.kind);
  const IC = I[(meta?.icon ?? "Bot") as IconName];
  const isCondition = data.kind === "condition";
  const inPorts = nodePorts(data, "inputs");
  const outPorts = nodePorts(data, "outputs");
  const portRows = Math.max(inPorts.length, outPorts.length);
  const minHeight = NODE_HEADER_H + (portRows > 0 ? portRows * NODE_PORT_ROW + 6 : 0);
  const ctrlTop = NODE_HEADER_H / 2;
  return (
    <div
      className="card relative min-w-[180px] shadow-md"
      style={{ borderColor: meta?.color, minHeight }}
    >
      {/* Header: icon + nhãn */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ height: NODE_HEADER_H }}>
        <span
          className="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0"
          style={{ background: meta?.color }}
        >
          <IC size={14} />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
            {t(`wf.node.${data.kind}`)}
          </div>
          <div className="text-sm font-medium truncate">{data.label}</div>
        </div>
      </div>

      {/* Control-flow target (trái) — trigger không nhận control vào */}
      {data.kind !== "trigger" && (
        <Handle
          type="target"
          position={Position.Left}
          style={{ top: ctrlTop, background: meta?.color }}
        />
      )}
      {/* Control-flow source (phải) — condition rẽ Y/N, còn lại 1 cổng */}
      {isCondition ? (
        <>
          <Handle
            type="source"
            id="yes"
            position={Position.Right}
            style={{ top: ctrlTop - 7, background: "var(--success)" }}
          />
          <span
            className="absolute right-1.5 text-[8px] font-semibold text-success"
            style={{ top: ctrlTop - 13 }}
          >
            Y
          </span>
          <Handle
            type="source"
            id="no"
            position={Position.Right}
            style={{ top: ctrlTop + 7, background: "var(--danger)" }}
          />
          <span
            className="absolute right-1.5 text-[8px] font-semibold text-danger"
            style={{ top: ctrlTop + 3 }}
          >
            N
          </span>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          style={{ top: ctrlTop, background: meta?.color }}
        />
      )}

      {/* Cổng INPUT dữ liệu (trái) — id handle "in:<portId>" */}
      {inPorts.map((p, i) => {
        const top = NODE_HEADER_H + 4 + i * NODE_PORT_ROW + NODE_PORT_ROW / 2;
        return (
          <div key={`in-${p.id}`}>
            <Handle
              type="target"
              id={`in:${p.id}`}
              position={Position.Left}
              style={{ top, background: "var(--accent-2)" }}
            />
            <span
              className="absolute left-3 text-[9px] text-accent-2 truncate max-w-[72px]"
              style={{ top: top - 7 }}
            >
              {p.label || p.id}
            </span>
          </div>
        );
      })}
      {/* Cổng OUTPUT dữ liệu (phải) — id handle "out:<portId>" */}
      {outPorts.map((p, i) => {
        const top = NODE_HEADER_H + 4 + i * NODE_PORT_ROW + NODE_PORT_ROW / 2;
        return (
          <div key={`out-${p.id}`}>
            <Handle
              type="source"
              id={`out:${p.id}`}
              position={Position.Right}
              style={{ top, background: "var(--accent)" }}
            />
            <span
              className="absolute right-3 text-[9px] text-accent truncate max-w-[72px] text-right"
              style={{ top: top - 7 }}
            >
              {p.label || p.id}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const NODE_TYPES = { wf: WfNode };

/* Edge tuỳ biến: giữ nguyên style (nét đứt data / mũi tên control do
   ReactFlow truyền qua props) + thêm nút × ở trung điểm để xoá nhanh.
   Nút chỉ hiện khi hover lên edge hoặc edge đang được chọn. */
function WfFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  selected,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan group absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1"
          style={{ left: labelX, top: labelY, pointerEvents: "all" }}
        >
          {typeof label === "string" && label && (
            <span className="px-1 rounded bg-panel border border-border text-[10px] text-muted">
              {label}
            </span>
          )}
          <button
            type="button"
            title="Xoá link"
            onClick={() => setEdges((es) => es.filter((e) => e.id !== id))}
            className={cn(
              "w-4 h-4 rounded-full bg-danger text-white flex items-center justify-center text-[10px] leading-none transition-opacity",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const EDGE_TYPES = { wf: WfFlowEdge };

/* Field nhập JSON có buffer text RIÊNG: cho phép gõ JSON dở dang mà
   value controlled không bị revert về chuỗi parse-được trước đó. Chỉ
   đẩy giá trị đã parse ra ngoài khi hợp lệ; lỗi cú pháp hiện cảnh báo
   nhưng KHÔNG mất nội dung đang gõ. Parent truyền `key` theo node id
   để remount (reset buffer) khi đổi node. */
function JsonField({
  label,
  value,
  rows = 3,
  placeholder,
  expectArray = false,
  onValid,
}: {
  label: string;
  value: unknown;
  rows?: number;
  placeholder?: string;
  expectArray?: boolean;
  onValid: (v: unknown) => void;
}) {
  const [text, setText] = useState(() =>
    value === undefined || value === null || value === "" ? "" : JSON.stringify(value, null, 2),
  );
  const [err, setErr] = useState<string | null>(null);
  return (
    <FormField label={label}>
      <Textarea
        rows={rows}
        className="font-mono! text-xs! leading-relaxed"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          if (!v.trim()) {
            setErr(null);
            onValid(expectArray ? [] : {});
            return;
          }
          try {
            const parsed = JSON.parse(v);
            if (expectArray && !Array.isArray(parsed)) {
              setErr("Cần một mảng JSON []");
              return;
            }
            setErr(null);
            onValid(parsed);
          } catch (ex) {
            setErr((ex as Error).message);
          }
        }}
      />
      {err && <div className="text-[11px] text-danger mt-1">JSON lỗi: {err}</div>}
    </FormField>
  );
}

interface Props {
  workflowId: string;
}

export function WorkflowDesigner({ workflowId }: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowInner workflowId={workflowId} />
    </ReactFlowProvider>
  );
}

function WorkflowInner({ workflowId }: Props) {
  const t = useT();
  const isMobile = useIsMobile();
  const inspectorVisible = useUI((s) => s.inspectorVisible);
  const setInspectorVisible = useUI((s) => s.setInspectorVisible);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WfNodeData>>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_EDGES);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [dragKind, setDragKind] = useState<WorkflowNodeKind | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [published, setPublished] = useState(false);
  const { tools: mcpTools } = useMcpClient();
  const setWorkflowContent = useUserObjects((s) => s.setWorkflowContent);
  // Nguồn trigger ở CẤP WORKFLOW (workflows.triggerType) — không phải node.
  const setWorkflowTrigger = useUserObjects((s) => s.setWorkflowTrigger);
  const wfModel = useUserObjects((s) => s.workflows.find((w) => w.id === workflowId));
  const entitiesList = useUserObjects((s) => s.entities);
  const triggerType: WorkflowTriggerType = wfModel?.triggerType ?? "manual";
  const triggerConfig = wfModel?.triggerConfig ?? {};
  const webhookToken = typeof triggerConfig.token === "string" ? triggerConfig.token : "";
  // Danh sách events cho entity_changed; rỗng = mọi sự kiện (khớp helper server).
  const trigEvents = Array.isArray(triggerConfig.events) ? (triggerConfig.events as string[]) : [];
  const eventOn = (ev: string) => trigEvents.length === 0 || trigEvents.includes(ev);
  const toggleTrigEvent = (ev: string) => {
    const base = trigEvents.length === 0 ? ["create", "update", "delete"] : [...trigEvents];
    const next = base.includes(ev) ? base.filter((x) => x !== ev) : [...base, ev];
    setWorkflowTrigger(workflowId, "entity_changed", { ...triggerConfig, events: next });
  };

  // Load nội dung đã lưu khi đổi workflow
  useEffect(() => {
    const stored = useUserObjects.getState().workflowContent[workflowId] as
      | { nodes?: Node<WfNodeData>[]; edges?: Edge[] }
      | undefined;
    if (stored?.nodes) setNodes(stored.nodes);
    // Vá edge cũ đã lưu thiếu `type` → custom edge (nút ×) áp dụng cả edge cũ.
    if (stored?.edges) setEdges(stored.edges.map((e) => ({ ...e, type: e.type ?? "wf" })));
    setSelected(null);
    setSelectedEdge(null);
  }, [setEdges, workflowId, setNodes]);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: closure ổn định mount-only
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // AI apply — replace toàn bộ nodes + edges
  const handleAiApply = (design: WorkflowDesign) => {
    const newNodes: Node<WfNodeData>[] = (design.nodes ?? []).map((n) => ({
      id: n.id,
      type: "wf",
      position: { x: n.x ?? 0, y: n.y ?? 0 },
      data: { kind: (n.type as WorkflowNodeKind) ?? "action", label: n.label, config: n.config },
    }));
    const newEdges: Edge[] = (design.edges ?? []).map((e, i) => {
      // Map label Yes/No → sourceHandle để edge gắn đúng nhánh condition.
      const lbl = e.label?.toLowerCase();
      const sourceHandle = lbl === "yes" ? "yes" : lbl === "no" ? "no" : undefined;
      return {
        id: `e_${Date.now()}_${i}`,
        type: "wf",
        source: e.source,
        sourceHandle,
        target: e.target,
        label: e.label,
        markerEnd: { type: MarkerType.ArrowClosed },
      };
    });
    setNodes(newNodes);
    setEdges(newEdges);
    setAiOpen(false);
  };

  const onConnect = useCallback(
    (c: Connection) => {
      const isData =
        (c.sourceHandle ?? "").startsWith("out:") || (c.targetHandle ?? "").startsWith("in:");
      if (isData) {
        // Data-edge (nối cổng): nét đứt, animated, không mũi tên control.
        setEdges((es) =>
          addEdge(
            {
              ...c,
              type: "wf",
              animated: true,
              style: { stroke: "var(--accent-2)", strokeDasharray: "5 3" },
              data: { kind: "data" },
            },
            es,
          ),
        );
        return;
      }
      // Control-flow: condition suy label "Yes"/"No" từ source handle.
      const label = c.sourceHandle === "yes" ? "Yes" : c.sourceHandle === "no" ? "No" : undefined;
      setEdges((es) =>
        addEdge({ ...c, type: "wf", label, markerEnd: { type: MarkerType.ArrowClosed } }, es),
      );
    },
    [setEdges],
  );
  /* Chặn nối chéo loại: data-output chỉ vào data-input, control chỉ vào control. */
  const isValidConnection = useCallback((c: Connection | Edge) => {
    const dataSrc = (c.sourceHandle ?? "").startsWith("out:");
    const dataTgt = (c.targetHandle ?? "").startsWith("in:");
    return dataSrc === dataTgt;
  }, []);
  /* Reconnect: kéo lại đầu mút edge sang node/cổng khác (isValidConnection chặn nối sai loại). */
  const onReconnect = useCallback(
    (oldEdge: Edge, c: Connection) => setEdges((es) => reconnectEdge(oldEdge, c, es)),
    [setEdges],
  );
  const patchEdge = (id: string, patch: Partial<Edge>) =>
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const removeEdge = (id: string) => {
    setEdges((es) => es.filter((e) => e.id !== id));
    setSelectedEdge(null);
  };

  const sel = nodes.find((n) => n.id === selected);
  const selEdge = edges.find((e) => e.id === selectedEdge);

  /* Cập nhật node đang chọn — gom logic setNodes lặp lại của inspector. */
  const patchData = (patch: Partial<WfNodeData>) =>
    setNodes((ns) =>
      ns.map((n) => (n.id === selected ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  const patchConfig = (key: string, value: unknown) =>
    setNodes((ns) =>
      ns.map((n) =>
        n.id === selected
          ? { ...n, data: { ...n.data, config: { ...(n.data.config ?? {}), [key]: value } } }
          : n,
      ),
    );

  /* ── Cổng I/O dữ liệu của node đang chọn ── */
  const selPorts = (key: "inputs" | "outputs"): WfPort[] =>
    Array.isArray(sel?.data.config?.[key]) ? (sel.data.config[key] as WfPort[]) : [];
  const addPort = (key: "inputs" | "outputs") => {
    const arr = selPorts(key);
    const base = key === "inputs" ? "in" : "out";
    let i = arr.length + 1;
    let id = `${base}${i}`;
    while (arr.some((p) => p.id === id)) {
      i += 1;
      id = `${base}${i}`;
    }
    patchConfig(key, [...arr, { id }]);
  };
  const updatePort = (key: "inputs" | "outputs", idx: number, patch: Partial<WfPort>) => {
    const arr = selPorts(key).map((p, i) => (i === idx ? { ...p, ...patch } : p));
    patchConfig(key, arr);
  };
  const removePort = (key: "inputs" | "outputs", idx: number) =>
    patchConfig(
      key,
      selPorts(key).filter((_, i) => i !== idx),
    );

  const addNode = (kind: WorkflowNodeKind, pos: { x: number; y: number }) => {
    const meta = getNodePalette().find((p) => p.kind === kind);
    const id = `n_${Math.random().toString(36).slice(2, 7)}`;
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: "wf",
        position: pos,
        data: { kind, label: meta?.label ?? "Node" },
      },
    ]);
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
          <div className="text-[11px] text-muted">
            {nodes.length} nodes · {edges.length} edges
          </div>
        </div>
        <div className="flex-1" />
        <Button
          variant="default"
          size="sm"
          icon={<I.Sparkles size={13} />}
          onClick={() => setAiOpen(true)}
        >
          AI Assist
        </Button>
        {/* Một đường chạy DUY NHẤT — mở WorkflowRunPanel (runner thật
            phía server). Không còn "Test Run" mô phỏng client tách rời. */}
        <Button
          variant="default"
          size="sm"
          icon={<I.Play size={13} />}
          onClick={() => setRunOpen(true)}
        >
          {t("designer.workflow_run_btn")}
        </Button>
        <Button variant="default" size="sm" icon={<I.Send size={13} />} onClick={publish}>
          Publish
        </Button>
        <Button variant="primary" size="sm" icon={<I.Save size={13} />} onClick={save}>
          {t("common.save")}
        </Button>
        {published && (
          <span className="text-xs text-accent flex items-center gap-1">
            <I.Bolt size={11} /> {t("designer.published")}
          </span>
        )}
        {saved && (
          <span className="text-xs text-success flex items-center gap-1">
            <I.Check size={11} /> {t("designer.saved")}
          </span>
        )}
        <div className="w-px h-5 bg-border mx-1" />
        <button
          type="button"
          title={inspectorVisible ? "Ẩn inspector" : "Hiện inspector"}
          onClick={() => setInspectorVisible(!inspectorVisible)}
          className={cn(
            "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
            inspectorVisible
              ? "bg-accent/15 text-accent hover:bg-accent/25"
              : "text-muted hover:bg-hover/60",
          )}
        >
          <I.PanelRight size={14} />
        </button>
      </div>
      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        objectType="workflow"
        current={
          nodes.length > 0
            ? {
                name: `Workflow ${workflowId}`,
                nodes: nodes.map((n) => ({
                  id: n.id,
                  type: n.data.kind,
                  label: n.data.label,
                  x: n.position.x,
                  y: n.position.y,
                  config: n.data.config,
                })),
                edges: edges.map((e) => ({
                  source: e.source,
                  target: e.target,
                  label: typeof e.label === "string" ? e.label : undefined,
                })),
              }
            : undefined
        }
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

      {isMobile && <MobileDesignerNotice />}

      <div className="flex-1 flex overflow-hidden">
        {/* Palette — ẩn trên mobile (kéo-thả không khả dụng) */}
        {!isMobile && (
          <div className="w-[200px] shrink-0 border-r border-border bg-panel flex flex-col">
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
                {t("designer.nodes")}
              </div>
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
                    <span
                      className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0"
                      style={{ background: p.color }}
                    >
                      <IC size={12} />
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium">{t(`wf.node.${p.kind}`)}</div>
                      <div className="text-[10px] text-muted truncate">
                        {t(`wf.node.${p.kind}.desc`)}
                      </div>
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
          onDragOver={(e) => {
            if (dragKind) e.preventDefault();
          }}
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
            edgeTypes={EDGE_TYPES}
            deleteKeyCode={isMobile ? null : ["Delete", "Backspace"]}
            nodesDraggable={!isMobile}
            nodesConnectable={!isMobile}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_, n) => {
              setSelected(n.id);
              setSelectedEdge(null);
            }}
            onEdgeClick={(_, e) => {
              setSelectedEdge(e.id);
              setSelected(null);
            }}
            onPaneClick={() => {
              setSelected(null);
              setSelectedEdge(null);
            }}
            fitView
            attributionPosition="bottom-left"
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} color="hsl(var(--border) / 0.7)" />
            <Controls className="bg-panel! border! border-border!" />
            <MiniMap
              className="bg-panel! border! border-border!"
              nodeColor={(n) => {
                const meta = getNodePalette().find((p) => p.kind === (n.data as WfNodeData).kind);
                return meta?.color ?? "var(--muted)";
              }}
              maskColor="hsl(var(--bg) / 0.6)"
            />
          </ReactFlow>
        </div>

        {/* Inspector — ẩn trên mobile (xem đồ thị read-only, sửa trên desktop) */}
        {inspectorVisible && !isMobile && (
          <aside className="w-[280px] shrink-0 border-l border-border bg-panel overflow-y-auto">
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
                {t("designer.inspector")}
              </div>
            </div>
            {sel ? (
              <div className="p-3 space-y-3">
                <FormField label="Label">
                  <Input
                    value={sel.data.label}
                    onChange={(e) => patchData({ label: e.target.value })}
                  />
                </FormField>
                <FormField label={t("designer.node_type")}>
                  <div className="h-9 px-3 flex items-center text-sm border border-border rounded-md bg-bg-soft">
                    <Chip variant="accent">{sel.data.kind}</Chip>
                  </div>
                </FormField>

                {/* ===== Trigger — nguồn kích hoạt ở CẤP WORKFLOW ===== */}
                {sel.data.kind === "trigger" && (
                  <>
                    <FormField label={t("designer.trigger_source")}>
                      <Select
                        value={triggerType}
                        onChange={(e) =>
                          setWorkflowTrigger(workflowId, e.target.value as WorkflowTriggerType)
                        }
                      >
                        <option value="manual">Thủ công / API</option>
                        <option value="cron">Lịch (cron)</option>
                        <option value="iot_telemetry">IoT telemetry</option>
                        <option value="webhook">Webhook</option>
                        <option value="entity_changed">Đổi dữ liệu (entity)</option>
                      </Select>
                    </FormField>

                    {triggerType === "manual" && (
                      <div className="text-[11px] text-muted leading-relaxed">
                        Chạy tay từ nút "Chạy" hoặc gọi API. Payload truyền vào nằm trong{" "}
                        <code>vars</code>.
                      </div>
                    )}
                    {triggerType === "cron" && (
                      <div className="text-[11px] text-muted leading-relaxed">
                        Lịch chạy (cron) khai báo ở panel <strong>Chạy</strong> → thêm lịch. pg-boss
                        quét mỗi phút và tự kích hoạt theo cron.
                      </div>
                    )}
                    {triggerType === "iot_telemetry" && (
                      <>
                        <FormField label={t("designer.trigger_device")}>
                          <Input
                            placeholder="(trống = mọi thiết bị)"
                            value={
                              typeof triggerConfig.deviceId === "string"
                                ? triggerConfig.deviceId
                                : ""
                            }
                            onChange={(e) =>
                              setWorkflowTrigger(workflowId, "iot_telemetry", {
                                ...triggerConfig,
                                deviceId: e.target.value,
                              })
                            }
                          />
                        </FormField>
                        <FormField label={t("designer.trigger_channel")}>
                          <Input
                            placeholder="(trống = mọi channel)"
                            value={
                              typeof triggerConfig.channel === "string" ? triggerConfig.channel : ""
                            }
                            onChange={(e) =>
                              setWorkflowTrigger(workflowId, "iot_telemetry", {
                                ...triggerConfig,
                                channel: e.target.value,
                              })
                            }
                          />
                        </FormField>
                        <div className="text-[11px] text-muted leading-relaxed">
                          Mỗi telemetry khớp filter → chạy workflow. Payload nạp vào{" "}
                          <code>vars.iot</code> {"= {device, channel, payload, ts}"}.
                        </div>
                      </>
                    )}
                    {triggerType === "entity_changed" && (
                      <>
                        <FormField label={t("designer.trigger_entity")}>
                          <Select
                            value={
                              typeof triggerConfig.entityId === "string"
                                ? triggerConfig.entityId
                                : ""
                            }
                            onChange={(e) =>
                              setWorkflowTrigger(workflowId, "entity_changed", {
                                ...triggerConfig,
                                entityId: e.target.value,
                              })
                            }
                          >
                            <option value="">(mọi entity)</option>
                            {entitiesList.map((ent) => (
                              <option key={ent.id} value={ent.id}>
                                {ent.name}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                        <FormField label={t("designer.trigger_events")}>
                          <div className="flex gap-3 text-xs">
                            {(["create", "update", "delete"] as const).map((ev) => (
                              <label key={ev} className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={eventOn(ev)}
                                  onChange={() => toggleTrigEvent(ev)}
                                />
                                {ev}
                              </label>
                            ))}
                          </div>
                        </FormField>
                        <div className="text-[11px] text-muted leading-relaxed">
                          Khi record khớp create/update/delete → chạy workflow. Payload nạp vào{" "}
                          <code>vars.entity</code> {"= {entityName, event, recordId, data}"}.
                          Workflow phải đang <strong>Active</strong>.
                        </div>
                      </>
                    )}
                    {triggerType === "webhook" && (
                      <>
                        <FormField label={t("designer.webhook_url")}>
                          <Input
                            readOnly
                            placeholder="(bấm Tạo token)"
                            value={
                              webhookToken
                                ? `${window.location.origin}/webhooks/workflow/${webhookToken}`
                                : ""
                            }
                            onFocus={(e) => e.currentTarget.select()}
                          />
                        </FormField>
                        <Button
                          variant="default"
                          size="sm"
                          icon={<I.Bolt size={12} />}
                          onClick={() =>
                            setWorkflowTrigger(workflowId, "webhook", {
                              ...triggerConfig,
                              token: `wh_${crypto.randomUUID().replace(/-/g, "")}`,
                            })
                          }
                        >
                          {webhookToken ? "Tạo token mới" : "Tạo token"}
                        </Button>
                        <div className="text-[11px] text-muted leading-relaxed">
                          POST (body JSON) tới URL này sẽ chạy workflow; payload vào{" "}
                          <code>vars.webhook</code>. Workflow phải đang <strong>Active</strong>.
                          Token là bí mật — đừng để lộ; tạo token mới sẽ vô hiệu URL cũ.
                        </div>
                      </>
                    )}
                    <div className="text-[11px] text-muted leading-relaxed border-t border-border pt-2">
                      Nguồn trigger thuộc <strong>cả workflow</strong> (không riêng node này);
                      runner bắt đầu từ mọi node Trigger.
                    </div>
                  </>
                )}

                {/* ===== Action — gọi MCP tool ===== */}
                {sel.data.kind === "action" && (
                  <>
                    <FormField label={t("designer.mcp_tool")}>
                      <Select
                        value={
                          typeof sel.data.config?.tool === "string" ? sel.data.config.tool : ""
                        }
                        onChange={(e) => patchConfig("tool", e.target.value)}
                      >
                        <option value="">{t("field.choose_tool")}</option>
                        {/* Tool đã chọn nhưng server không còn liệt kê → vẫn giữ option */}
                        {typeof sel.data.config?.tool === "string" &&
                          sel.data.config.tool &&
                          !mcpTools.some((tl) => tl.name === sel.data.config?.tool) && (
                            <option value={sel.data.config.tool}>
                              {sel.data.config.tool} (offline)
                            </option>
                          )}
                        {mcpTools.map((tl) => (
                          <option key={tl.name} value={tl.name}>
                            {tl.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <JsonField
                      key={`${sel.id}-args`}
                      label="args (JSON)"
                      value={sel.data.config?.args}
                      placeholder='{"id": 123}'
                      onValid={(v) => patchConfig("args", v)}
                    />
                    <div className="text-[11px] text-muted">
                      Output object của tool → merge vào <code>vars</code>.
                    </div>
                  </>
                )}

                {/* ===== Condition — biểu thức formula rẽ nhánh Y/N ===== */}
                {sel.data.kind === "condition" && (
                  <>
                    <FormField label={t("designer.cond_expr")}>
                      <Input
                        placeholder="{total} > 50000000"
                        value={
                          typeof sel.data.config?.expr === "string" ? sel.data.config.expr : ""
                        }
                        onChange={(e) => patchConfig("expr", e.target.value)}
                      />
                    </FormField>
                    <div className="text-[11px] text-muted leading-relaxed">
                      Formula trả về đúng/sai. Tham chiếu vars/cổng input bằng{" "}
                      <code>{"{ten_bien}"}</code>; hỗ trợ <code>AND/OR/IF</code> và so sánh{" "}
                      <code>{"> < >= <= = !="}</code>. ĐÚNG → nhánh{" "}
                      <span className="text-success font-semibold">Y</span>, SAI → nhánh{" "}
                      <span className="text-danger font-semibold">N</span>. Bỏ trống = đi mọi nhánh.
                    </div>
                  </>
                )}

                {/* ===== Agent — gọi 1 LLM ===== */}
                {sel.data.kind === "agent" && (
                  <>
                    <FormField label={t("designer.agent_profile")}>
                      <Input
                        placeholder="(mặc định — profile chat của công ty)"
                        value={
                          typeof sel.data.config?.profile === "string"
                            ? sel.data.config.profile
                            : ""
                        }
                        onChange={(e) => patchConfig("profile", e.target.value)}
                      />
                    </FormField>
                    <FormField label={t("designer.agent_system")}>
                      <Textarea
                        rows={3}
                        placeholder="Bạn là agent ERP. Trả lời ngắn gọn."
                        value={
                          typeof sel.data.config?.system === "string" ? sel.data.config.system : ""
                        }
                        onChange={(e) => patchConfig("system", e.target.value)}
                      />
                    </FormField>
                    <FormField label={t("designer.agent_prompt")}>
                      <Textarea
                        rows={5}
                        placeholder="Bỏ trống = gửi toàn bộ vars (JSON) cho agent."
                        value={
                          typeof sel.data.config?.prompt === "string" ? sel.data.config.prompt : ""
                        }
                        onChange={(e) => patchConfig("prompt", e.target.value)}
                      />
                    </FormField>
                    <div className="text-[11px] text-muted">
                      Kết quả lưu vào <code>vars.agent_{sel.id}</code>.
                    </div>
                  </>
                )}

                {/* ===== Agent Chain — chuỗi agent tuần tự ===== */}
                {sel.data.kind === "agent_chain" && (
                  <>
                    <JsonField
                      key={`${sel.id}-steps`}
                      label={t("designer.chain_steps")}
                      value={sel.data.config?.steps}
                      rows={10}
                      expectArray
                      placeholder={
                        '[\n  { "system": "Tóm tắt", "prompt": "{noi_dung}" },\n' +
                        '  { "prompt": "Dịch sang tiếng Anh: {chain_prev}" }\n]'
                      }
                      onValid={(v) => patchConfig("steps", v)}
                    />
                    <FormField label={t("designer.chain_max")}>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={
                          typeof sel.data.config?.maxSteps === "number"
                            ? sel.data.config.maxSteps
                            : ""
                        }
                        placeholder="5"
                        onChange={(e) =>
                          patchConfig(
                            "maxSteps",
                            e.target.value === "" ? undefined : Number(e.target.value),
                          )
                        }
                      />
                    </FormField>
                    <div className="text-[11px] text-muted leading-relaxed">
                      Mỗi phần tử là 1 agent (<code>system</code>/<code>prompt</code>); output step
                      trước vào <code>{"{chain_prev}"}</code> của step sau. Tối đa 20 step.
                    </div>
                  </>
                )}

                {/* ===== Delay — chờ N phút ===== */}
                {sel.data.kind === "delay" && (
                  <>
                    <FormField label={t("field.wait_minutes")}>
                      <Input
                        type="number"
                        min={0}
                        placeholder="30"
                        value={
                          typeof sel.data.config?.minutes === "number"
                            ? sel.data.config.minutes
                            : ""
                        }
                        onChange={(e) =>
                          patchConfig("minutes", e.target.value === "" ? 0 : Number(e.target.value))
                        }
                      />
                    </FormField>
                    <div className="text-[11px] text-muted">
                      Chờ trước khi sang node kế. Chạy thử cap ~3s để không treo runner.
                    </div>
                  </>
                )}

                {/* ===== Approval — tạm dừng chờ duyệt ===== */}
                {sel.data.kind === "approval" && (
                  <div className="text-[11px] text-muted leading-relaxed">
                    Workflow tạm dừng (status <code>paused</code>) tại node này chờ duyệt; người
                    duyệt xử lý ở màn <code>/approvals</code>. Dùng "Quyền tối thiểu" bên dưới để
                    chỉ role đủ quyền mới trigger được nhánh có node này.
                  </div>
                )}

                {/* ===== Procedure — gọi native procedure ===== */}
                {sel.data.kind === "procedure" && (
                  <>
                    <FormField label={t("designer.proc_name_field")}>
                      <Input
                        placeholder="snake_case_name"
                        value={
                          typeof sel.data.config?.name === "string" ? sel.data.config.name : ""
                        }
                        onChange={(e) => patchConfig("name", e.target.value)}
                      />
                    </FormField>
                    <JsonField
                      key={`${sel.id}-pargs`}
                      label="args (JSON)"
                      value={sel.data.config?.args}
                      placeholder='{"id": 123}'
                      onValid={(v) => patchConfig("args", v)}
                    />
                    <div className="text-[11px] text-muted">
                      Output object → merge vào vars. Quản lý ở <code>/procedures</code>.
                    </div>
                  </>
                )}

                {/* ===== Code — JS sandbox ===== */}
                {sel.data.kind === "code" && (
                  <>
                    <FormField label="JS code (sandbox)">
                      <Textarea
                        rows={12}
                        className="font-mono! text-xs! leading-relaxed"
                        placeholder={`// vars: workflow variables; mutate then return\nconst r = await callTool("ping", {});\nconsole.log("got", r);\nvars.result = r;\nreturn vars;`}
                        value={
                          typeof sel.data.config?.code === "string" ? sel.data.config.code : ""
                        }
                        onChange={(e) => patchConfig("code", e.target.value)}
                      />
                    </FormField>
                    <div className="text-[11px] text-muted leading-relaxed">
                      API: <code>vars</code>, <code>callTool(name, args)</code>,{" "}
                      <code>fetch(url, init?)</code>, <code>console.log</code>.<br />
                      Return object → merge vào vars. Timeout 5s, RAM 128MB.
                    </div>
                  </>
                )}

                {/* ===== Cổng dữ liệu I/O (kéo edge nối node) ===== */}
                {sel.data.kind !== "approval" && (
                  <div className="border-t border-border pt-3 space-y-3">
                    {sel.data.kind !== "trigger" && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wider text-accent-2 font-semibold">
                            {t("designer.ports_in")}
                          </span>
                          <button
                            type="button"
                            className="text-[11px] text-accent hover:underline"
                            onClick={() => addPort("inputs")}
                          >
                            + {t("designer.port_add")}
                          </button>
                        </div>
                        {selPorts("inputs").length === 0 && (
                          <div className="text-[11px] text-muted">
                            {t("designer.ports_in_hint")}
                          </div>
                        )}
                        {selPorts("inputs").map((p, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: id cổng do user sửa nên không dùng làm key (mất focus); hàng ít reorder
                          <div key={`inp-${i}`} className="flex gap-1 items-center">
                            <Input
                              className="text-xs!"
                              placeholder="id"
                              value={p.id}
                              onChange={(e) => updatePort("inputs", i, { id: e.target.value })}
                            />
                            <Input
                              className="text-xs!"
                              placeholder={t("designer.port_static")}
                              value={p.value == null ? "" : String(p.value)}
                              onChange={(e) => updatePort("inputs", i, { value: e.target.value })}
                            />
                            <button
                              type="button"
                              className="shrink-0 text-muted hover:text-danger"
                              onClick={() => removePort("inputs", i)}
                            >
                              <I.Trash size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {sel.data.kind !== "delay" && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wider text-accent font-semibold">
                            {t("designer.ports_out")}
                          </span>
                          <button
                            type="button"
                            className="text-[11px] text-accent hover:underline"
                            onClick={() => addPort("outputs")}
                          >
                            + {t("designer.port_add")}
                          </button>
                        </div>
                        {selPorts("outputs").length === 0 && (
                          <div className="text-[11px] text-muted">
                            {t("designer.ports_out_hint")}
                          </div>
                        )}
                        {selPorts("outputs").map((p, i) => (
                          <div
                            // biome-ignore lint/suspicious/noArrayIndexKey: id cổng do user sửa nên không dùng làm key (mất focus); hàng ít reorder
                            key={`outp-${i}`}
                            className="space-y-1 border border-border rounded-md p-1.5"
                          >
                            <div className="flex gap-1 items-center">
                              <Input
                                className="text-xs!"
                                placeholder="id"
                                value={p.id}
                                onChange={(e) => updatePort("outputs", i, { id: e.target.value })}
                              />
                              <button
                                type="button"
                                className="shrink-0 text-muted hover:text-danger"
                                onClick={() => removePort("outputs", i)}
                              >
                                <I.Trash size={12} />
                              </button>
                            </div>
                            <Input
                              className="text-xs!"
                              placeholder={t("designer.port_formula")}
                              value={p.formula ?? ""}
                              onChange={(e) =>
                                updatePort("outputs", i, { formula: e.target.value })
                              }
                            />
                            <Input
                              className="text-xs!"
                              placeholder={t("designer.port_path")}
                              value={p.path ?? ""}
                              onChange={(e) => updatePort("outputs", i, { path: e.target.value })}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Gợi ý cổng input khả dụng để tham chiếu trong formula. */}
                    {selPorts("inputs").length > 0 && (
                      <div className="text-[11px] text-muted leading-relaxed">
                        {t("designer.ports_vars")}:{" "}
                        {selPorts("inputs")
                          .map((p) => `{${p.id}}`)
                          .join(", ")}
                      </div>
                    )}
                  </div>
                )}

                {/* ===== Chung — quyền tối thiểu (field-level RBAC P3.3) ===== */}
                <FormField label={t("designer.requires_role")}>
                  <Select
                    value={
                      typeof sel.data.config?.requiresRole === "string"
                        ? sel.data.config.requiresRole
                        : ""
                    }
                    onChange={(e) => patchConfig("requiresRole", e.target.value || undefined)}
                  >
                    <option value="">{t("designer.role_any")}</option>
                    <option value="viewer">viewer</option>
                    <option value="editor">editor</option>
                    <option value="admin">admin</option>
                  </Select>
                </FormField>
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
            ) : selEdge ? (
              (() => {
                const isData = (selEdge.data as { kind?: string } | undefined)?.kind === "data";
                const srcNode = nodes.find((n) => n.id === selEdge.source);
                const tgtNode = nodes.find((n) => n.id === selEdge.target);
                const fromCondition = srcNode?.data.kind === "condition";
                const branch =
                  selEdge.sourceHandle === "yes"
                    ? "yes"
                    : selEdge.sourceHandle === "no"
                      ? "no"
                      : "";
                return (
                  <div className="p-3 space-y-3">
                    <FormField label={t("designer.edge_kind")}>
                      <div className="h-9 px-3 flex items-center text-sm border border-border rounded-md bg-bg-soft">
                        <Chip variant={isData ? "default" : "accent"}>
                          {isData ? t("designer.edge_data") : t("designer.edge_control")}
                        </Chip>
                      </div>
                    </FormField>
                    <div className="text-[11px] text-muted leading-relaxed">
                      <span className="text-fg">{srcNode?.data.label ?? selEdge.source}</span>
                      {" → "}
                      <span className="text-fg">{tgtNode?.data.label ?? selEdge.target}</span>
                    </div>
                    {!isData && fromCondition && (
                      <FormField label={t("designer.edge_branch")}>
                        <Select
                          value={branch}
                          onChange={(e) => {
                            const v = e.target.value;
                            patchEdge(selEdge.id, {
                              sourceHandle: v || null,
                              label: v === "yes" ? "Yes" : v === "no" ? "No" : undefined,
                            });
                          }}
                        >
                          <option value="">—</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </Select>
                      </FormField>
                    )}
                    {!isData && !fromCondition && (
                      <FormField label={t("designer.edge_label")}>
                        <Input
                          value={typeof selEdge.label === "string" ? selEdge.label : ""}
                          onChange={(e) =>
                            patchEdge(selEdge.id, { label: e.target.value || undefined })
                          }
                        />
                      </FormField>
                    )}
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<I.Trash size={12} />}
                      onClick={() => removeEdge(selEdge.id)}
                    >
                      {t("designer.delete_edge")}
                    </Button>
                  </div>
                );
              })()
            ) : (
              <div className="p-6 text-center text-sm text-muted">
                {t("designer.select_node_or_edge")}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
