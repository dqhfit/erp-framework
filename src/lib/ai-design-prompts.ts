/* ==========================================================
   ai-design-prompts.ts — System prompts + response contract
   cho AI design assistant (entity / page / workflow / agent).
   - Mỗi object type có:
       SYSTEM[type]  → system message gửi LLM
       buildUserMessage(type, request, context) → user message
   - LLM bắt buộc reply JSON theo schema. Mode "refine" thêm
     config hiện tại + lệnh chỉnh.
   ========================================================== */

import type { DataSourceDsl } from "@erp-framework/core";

export type DesignObjectType = "entity" | "page" | "workflow" | "agent" | "datasource";

export interface DesignContext {
  /** MCP tool có sẵn (tên + mô tả tóm tắt) */
  mcpTools?: Array<{ name: string; description?: string }>;
  /** Danh sách entity khác — để LLM gợi ý lookup */
  otherEntities?: Array<{ id: string; name: string; mcp?: string; fieldKeys?: string[] }>;
  /** Catalog đối tượng đầy đủ (cho datasource) — field name + type + ref (TÊN đích). */
  entityCatalog?: Array<{
    id: string;
    name: string;
    fields: Array<{ name: string; type: string; ref?: string }>;
    primaryKey?: string;
  }>;
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
      "type": "trigger|action|condition|agent|agent_chain|approval|delay|code|procedure",
      "label": "Khi đơn > 50tr",
      "x": 100, "y": 80,
      "config": {                          // optional, tuỳ type
        "event": "order.create",           // trigger
        "tool": "sales.order.update",      // action
        "expr": "{total} > 50000000",      // condition
        "agentId": "a_sales",              // agent
        "minutes": 30,                     // delay
        "code": "return { ok: true }",     // code (JS sandbox)
        "name": "inventory.reserve",       // procedure (native procedure name + args)
        "args": {}                         // procedure / action
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

const DATASOURCE_SCHEMA_HINT = `
Trả về JSON mô tả "Nguồn dữ liệu" (gộp NHIỀU đối tượng thành 1 bảng phẳng đọc/ghi)
theo format DSL dùng TÊN đối tượng + alias:
{
  "base": "TenDoiTuongGoc",          // đối tượng gốc (aggregate root, ghi được)
  "joins": [
    {
      "as": "khach_hang",            // alias duy nhất cho quan hệ (đặt tên node con)
      "from": "TenDoiTuongGoc",      // TÊN đối tượng gốc HOẶC alias join trước (lồng nhiều cấp)
      "fromField": "ma_kh",          // cột trên 'from' chứa giá trị nối
      "to": "KhachHang",             // TÊN đối tượng đích
      "toField": "ma",               // cột đích khớp; bỏ trống hoặc "id" = khớp record id (lookup)
      "kind": "left"                 // "left" (giữ row gốc) | "inner" (lọc thiếu)
    }
  ],
  "columns": [
    { "from": "TenDoiTuongGoc", "field": "so_dh", "as": "so_dh", "label": "Số ĐH", "writable": true },
    { "from": "khach_hang", "field": "ten", "as": "khach_ten", "label": "Tên KH" }
  ],
  "aggregates": [
    // 1-N (reverse FK): đếm/cộng record con trỏ ngược về node nguồn.
    { "as": "so_dong", "label": "Số dòng", "fn": "count", "of": "ChiTietDonHang", "byField": "don_hang_id" },
    { "as": "tong_sl", "label": "Tổng SL", "fn": "sum", "of": "ChiTietDonHang", "byField": "don_hang_id", "valueField": "so_luong" },
    // N-N qua bảng nối: 'of' = bảng nối, 'via' = entity thật chứa valueField.
    { "as": "tong_gia_sp", "fn": "sum", "of": "DonHang_SanPham", "byField": "don_hang_id", "valueField": "gia", "via": { "entity": "SanPham", "field": "san_pham_id" } }
  ],
  "computed": [
    // Cột tính toán (formula trên CỘT PHẲNG khác, tham chiếu {key}). Read-only.
    { "as": "thanh_tien", "label": "Thành tiền", "expr": "{so_luong} * {don_gia}", "type": "number" },
    { "as": "ho_ten", "expr": "CONCAT({ho}, " ", {ten})" }
  ],
  "limit": 100
}
Quy tắc DATASOURCE (bắt buộc):
- CHỈ dùng TÊN đối tượng + tên field CÓ trong "Danh mục đối tượng" đã liệt kê. TUYỆT ĐỐI không bịa.
- 'from' của join/column tham chiếu TÊN-đối-tượng-gốc hoặc ALIAS join (KHÔNG dùng tên đối tượng đích).
- Nếu node cha có field lookup trỏ tới đích (type lookup, '->' tên đích) → đặt fromField = field lookup đó, toField = "id".
- Ngược lại join theo cột nghiệp vụ: fromField = cột mã ở cha, toField = cột mã tương ứng ở đích.
- Field từ đối tượng gốc nên writable=true; field từ join để mặc định (chỉ đọc) trừ khi cần ghi ngược.
Quy tắc AGGREGATE (1-N / N-N, read-only):
- Dùng khi cần GOM nhiều record con về 1 số (đếm số dòng, tổng tiền, trung bình…).
- 1-N: 'of' = entity con, 'byField' = field FK trên con trỏ về node nguồn (mặc định khớp record id của 'from', 'from' mặc định base).
- N-N: 'of' = bảng nối, 'byField' = FK gần (về node nguồn); 'via.entity' = entity thật, 'via.field' = FK xa trên bảng nối → đọc 'valueField' trên entity thật.
- fn=count KHÔNG cần valueField; sum/avg/min/max BẮT BUỘC valueField.
- 'aggregates' là TUỲ CHỌN — bỏ qua nếu yêu cầu không cần gom.
Quy tắc COMPUTED (cột tính toán, read-only, TUỲ CHỌN):
- 'expr' tham chiếu CỘT PHẲNG khác bằng {key} (key của columns/aggregates/computed trước), KHÔNG dùng tên field gốc/entity.
- Hàm: IF, AND/OR/NOT, COALESCE, CONCAT/UPPER/LOWER/LEFT/RIGHT/REPLACE/LEN, ROUND/CEIL/FLOOR/ABS/MOD/POW, SUM/AVG/MIN/MAX, YEAR/MONTH/DAY/DAYS_BETWEEN/TODAY, FORMAT_VND…
- Computed eval SAU columns + aggregates; cột sau dùng được cột trước.
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
  datasource: `${SYSTEM_BASE}\n\n=== Output schema cho DATASOURCE ===\n${DATASOURCE_SCHEMA_HINT}`,
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
  if (context.entityCatalog?.length) {
    parts.push(
      "\n## Danh mục đối tượng (dùng TÊN + field CHÍNH XÁC; 'name:type', lookup có '->đích'):",
    );
    parts.push(
      context.entityCatalog
        .slice(0, 40)
        .map((e) => {
          const fs = e.fields
            .slice(0, 40)
            .map((f) => (f.ref ? `${f.name}:${f.type}->${f.ref}` : `${f.name}:${f.type}`))
            .join(", ");
          return `- ${e.name}${e.primaryKey ? ` (PK=${e.primaryKey})` : ""}: ${fs}`;
        })
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
        : T extends "datasource"
          ? DataSourceDsl
          : never;
