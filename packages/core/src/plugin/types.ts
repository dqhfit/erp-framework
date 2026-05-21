/* ==========================================================
   Plugin SDK — hợp đồng để bên thứ ba mở rộng framework mà
   KHÔNG sửa lõi. 5 loại plugin: field-type, workflow-node,
   page-widget, mcp-connector, llm-adapter.
   Hợp đồng (interface) nằm ở core (thuần); phần render UI của
   field-type/page-widget sẽ ở @erp-framework/ui.
   ========================================================== */
import type { EntityFieldDef } from "../datasource/index";

/** Phiên bản API plugin hiện tại của framework. */
export const CURRENT_API_VERSION = "0.1.0";

/* ── Field type — kiểu field tuỳ biến ─────────────────────── */
export interface FieldTypePlugin {
  kind: "field-type";
  /** Định danh kiểu, vd "currency", "rating". */
  type: string;
  label: string;
  /** Tên icon gợi ý cho palette designer (chuỗi — UI tự map sang component). */
  icon?: string;
  /** Mô tả ngắn hiển thị trong palette. */
  description?: string;
  /** Ép giá trị thô về kiểu JSON chuẩn (dùng trong validate-on-write). */
  coerce: (
    raw: unknown,
    def: EntityFieldDef,
  ) => { value: unknown } | { error: string };
}

/* ── Workflow node — loại node tuỳ biến ───────────────────── */
export interface WorkflowNodeContext {
  config: Record<string, unknown>;
  vars: Record<string, unknown>;
}
export interface WorkflowNodeResult {
  /** Output gộp vào vars của workflow. */
  output?: Record<string, unknown>;
  /** Nhãn nhánh để rẽ edge (vd "true"/"false"). */
  branch?: string;
  detail?: string;
}
export interface WorkflowNodePlugin {
  kind: "workflow-node";
  type: string;
  label: string;
  /** Tên icon gợi ý cho palette designer. */
  icon?: string;
  description?: string;
  run: (ctx: WorkflowNodeContext) => Promise<WorkflowNodeResult>;
}

/* ── Page widget — thành phần UI tuỳ biến ─────────────────── */
export interface PageWidgetPlugin {
  kind: "page-widget";
  type: string;
  label: string;
  defaultConfig?: Record<string, unknown>;
}

/* ── MCP connector ────────────────────────────────────────── */
export interface McpConnectorPlugin {
  kind: "mcp-connector";
  id: string;
  label: string;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

/* ── LLM adapter ──────────────────────────────────────────── */
export interface LlmRequest {
  model: string;
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}
export interface LlmResponse {
  text: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}
export interface LlmAdapterPlugin {
  kind: "llm-adapter";
  id: string;
  label: string;
  send: (req: LlmRequest) => Promise<LlmResponse>;
}

/** Một plugin bất kỳ. */
export type Plugin =
  | FieldTypePlugin
  | WorkflowNodePlugin
  | PageWidgetPlugin
  | McpConnectorPlugin
  | LlmAdapterPlugin;

/** Một gói plugin do bên thứ ba phát hành. */
export interface PluginModule {
  name: string;
  /** Phiên bản API plugin mà gói này nhắm tới (semver). */
  apiVersion: string;
  plugins: Plugin[];
}
