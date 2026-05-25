/* ==========================================================
   ai-design-prompts.ts — System prompts + response contract
   cho AI design assistant (entity / page / workflow / agent).
   - Mỗi object type có:
       SYSTEM[type]  → system message gửi LLM
       buildUserMessage(type, request, context) → user message
   - LLM bắt buộc reply JSON theo schema. Mode "refine" thêm
     config hiện tại + lệnh chỉnh.
   ========================================================== */

export type DesignObjectType = "entity" | "page" | "workflow" | "agent";

export interface DesignContext {
  /** MCP tool có sẵn (tên + mô tả tóm tắt) */
  mcpTools?: Array<{ name: string; description?: string }>;
  /** Danh sách entity khác — để LLM gợi ý lookup */
  otherEntities?: Array<{ id: string; name: string; mcp?: string; fieldKeys?: string[] }>;
  /** Sample data 5 row đầu nếu có */
  sampleRows?: unknown[];
}

export interface DesignRequest {
  /** Lệnh tự nhiên từ user */
  prompt: string;
  /** Object hiện tại (nếu refine) — undefined nếu tạo mới */
  current?: unknown;
}

// ============= Schema hint cho từng object type =============

const ENTITY_SCHEMA_HINT = `
Trả về JSON đúng theo format:
{
  "name": "Tên hiển thị",              // string, VN, vd: "Nhân viên"
  "mcp": "namespace.entity",             // dot-notation, vd: "hr.employee"
  "icon": "Users",                       // optional, 1 trong: Users/Cart/Package/Briefcase/File/Warehouse/Database
  "fields": [
    {
      "name": "key_snake_case",          // bắt buộc, snake_case, ASCII
      "label": "Nhãn tiếng Việt",        // bắt buộc
      "type": "text|longtext|number|integer|currency|date|datetime|bool|select|multiselect|email|phone|url|lookup|formula|file|image|tag",
      "required": true,                  // optional
      "options": ["A","B","C"],          // chỉ khi type=select|multiselect
      "ref": "other_entity_id",          // chỉ khi type=lookup
      "formula": "{price}*{qty}"         // chỉ khi type=formula
    }
  ],
  "primaryKey": "code"                   // tên field PK, default "id" hoặc "code"
}
`.trim();

const PAGE_SCHEMA_HINT = `
Trả về JSON đúng theo format. Grid 12 cột, x+w ≤ 12.
{
  "name": "Tên trang",
  "icon": "Layout|BarChart|Cart|Users|...",
  "components": [
    {
      "type": "KPI|Chart|List|Form|Kanban|HTML",
      "title": "Tiêu đề",
      "x": 0, "y": 0, "w": 3, "h": 2,      // grid 12 cột
      "entityId": "customer",              // optional cho List/Form/Kanban
      "chartKind": "bar|line|area|pie|doughnut",  // chỉ Chart
      "metric": "count|sum|avg",           // chỉ KPI
      "field": "total",                    // KPI/Chart: field aggregate
      "groupBy": "status"                  // Chart group
    }
  ]
}
`.trim();

const WORKFLOW_SCHEMA_HINT = `
Trả về JSON. Nodes có toạ độ tuyệt đối (x, y) pixel; edges nối source→target theo id.
{
  "name": "Tên workflow",
  "nodes": [
    {
      "id": "n1",
      "type": "trigger|action|condition|agent|approval|delay",
      "label": "Khi đơn > 50tr",
      "x": 100, "y": 80,
      "config": {                          // optional, tuỳ type
        "event": "order.create",           // trigger
        "tool": "sales.order.update",      // action
        "expr": "{total} > 50000000",      // condition
        "agentId": "a_sales",              // agent
        "minutes": 30                      // delay
      }
    }
  ],
  "edges": [ { "source": "n1", "target": "n2", "label": "true" } ]
}
`.trim();

const AGENT_SCHEMA_HINT = `
Trả về JSON:
{
  "name": "Tên agent",
  "model": "claude-sonnet-4-6|claude-haiku-4-5|gpt-4o-mini|...",
  "systemPrompt": "Bạn là trợ lý ... ngắn gọn, súc tích. Luôn trả lời tiếng Việt.",
  "temperature": 0.5,
  "tools": ["mcp_tool_name_1", "mcp_tool_name_2"]   // chọn từ danh sách MCP tool đã liệt kê
}
`.trim();

// ============= System prompts =============

