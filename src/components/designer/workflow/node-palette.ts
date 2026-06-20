/* Bảng node palette workflow — 6 kind builtin + node từ plugin
   (pluginRegistry). Tách từ WorkflowDesigner.tsx. */
import { pluginRegistry } from "@erp-framework/core";
import type { IconName } from "@/lib/object-types";

/* (string & {}) — giữ gợi ý 6 kind builtin nhưng cho phép kind tuỳ ý
   do workflow-node plugin thêm vào. */
export type WorkflowNodeKind =
  | "trigger"
  | "action"
  | "condition"
  | "switch"
  | "agent"
  | "approval"
  | "delay"
  | "code"
  | "procedure"
  | "setvar"
  | "http"
  | "subworkflow"
  | "foreach"
  | "loop-until"
  | "llm"
  | "knowledge"
  | (string & {});

export interface NodePaletteItem {
  kind: WorkflowNodeKind;
  label: string;
  desc: string;
  icon: IconName;
  color: string;
}

export const NODE_PALETTE: NodePaletteItem[] = [
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
  {
    kind: "switch",
    label: "Switch",
    desc: "Rẽ nhiều nhánh theo giá trị",
    icon: "GitFork",
    color: "var(--warning)",
  },
  { kind: "agent", label: "Agent", desc: "Gọi LLM", icon: "Sparkles", color: "var(--accent)" },
  {
    kind: "llm",
    label: "LLM",
    desc: "Một lượt gọi LLM",
    icon: "MessageSquare",
    color: "var(--accent)",
  },
  {
    kind: "knowledge",
    label: "Knowledge",
    desc: "Tra Knowledge Base (RAG)",
    icon: "BookOpen",
    color: "var(--accent-2)",
  },
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
  {
    kind: "setvar",
    label: "Đặt biến",
    desc: "Biến đổi data bằng formula",
    icon: "Braces",
    color: "var(--accent)",
  },
  {
    kind: "http",
    label: "HTTP",
    desc: "Gọi API ngoài",
    icon: "Globe",
    color: "var(--accent-2)",
  },
  {
    kind: "subworkflow",
    label: "Sub-workflow",
    desc: "Gọi workflow con",
    icon: "Workflow",
    color: "var(--accent-2)",
  },
  {
    kind: "foreach",
    label: "ForEach",
    desc: "Lặp mảng → chạy workflow con",
    icon: "Repeat",
    color: "var(--accent-2)",
  },
  {
    kind: "loop-until",
    label: "Loop-Until",
    desc: "Lặp workflow con tới khi điều kiện đúng",
    icon: "RefreshCw",
    color: "var(--accent-2)",
  },
];

/** Palette node = builtin + workflow-node plugin đã đăng ký trong registry. */
export function getNodePalette(): NodePaletteItem[] {
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
