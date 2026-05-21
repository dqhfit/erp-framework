/* ==========================================================
   registry.ts — PluginRegistry: nạp & tra cứu plugin động.
   Thay cho các mảng hardcode (FIELD_TYPES, NODE_PALETTE…).
   ========================================================== */
import {
  CURRENT_API_VERSION,
  type Plugin, type PluginModule,
  type FieldTypePlugin, type WorkflowNodePlugin, type PageWidgetPlugin,
  type McpConnectorPlugin, type LlmAdapterPlugin,
} from "./types";

/**
 * Kiểm tương thích semver giữa apiVersion của plugin và framework.
 * - framework 0.x  → khớp cả major lẫn minor (0.x: minor là mốc breaking).
 * - framework >=1  → chỉ cần khớp major.
 */
export function isApiCompatible(
  pluginApi: string,
  frameworkApi: string = CURRENT_API_VERSION,
): boolean {
  const a = pluginApi.split(".").map(Number);
  const b = frameworkApi.split(".").map(Number);
  if (a.length < 2 || b.length < 2) return false;
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  if (b[0] === 0) return a[0] === 0 && a[1] === b[1];
  return a[0] === b[0];
}

export class PluginRegistry {
  private fieldTypes = new Map<string, FieldTypePlugin>();
  private workflowNodes = new Map<string, WorkflowNodePlugin>();
  private pageWidgets = new Map<string, PageWidgetPlugin>();
  private mcpConnectors = new Map<string, McpConnectorPlugin>();
  private llmAdapters = new Map<string, LlmAdapterPlugin>();
  private moduleNames: string[] = [];

  /** Nạp một gói plugin. Ném lỗi nếu apiVersion không tương thích. */
  register(mod: PluginModule): void {
    if (!isApiCompatible(mod.apiVersion)) {
      throw new Error(
        `Plugin "${mod.name}" nhắm apiVersion ${mod.apiVersion}, `
        + `không tương thích framework ${CURRENT_API_VERSION}`,
      );
    }
    for (const p of mod.plugins) this.add(p);
    this.moduleNames.push(mod.name);
  }

  private add(p: Plugin): void {
    switch (p.kind) {
      case "field-type":    this.fieldTypes.set(p.type, p); break;
      case "workflow-node": this.workflowNodes.set(p.type, p); break;
      case "page-widget":   this.pageWidgets.set(p.type, p); break;
      case "mcp-connector": this.mcpConnectors.set(p.id, p); break;
      case "llm-adapter":   this.llmAdapters.set(p.id, p); break;
    }
  }

  fieldType(type: string): FieldTypePlugin | undefined { return this.fieldTypes.get(type); }
  workflowNode(type: string): WorkflowNodePlugin | undefined { return this.workflowNodes.get(type); }
  pageWidget(type: string): PageWidgetPlugin | undefined { return this.pageWidgets.get(type); }
  mcpConnector(id: string): McpConnectorPlugin | undefined { return this.mcpConnectors.get(id); }
  llmAdapter(id: string): LlmAdapterPlugin | undefined { return this.llmAdapters.get(id); }

  listFieldTypes(): FieldTypePlugin[] { return [...this.fieldTypes.values()]; }
  listWorkflowNodes(): WorkflowNodePlugin[] { return [...this.workflowNodes.values()]; }
  listPageWidgets(): PageWidgetPlugin[] { return [...this.pageWidgets.values()]; }
  listMcpConnectors(): McpConnectorPlugin[] { return [...this.mcpConnectors.values()]; }
  listLlmAdapters(): LlmAdapterPlugin[] { return [...this.llmAdapters.values()]; }
  listModules(): string[] { return [...this.moduleNames]; }
}

/** Registry toàn cục mặc định của framework. */
export const pluginRegistry = new PluginRegistry();
