export type NodeType =
  | "trigger"
  | "action"
  | "condition"
  | "loop"
  | "agent"
  | "approval"
  | "delay"
  | "subflow";

export interface WorkflowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** Cho condition node: "true" | "false" | label tuỳ ý */
  sourceHandle?: string;
}
export interface WorkflowDef {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  triggerType?: "manual" | "scheduled" | "data-change" | "webhook";
  triggerConfig?: Record<string, unknown>;
}