const SYSTEM_BASE = `
Bạn là "ERP Design Assistant" — chuyên gia thiết kế ứng dụng ERP bằng tiếng Việt.
Nhiệm vụ: từ mô tả của người dùng, sinh ra config JSON cho ứng dụng.

Quy tắc:
1. CHỈ trả lời JSON hợp lệ trong code block \`\`\`json ... \`\`\`, không thêm prose ngoài.
2. Nếu user yêu cầu chỉnh sửa, dựa vào config hiện tại + áp dụng thay đổi rồi trả về TOÀN BỘ config mới.
3. Field name dùng snake_case ASCII. Label dùng tiếng Việt có dấu.
4. Suy luận type chính xác từ ngữ cảnh ("lương" → currency, "ngày sinh" → date, "email" → email).
5. Nếu thiếu thông tin, đoán hợp lý dựa trên best practice ERP, không hỏi lại.
`.trim();

export const SYSTEM_PROMPTS: Record<DesignObjectType, string> = {
  entity: `${SYSTEM_BASE}\n\n=== Output schema cho ENTITY ===\n${ENTITY_SCHEMA_HINT}`,
  page: `${SYSTEM_BASE}\n\n=== Output schema cho PAGE ===\n${PAGE_SCHEMA_HINT}`,
  workflow: `${SYSTEM_BASE}\n\n=== Output schema cho WORKFLOW ===\n${WORKFLOW_SCHEMA_HINT}`,
  agent: `${SYSTEM_BASE}\n\n=== Output schema cho AGENT ===\n${AGENT_SCHEMA_HINT}`,
};

// ============= User message builder =============

export function buildUserMessage(
  type: DesignObjectType,
  request: DesignRequest,
  context: DesignContext = {},
): string {
  const parts: string[] = [];

  // 1. Context block
  if (context.mcpTools?.length) {
    parts.push("## MCP tools có sẵn (dùng cho bindings/agent.tools):");
    parts.push(
      context.mcpTools
        .slice(0, 40) // hard cap để khỏi tốn token
        .map((t) => `- \`${t.name}\`${t.description ? `: ${t.description.slice(0, 80)}` : ""}`)
        .join("\n"),
    );
  }
  if (context.otherEntities?.length) {
    parts.push("\n## Các entity khác (dùng cho lookup ref):");
    parts.push(
      context.otherEntities
        .map(
          (e) =>
            `- id="${e.id}", name="${e.name}"${e.fieldKeys ? `, fields=[${e.fieldKeys.slice(0, 8).join(",")}]` : ""}`,
        )
        .join("\n"),
    );
  }
  if (context.sampleRows?.length) {
    parts.push("\n## Sample data (5 row đầu):");
    parts.push(
      `\`\`\`json\n${JSON.stringify(context.sampleRows.slice(0, 5), null, 2).slice(0, 2000)}\n\`\`\``,
    );
  }

  // 2. Refine mode — kèm config hiện tại
  if (request.current) {
    parts.push("\n## Config hiện tại — hãy chỉnh sửa theo yêu cầu bên dưới:");
    parts.push(`\`\`\`json\n${JSON.stringify(request.current, null, 2)}\n\`\`\``);
  }

  // 3. Yêu cầu
  parts.push("\n## Yêu cầu:");
  parts.push(request.prompt.trim());

  parts.push(`\nTrả về JSON ${type} hoàn chỉnh, đúng schema, trong code block.`);

  return parts.join("\n");
}

// ============= Response shape (validation cấp 1) =============

export interface EntityDesign {
  name: string;
  mcp?: string;
  icon?: string;
  fields: Array<{
    name: string;
    label: string;
    type: string;
    required?: boolean;
    options?: string[];
    ref?: string;
    formula?: string;
  }>;
  primaryKey?: string;
}

export interface PageDesign {
  name: string;
  icon?: string;
  components: Array<{
    type: string;
    title: string;
    x: number;
    y: number;
    w: number;
    h: number;
    entityId?: string;
    chartKind?: string;
    metric?: string;
    field?: string;
    groupBy?: string;
  }>;
}

export interface WorkflowDesign {
  name: string;
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    x: number;
    y: number;
    config?: Record<string, unknown>;
  }>;
  edges: Array<{ source: string; target: string; label?: string }>;
}

export interface AgentDesign {
  name: string;
  model: string;
  systemPrompt: string;
  temperature?: number;
  tools?: string[];
}

export type DesignByType<T extends DesignObjectType> = T extends "entity"
  ? EntityDesign
  : T extends "page"
    ? PageDesign
    : T extends "workflow"
      ? WorkflowDesign
      : T extends "agent"
        ? AgentDesign
        : never;
