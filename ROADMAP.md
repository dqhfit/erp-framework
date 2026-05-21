# ERP Framework — Roadmap & Architecture

> Low-code/no-code ERP builder. MCP làm data source. AI agents hỗ trợ
> các bước thủ công. Người dùng tự thiết kế entity / form / workflow /
> dashboard mà không cần code.

## 1. Vision

| Khái niệm | Mô tả |
|-----------|-------|
| **Entity** | Master data model (Khách hàng, Đơn hàng, Sản phẩm, v.v). User định nghĩa fields. |
| **Page** | Layout do user kéo-thả: list, form, dashboard, kanban, v.v. |
| **Workflow** | Chuỗi nodes: trigger → action → condition → agent → approval → ... |
| **Tool call** | Node gọi MCP tool (CRUD, query, business logic ở server). |
| **Agent** | Node gọi LLM với context có sẵn, return structured result (JSON), điền vào pipeline. |
| **Dashboard** | Tổng hợp widget (giống `gesture-mcp-dashboard` hiện tại). |

## 2. Kiến trúc tổng

```
┌──────────────────────────────────────────────────────────────┐
│  Browser / Cowork                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Entity   │  │ Form/    │  │ Workflow │  │ Dashboard +  │  │
│  │ Designer │  │ List UI  │  │ Designer │  │ Reports      │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       └────────────┬┴────────────┬┘                │          │
│       ┌────────────▼─────────────▼─────────────────▼───────┐  │
│       │  Page Registry  +  Entity Registry  +  Runner      │  │
│       └────────────┬───────────────────────────────────────┘  │
│                    │ (JSON-RPC)                                │
└────────────────────┼──────────────────────────────────────────┘
                     ▼
            ┌────────────────────┐
            │  MCP Server        │  ← Data source
            │  - CRUD tools      │
            │  - Query tools     │
            │  - Business rules  │
            │  - Auth/RBAC       │
            └────────────────────┘
                     ▲
                     │ (HTTP / WS)
            ┌────────────────────┐
            │  Agent Bridge      │  ← Optional: Claude API / Local LLM
            │  - prompts         │     gọi từ trình duyệt qua proxy
            │  - structured out  │     hoặc node "agent" trong workflow
            └────────────────────┘
```

## 3. Folder structure

```
erp-framework/
├── index.html                  # Entry — bootstrap loader giống dashboard
├── README.md
├── ROADMAP.md
├── css/
│   └── styles.css              # Theme + layout (reuse dashboard's)
├── js/
│   ├── core/                   # ✅ COPY từ gesture-mcp-dashboard
│   │   ├── utils.js
│   │   ├── db.js               # IndexedDB persistence
│   │   ├── state.js
│   │   ├── themes.js
│   │   ├── i18n.js
│   │   ├── modal.js
│   │   └── mcp.js              # MCP client
│   ├── ui/                     # ✅ Reuse + extend
│   │   ├── datagrid.js         # COPY từ dashboard (đã modular)
│   │   ├── datagrid-agg.js
│   │   ├── datagrid-group.js
│   │   ├── form.js             # 🆕 Auto-form từ entity schema
│   │   ├── form-field-types.js # 🆕 text/number/date/select/lookup/file
│   │   ├── kanban.js           # 🆕 Card columns by status
│   │   ├── gantt.js            # 🆕 Timeline với dependency
│   │   ├── tree.js             # 🆕 Hierarchical list
│   │   └── chart.js            # COPY widgets-charts.js
│   ├── entity/                 # 🆕 Data model layer
│   │   ├── registry.js         # Lưu list entity + load/save
│   │   ├── schema.js           # Field types, validation
│   │   ├── designer.js         # UI để define entity
│   │   └── mcp-binding.js      # Map entity ↔ MCP tools (CRUD)
│   ├── workflow/               # 🆕 BPM-lite
│   │   ├── designer.js         # Canvas drag-drop nodes
│   │   ├── node-types.js       # trigger/action/condition/agent/approval
│   │   ├── runner.js           # Execute workflow step-by-step
│   │   └── instance-store.js   # Persist instance state
│   ├── agent/                  # 🆕 LLM integration
│   │   ├── host.js             # Proxy gọi Claude API
│   │   ├── prompt-templates.js # Templates kèm context entity
│   │   ├── action-bridge.js    # Cho phép agent gọi MCP tool
│   │   └── ui.js               # Chat panel + suggestion cards
│   ├── pages/                  # 🆕 Page composer
│   │   ├── layout-engine.js    # Grid layout, save JSON
│   │   ├── registry.js         # List pages, navigation
│   │   ├── designer.js         # Drag-drop UI components
│   │   └── renderer.js         # Runtime renderer
│   └── app.js                  # Init, route, wire
├── components/                 # HTML templates
│   ├── topbar.html
│   ├── sidebar-nav.html
│   ├── panel-designer.html
│   ├── panel-canvas.html
│   ├── panel-inspector.html
│   ├── modal-entity-edit.html
│   ├── modal-page-edit.html
│   ├── modal-workflow-edit.html
│   └── modal-agent-chat.html
├── workflows/                  # User-saved workflow JSON
├── entities/                   # User-saved entity schemas JSON
└── templates/                  # Sample pages/workflows
    ├── crm-basic/
    ├── inventory/
    └── hr-leave/
```

## 4. Reuse từ gesture-mcp-dashboard

| Module | Tận dụng | Sửa gì |
|--------|---------|--------|
| `utils.js`, `db.js`, `state.js` | 100% | Không |
| `mcp.js` | 100% | Có thể thêm batch call |
| `modal.js` | 100% | Không |
| `themes.js`, `i18n.js` | 100% | Thêm key mới |
| `datagrid*.js` (3 files) | 100% | Đã sẵn group/sort/agg |
| `widgets-charts.js` | 100% | Rename → `ui/chart.js` |
| `widget-fields.js` | Partial | Tách phần "field wells" để dùng cho form designer |
| Bootstrap loader (index.html) | 100% | Copy pattern |

## 5. Phases — đề xuất 8 sprint

### Sprint 1 — Foundation (1-2 ngày)
- [ ] Copy core/* + ui/* từ dashboard
- [ ] index.html skeleton + bootstrap loader
- [ ] Topbar + sidebar navigation
- [ ] Theme switcher, i18n
- [ ] MCP config modal (reuse)

### Sprint 2 — Entity Designer (3-4 ngày)
- [ ] Entity model: { name, label, fields: [{key, type, ref, required, default}], primaryKey, mcpBindings: {list, get, create, update, delete} }
- [ ] UI thiết kế entity: thêm/sửa/xóa field, đặt type
- [ ] Lưu entity vào IndexedDB
- [ ] **Field types**: text, number, date, datetime, boolean, select(options), multi-select, lookup(entity), file, json, formula
- [ ] Import schema từ MCP tool inputSchema (auto-detect)

### Sprint 3 — Form & List Auto (3-4 ngày)
- [ ] `form.js`: render auto-form từ entity schema
- [ ] Field components per type (input, textarea, select, lookup picker, date picker, file upload)
- [ ] Validation client-side
- [ ] List view dùng DataGrid với column tự tạo từ schema
- [ ] CRUD wire vào MCP (entity.mcpBindings)

### Sprint 4 — Page Designer (4-5 ngày)
- [ ] Page model: { id, name, layout: [{component, x, y, w, h, config}] }
- [ ] Available components: List, Form, Card, Chart, KPI, Kanban, Custom HTML, Iframe
- [ ] Drag-drop canvas (giống Power BI / Retool)
- [ ] Inspector panel: chỉnh config component (binding entity, filter, ...)
- [ ] Preview mode vs Edit mode
- [ ] Navigation menu builder

### Sprint 5 — Workflow Designer (5-6 ngày)
- [ ] Workflow model: { id, name, trigger, nodes: [{id, type, config, next: []}] }
- [ ] **Node types**:
  - `trigger`: manual / scheduled / data-change / webhook
  - `action`: call MCP tool / send email / create record / update record
  - `condition`: branching (if/else, switch)
  - `loop`: for each row
  - `agent`: gọi LLM với prompt + context
  - `approval`: chờ user confirm (push notification)
  - `delay`: wait N seconds / until date
  - `subflow`: gọi workflow khác
- [ ] Canvas drag-drop với connectors (SVG lines)
- [ ] Variable binding: `{{step1.result.foo}}`
- [ ] Test run với dry-run mode

### Sprint 6 — Agent Integration (4-5 ngày)
- [ ] Agent host: proxy gọi Claude API (cần backend nhẹ hoặc browser → Claude API trực tiếp với CORS-friendly key)
- [ ] Prompt templates với placeholder `{{entity}}`, `{{record}}`, `{{step.X}}`
- [ ] Structured output (JSON schema response)
- [ ] Action bridge: cho phép agent gọi MCP tool trực tiếp (như "tool_use" trong Claude API)
- [ ] Agent chat panel: user trò chuyện, agent đề xuất hành động
- [ ] Suggestion cards: "Bạn muốn tạo đơn hàng cho khách X với SP Y?" → 1-click apply

### Sprint 7 — Permission & Audit (3-4 ngày)
- [ ] Role model: { name, permissions: [{entity, action: read|create|update|delete}] }
- [ ] User-role assignment
- [ ] Per-page visibility
- [ ] Audit log: lưu mọi change (who, when, before, after) qua MCP tool
- [ ] Activity feed widget

### Sprint 8 — Reports & Notifications (3-4 ngày)
- [ ] Report builder: extend Dashboard concept, export PDF/Excel
- [ ] Scheduled reports (giống scheduled-tasks): gửi PDF qua email mỗi sáng
- [ ] In-app notifications: toast + bell icon
- [ ] Email integration (qua MCP tool nếu server có)

## 6. Tech decisions cần chốt

1. **Agent runtime**: 
   - Option A: Browser → Claude API trực tiếp (user nhập API key)
   - Option B: Backend proxy (Node/Python) — bảo mật key tốt hơn
   - **Khuyên Option A** giai đoạn đầu (giống dashboard hiện tại, ko cần server)

2. **Workflow storage**:
   - Option A: Local IndexedDB only — đơn giản, không sync
   - Option B: Save qua MCP tool (server-side) — đa người dùng
   - **Khuyên Option B** vì ERP cần multi-user

3. **Workflow runner**:
   - Option A: Client-side (browser chạy workflow)
   - Option B: Server-side qua MCP (gửi `run_workflow(id)` rồi poll status)
   - **Khuyên Option B** để workflow chạy được khi user offline

4. **Drag-drop canvas**:
   - Option A: Tự viết với HTML5 Drag and Drop (như đã làm cho group bar trong DataGrid)
   - Option B: Dùng thư viện như `interact.js` hoặc `gridstack.js`
   - **Khuyên Option B** cho page designer (gridstack tốt nhất), tự viết cho workflow designer (SVG lines)

5. **Form schema source**:
   - Option A: User define manual trong Entity Designer
   - Option B: Auto-detect từ MCP tool inputSchema
   - **Khuyên cả hai**: detect tự động, cho phép override

## 7. Tiêu chuẩn module (áp dụng feedback "split files when adding features")

- Mỗi file < 15KB
- Pure helpers tách thành submodule riêng (xem mẫu `datagrid-agg`, `datagrid-group`)
- Stateful logic giữ file core
- UI handlers (modal, drag-drop) tách thành -ui suffix
- Mọi module dùng IIFE pattern + expose qua `App.XxxNamespace`

## 8. Milestone ngắn hạn

**Tuần 1**: Hoàn thành Sprint 1 + 2. Có entity designer + lưu vào IndexedDB.

**Tuần 2**: Sprint 3 + 4. Có form + list auto, page designer cơ bản.

**Tuần 3**: Sprint 5. Workflow designer skeleton, chạy được linear flow.

**Tuần 4**: Sprint 6. Tích hợp agent, demo case "tạo đơn hàng qua chat".

**Tuần 5+**: Sprint 7, 8 + polish + sample templates.

## 9. Sample use case end-to-end

> **"Bán hàng nội bộ"**
> 1. Entity `Khách hàng` với fields: tên, mã KH, sđt, địa chỉ (lookup `Tỉnh`)
> 2. Entity `Đơn hàng` với fields: mã ĐH, khách hàng (lookup `Khách hàng`), ngày, items[{sp, qty, giá}], tổng tiền (formula)
> 3. Page `Đơn hàng` có: List đơn hàng (DataGrid), Form đơn hàng, Chart doanh số theo tháng
> 4. Workflow `Tạo đơn hàng`:
>    - Trigger: button "Tạo nhanh" trên list
>    - Agent node: chat với user "Bạn muốn tạo đơn cho ai? Sản phẩm gì?"
>    - Agent return structured `{customer_id, items: [...]}`
>    - Action: gọi MCP `create_order`
>    - Notification: "Đã tạo đơn ĐH-123 cho KH ABC"
>
> User chỉ cần config trong Designer, không viết code.

---
**Status**: Draft v1 · Cập nhật 2026-05-19

---

## 10. Multi-LLM Adapter Architecture

> Mỗi **Agent** có thể dùng 1 LLM khác nhau. Mỗi **Tool** trong agent
> cũng có thể có LLM riêng (sub-agent pattern). Tách qua adapter để dễ
> thay model mà không sửa code logic.

### 10.1 Adapter interface

```js
// js/agent/llm-adapter.js
interface LLMAdapter {
  id: string;                          // "claude", "openai", "gemini", "ollama", ...
  capabilities: {
    tools: boolean,                    // hỗ trợ tool_use không
    vision: boolean,                   // hỗ trợ image input không
    json_mode: boolean,                // structured output
    streaming: boolean,
    max_input_tokens: number,
    max_output_tokens: number,
  };
  send(req: LLMRequest): Promise<LLMResponse>;
  stream(req: LLMRequest): AsyncIterable<LLMDelta>;  // optional
}

type LLMRequest = {
  model: string;                       // "claude-opus-4-6", "gpt-4o", ...
  system?: string;                     // system prompt
  messages: [{role: "user"|"assistant", content: string|Block[]}];
  tools?: ToolDef[];                   // function-calling tools
  temperature?: number;
  max_tokens?: number;
  response_format?: "text"|"json"|JsonSchema;
  apiKey?: string;                     // override mỗi request nếu cần
};

type LLMResponse = {
  text: string;
  tool_calls?: [{name, args}];         // chuẩn hóa across providers
  usage: { input_tokens, output_tokens };
  raw: any;                            // response gốc để debug
};
```

### 10.2 Built-in adapters

| Adapter | File | Endpoint | Models hỗ trợ |
|---------|------|----------|---------------|
| Claude (Anthropic) | `llm-claude.js` | `api.anthropic.com/v1/messages` | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 |
| OpenAI | `llm-openai.js` | `api.openai.com/v1/chat/completions` | gpt-4o, gpt-4-turbo, gpt-3.5-turbo |
| Gemini | `llm-gemini.js` | `generativelanguage.googleapis.com` | gemini-2.0-flash, gemini-1.5-pro |
| Ollama (local) | `llm-ollama.js` | `localhost:11434/api/chat` | llama3, mistral, qwen, ... |
| Custom REST | `llm-custom.js` | User config URL + payload template | bất kỳ OpenAI-compatible endpoint |
| Mock (testing) | `llm-mock.js` | n/a | trả response cố định |

Tất cả implement chuẩn `LLMAdapter`. **Tool calling chuẩn hoá** về format Anthropic (vì cleaner) rồi convert sang format đích trong adapter.

### 10.3 Registry & config storage

```js
// js/agent/llm-registry.js
App.LLM = {
  register(adapter),               // đăng ký adapter
  get(id),                         // lấy adapter theo id
  list(),                          // list adapters đã đăng ký
  setProfile(name, config),        // lưu profile { id, model, apiKey, ... }
  getProfile(name),
  listProfiles(),
};

// Lưu profile vào IndexedDB
// {
//   "default": { adapter: "claude", model: "claude-sonnet-4-6", apiKey: "sk-..." },
//   "cheap":   { adapter: "claude", model: "claude-haiku-4-5",  apiKey: "sk-..." },
//   "local":   { adapter: "ollama", model: "llama3:70b" },
//   "vision":  { adapter: "openai", model: "gpt-4o", apiKey: "sk-..." }
// }
```

### 10.4 Agent model với LLM riêng

```js
// Agent định nghĩa
{
  id: "order-creator",
  name: "Trợ lý tạo đơn",
  llm_profile: "default",            // tên profile trong registry
  system_prompt: "Bạn là trợ lý...",
  tools: [
    {
      name: "find_customer",
      description: "Tìm khách hàng theo tên",
      schema: { name: "string" },
      llm_profile: "cheap",           // ← tool này dùng LLM rẻ hơn
      handler: { type: "mcp", tool: "search_customer" }
    },
    {
      name: "extract_items",
      description: "Trích item từ mô tả tự nhiên",
      schema: { description: "string" },
      llm_profile: "default",         // ← tool này tự gọi LLM
      handler: { type: "llm", prompt_template: "Trích items từ: {{description}} ..." }
    },
    {
      name: "create_order",
      schema: { customer_id, items },
      handler: { type: "mcp", tool: "create_order" }
    }
  ]
}
```

### 10.5 Tool execution flow

```
User → Agent (LLM: "default")
       │
       ├─ Gọi tool "find_customer"
       │  → Adapter: dùng LLM "cheap" để format query
       │  → Bridge: gọi MCP `search_customer`
       │  → Return: { id, name }
       │
       ├─ Gọi tool "extract_items"
       │  → Tool có handler = "llm" → tự gọi adapter "default"
       │  → Return: [{ sku, qty }]
       │
       └─ Gọi tool "create_order"
          → MCP `create_order` → Done
```

### 10.6 Lợi ích thiết kế này

1. **Cost optimization**: routing model rẻ → specialist model đắt
2. **Privacy tier**: dữ liệu nhạy cảm → local model (Ollama), task chung → cloud
3. **Capability matching**: vision task → GPT-4o / Claude Opus, text → Haiku
4. **Vendor lock-in tránh được**: đổi provider chỉ là đổi config, không sửa code
5. **A/B testing**: chạy cùng prompt trên 2 LLM khác nhau, so kết quả
6. **Failover**: nếu Claude down → fallback OpenAI tự động

### 10.7 Folder structure cho agent layer (cập nhật)

```
js/agent/
├── llm-adapter.js          # Interface + base class
├── llm-claude.js           # ~3KB
├── llm-openai.js           # ~3KB
├── llm-gemini.js           # ~3KB
├── llm-ollama.js           # ~2KB
├── llm-custom.js           # ~3KB (template-based)
├── llm-mock.js             # ~1KB
├── llm-registry.js         # ~3KB
├── agent.js                # Agent class — run, tool dispatch
├── tool.js                 # Tool wrapper
├── prompt-templates.js     # Library prompt
├── action-bridge.js        # Bridge MCP ↔ Agent tool
└── ui.js                   # Chat panel
```

Tổng cộng ~25KB chia thành 13 file < 4KB mỗi file — siêu an toàn.

### 10.8 Profile UI (Sprint 6 bổ sung)

Trong Settings:
```
┌─ LLM Profiles ────────────────────────┐
│ ┌─────────────────────────────────┐  │
│ │ default                          │  │
│ │ Adapter: Claude ▼                │  │
│ │ Model:   claude-sonnet-4-6 ▼     │  │
│ │ API Key: ************            │  │
│ │ Temperature: 0.7 ─────●───  1.0  │  │
│ │ Max tokens: 4096                 │  │
│ │ [Test ⚡]  [Xóa]                 │  │
│ └─────────────────────────────────┘  │
│ [+ Profile mới]                       │
└──────────────────────────────────────┘
```

Mỗi agent / tool chọn profile từ dropdown thay vì hardcode model name. Đổi
profile → tất cả agent dùng profile đó update theo.

---

## 11. Phân tích: Pure JS vs Framework

### 11.1 Pure JS hiện tại (như `gesture-mcp-dashboard`)

**Ưu**:
- ✅ **Zero build step**: mở `index.html` là chạy, không cần npm/webpack/vite
- ✅ **Deploy đơn giản**: copy folder lên Coolify/nginx, xong
- ✅ **Debug trong suốt**: source code = runtime code, không có sourcemap mismatch
- ✅ **Bundle nhỏ**: không có runtime framework (~30KB React, ~10KB Vue, ~30KB Angular)
- ✅ **Không vendor lock-in**: đổi framework không cần
- ✅ **CDN-friendly**: Chart.js, MediaPipe, ... import trực tiếp qua `<script>`
- ✅ **Hiểu sâu**: học DOM, event, layout — kỹ năng nền

**Nhược**:
- ❌ **State management thủ công**: phải tự `App.state.x = y; render()` mọi nơi
- ❌ **Re-render toàn bộ**: như case `widgets render()` ta vừa fix, dễ destroy DOM state (DataGrid mất sort)
- ❌ **Không type safety**: bug dễ lọt (typo, sai shape, ...)
- ❌ **Component model lỏng lẻo**: IIFE + App namespace ổn cho MVP nhưng scale lớn khó
- ❌ **Không HMR**: phải F5 mỗi lần sửa
- ❌ **Khó test**: không có testing framework chuẩn
- ❌ **Drag-drop, undo/redo, dirty-tracking**: phải tự viết hết

### 11.2 Các framework để cân nhắc

#### React (18+) — phổ biến nhất

**Ưu**:
- Ecosystem cực lớn: ReactFlow (workflow canvas), react-grid-layout (page designer), react-hook-form, TanStack Table (DataGrid hardcore), Mantine/Chakra (UI lib)
- DevTools đỉnh, time-travel debugging
- Hiring/onboarding dễ
- Server Components (Next.js) — cho ERP backend-heavy
- Concurrent rendering — UI mượt với data lớn

**Nhược**:
- Bundle ~45KB gzip (React + ReactDOM)
- Bắt buộc build step (Vite/Next.js)
- Re-render cascade nếu không tối ưu (memo, useMemo)
- JSX khá khác HTML — vài người ngại

**Phù hợp ERP**: ★★★★★ — best fit cho designer-heavy app

#### Vue 3 (Composition API)

**Ưu**:
- Template HTML quen thuộc (gần với code hiện tại)
- Reactive system tự động, ít boilerplate hơn React
- Single-file component .vue rất gọn
- Pinia state mgmt đơn giản
- Bundle ~22KB gzip

**Nhược**:
- Ecosystem nhỏ hơn React (nhưng đủ dùng)
- Workflow canvas: phải dùng VueFlow (port từ ReactFlow, mature)
- DataGrid: AG Grid (commercial) hoặc Vue Good Table (đủ dùng)

**Phù hợp ERP**: ★★★★☆ — trung hòa, học dễ

#### Svelte 5 (Runes)

**Ưu**:
- **Compile-to-vanilla**: output gần như pure JS, ~5KB runtime
- Reactive syntax cực ngắn (`let count = 0; count++`)
- Template HTML đẹp
- Performance top-tier
- File `.svelte` đơn giản (style + script + markup)

**Nhược**:
- Ecosystem nhỏ — nhiều component phải tự viết
- ReactFlow tương đương: Svelte Flow (stable, free)
- Tooling còn non hơn React
- Hiring khó hơn

**Phù hợp ERP**: ★★★★☆ — tốt nếu giá trị performance và size

#### Solid.js

**Ưu**:
- Reactivity fine-grained như Svelte nhưng dùng JSX như React
- Performance: thường nhanh nhất benchmarks
- Bundle ~6KB
- API gần React → migrate React code dễ

**Nhược**:
- Ecosystem rất nhỏ
- Cộng đồng nhỏ, ít resource học
- Workflow canvas: không có lib mature

**Phù hợp ERP**: ★★★☆☆ — risk cao

#### Alpine.js + HTMX (lightweight)

**Ưu**:
- "Sprinkle JS into HTML" — gắn `x-data`, `x-on:click` vào element có sẵn
- ~10KB tổng, không build
- HTMX cho server-driven UI (đẩy HTML từ server thay vì JSON)
- Phù hợp khi server (MCP) làm hầu hết logic

**Nhược**:
- Phức tạp lớn (designer, workflow canvas) không phù hợp
- State management trong 1 component thôi, share state khó
- Cảm giác "không có cấu trúc" với app lớn

**Phù hợp ERP**: ★★☆☆☆ — ok cho dashboard read-only, không ok cho designer

#### Lit (Web Components)

**Ưu**:
- Chuẩn web — không lệ thuộc framework
- Browser-native shadow DOM (style isolation)
- Bundle ~5KB
- Interop được với mọi framework

**Nhược**:
- Ecosystem nhỏ
- Template literal thay JSX/template — quen khó hơn
- Drag-drop / canvas libs ít

**Phù hợp ERP**: ★★★☆☆ — interesting nhưng risk

### 11.3 So sánh ma trận cho ERP Framework

| Tiêu chí | Pure JS | React | Vue | Svelte | Alpine |
|----------|---------|-------|-----|--------|--------|
| Drag-drop designer (page) | 🔴 tự viết | 🟢 dnd-kit/react-grid-layout | 🟢 vue-grid-layout | 🟡 svelte-dnd-action | 🔴 |
| Workflow canvas (SVG nodes) | 🔴 tự viết | 🟢 ReactFlow | 🟢 VueFlow | 🟢 Svelte Flow | 🔴 |
| DataGrid (đã có sẵn) | 🟢 đã có | 🟢 TanStack/AG | 🟢 AG Grid | 🟡 hạn chế | 🔴 |
| Auto-form từ schema | 🟡 self | 🟢 react-jsonschema-form | 🟢 vue-form-generator | 🟡 self | 🔴 |
| State mgmt (undo/redo) | 🔴 thủ công | 🟢 Zustand/Redux | 🟢 Pinia | 🟢 Stores | 🟡 |
| Bundle size | 🟢 0KB | 🔴 45KB | 🟡 22KB | 🟢 5KB | 🟢 10KB |
| Build complexity | 🟢 không | 🔴 npm/vite | 🔴 npm/vite | 🔴 svelte-kit | 🟢 không |
| Deploy | 🟢 static | 🟡 build | 🟡 build | 🟡 build | 🟢 static |
| Time-to-MVP | 🟡 chậm | 🟢 nhanh | 🟢 nhanh | 🟢 nhanh | 🟡 |
| Type safety (TS) | 🔴 không | 🟢 có | 🟢 có | 🟢 có | 🔴 |
| Test framework | 🔴 thiếu | 🟢 vitest/jest | 🟢 vitest | 🟢 vitest | 🔴 |
| Hiring/cộng tác | 🟡 | 🟢 | 🟢 | 🟡 | 🔴 |

### 11.4 Khuyến nghị

**Cho `erp-framework` (designer-heavy, drag-drop, canvas, multi-page)**:

🥇 **Lựa chọn 1: React + Vite + TanStack Query**
- Lý do: ecosystem có sẵn TẤT CẢ libs cần thiết (ReactFlow cho workflow, dnd-kit cho page, TanStack Table cho grid, react-hook-form cho auto-form)
- Tiết kiệm 6-12 tháng dev so với tự viết pure JS
- Setup: `npm create vite@latest erp-framework -- --template react-ts`
- Deploy: `npm run build` → static folder → vẫn copy lên Coolify

🥈 **Lựa chọn 2: Vue 3 + Vite + Pinia**
- Lý do: HTML template gần với code hiện tại (data-i18n, slot pattern), dễ migrate từng phần
- Nhỏ hơn React, learn curve dễ hơn
- VueFlow + Vue Grid Layout cũng tốt

🥉 **Lựa chọn 3: Svelte 5 + SvelteKit**
- Lý do: nếu Tony ưu tiên performance + small bundle
- Code ngắn nhất, performance top
- Risk: ecosystem nhỏ hơn

❌ **Không khuyên**: Pure JS — designer + workflow + canvas + 4 LLM adapter + multi-page sẽ thành 200KB+ code khó duy trì. Đã thấy với `widgets.js` 30KB cần tách 4 lần.

❌ **Không khuyên**: Alpine.js — quá nhẹ cho ERP designer.

### 11.5 Chiến lược chuyển dần (nếu chọn framework)

Không cần rewrite mọi thứ. Đề xuất:

**Phase A**: Giữ pure JS cho **core layer** (utils, db, state, mcp, llm-adapter) — đã ổn định, nhỏ, không thay đổi nhiều. Dùng làm "library" độc lập.

**Phase B**: Viết **designer apps** bằng framework chọn:
- Entity Designer trong React/Vue/Svelte
- Page Designer
- Workflow Designer

Designer apps import core JS modules qua `<script>` tag hoặc dynamic import. Lợi: core code (đã chạy ổn) tái sử dụng nguyên xi.

**Phase C**: Viết **runtime renderer** (chạy app cuối, không phải designer) cũng bằng framework để có reactive UI.

### 11.6 Quyết định cần Tony chốt

1. Pure JS tiếp / chuyển framework / hybrid?
2. Nếu framework: React / Vue / Svelte?
3. Build tool: Vite (khuyên) / Webpack / esbuild?
4. TypeScript hay JavaScript thuần?
5. Component library UI: tự viết / Mantine / Tailwind+Headless UI / shadcn?

Mình đợi Tony cho hướng để **tạo skeleton Phase B** (designer app đầu tiên — Entity Designer chẳng hạn) với framework chốt.

---

## 12. ✅ Stack chốt — 2026 Modern Optimal

### 12.1 Tech stack

```
┌────────────────────────────────────────────────────────────┐
│  React 19 + TypeScript 5 + Vite 5                          │
│  ├─ TanStack Router (file-based, type-safe)                │
│  ├─ TanStack Query (data cache, optimistic updates)        │
│  ├─ TanStack Table (DataGrid headless — extend của ta)     │
│  ├─ Zustand (state mgmt — không boilerplate)               │
│  ├─ react-hook-form + Zod (auto-form + validation)         │
│  ├─ @xyflow/react (ReactFlow v12 — workflow canvas)        │
│  ├─ @dnd-kit/core (page designer drag-drop)                │
│  └─ Tailwind CSS + shadcn/ui (UI primitives, owned code)   │
│                                                             │
│  Tooling: Biome (lint+format), Vitest (test), pnpm         │
│  Deploy: dist/ static → Coolify nginx (như hiện tại)       │
└────────────────────────────────────────────────────────────┘
```

### 12.2 Tại sao stack này

| Lựa chọn | Lý do |
|---|---|
| **React 19** | Most mature ecosystem, Actions/useOptimistic giảm boilerplate, Server Components option |
| **TypeScript** | Type-safe entity schema, prevent bug typo trên 200+ fields |
| **Vite** | HMR siêu nhanh, build với SWC < 5s |
| **TanStack Router** | File-based + 100% type-safe params (vô địch React Router) |
| **TanStack Query** | Cache MCP responses tự động, retry, optimistic, stale-while-revalidate |
| **Zustand** | 1KB, không Provider, dùng được ngoài component (cho workflow runner) |
| **react-hook-form** | Performant, uncontrolled, integrate Zod schema từ entity |
| **Zod** | Runtime validation + TypeScript inference cùng 1 schema |
| **@xyflow/react** | Battle-tested ReactFlow, dùng cho Make.com/n8n/Zapier |
| **@dnd-kit** | Modern drag-drop, accessibility, touch support |
| **shadcn/ui + Tailwind** | Copy code vào repo (own components), không lock vào package version |
| **Biome** | Rust-based — nhanh hơn ESLint+Prettier 35x |

### 12.3 Folder structure mới

```
erp-framework/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── biome.json
├── index.html                  # Vite entry
├── public/                     # Static assets (favicon, ...)
├── src/
│   ├── main.tsx                # React root
│   ├── App.tsx                 # Layout shell + router
│   ├── routes/                 # File-based routes (TanStack Router)
│   │   ├── __root.tsx          # Layout chung
│   │   ├── index.tsx           # Home / dashboard
│   │   ├── entities/
│   │   │   ├── index.tsx       # List entities
│   │   │   └── $id.tsx         # Entity designer
│   │   ├── pages/
│   │   │   ├── index.tsx
│   │   │   └── $id.tsx         # Page designer
│   │   ├── workflows/
│   │   │   └── $id.tsx
│   │   └── settings/
│   │       ├── llm.tsx         # LLM profiles
│   │       └── mcp.tsx         # MCP config
│   ├── components/
│   │   ├── ui/                 # shadcn/ui copied
│   │   ├── designer/
│   │   │   ├── EntityDesigner.tsx
│   │   │   ├── PageDesigner.tsx
│   │   │   ├── WorkflowDesigner.tsx
│   │   │   └── nodes/          # Workflow node types
│   │   ├── renderer/           # Runtime widget renderers
│   │   │   ├── DataGrid.tsx
│   │   │   ├── AutoForm.tsx
│   │   │   ├── Kanban.tsx
│   │   │   └── Chart.tsx
│   │   └── agent/
│   │       ├── ChatPanel.tsx
│   │       └── SuggestionCard.tsx
│   ├── core/                   # Pure TS modules — port từ dashboard
│   │   ├── mcp.ts              # MCP client
│   │   ├── db.ts               # IndexedDB wrapper
│   │   ├── llm/                # LLM adapters đã thiết kế
│   │   │   ├── adapter.ts
│   │   │   ├── claude.ts
│   │   │   ├── openai.ts
│   │   │   ├── gemini.ts
│   │   │   ├── ollama.ts
│   │   │   └── registry.ts
│   │   └── workflow/
│   │       └── runner.ts
│   ├── stores/                 # Zustand stores
│   │   ├── entities.ts
│   │   ├── pages.ts
│   │   ├── workflows.ts
│   │   └── settings.ts
│   ├── hooks/                  # React custom hooks
│   │   ├── useMcp.ts
│   │   ├── useEntity.ts
│   │   └── useAgent.ts
│   ├── types/                  # Shared TS types
│   │   ├── entity.ts
│   │   ├── workflow.ts
│   │   └── llm.ts
│   └── lib/                    # Helpers nhỏ
│       ├── utils.ts            # cn() + formatters
│       └── zod-schemas.ts
├── workflows/                  # User-saved workflows (sync sau với MCP)
├── entities/                   # User-saved entities
└── templates/                  # Sample apps
```

### 12.4 Deploy strategy

- Dev: `pnpm dev` (Vite, port 5173, HMR)
- Build: `pnpm build` → `dist/` (~150KB gzip)
- Deploy: copy `dist/*` vào nginx như `gesture-mcp-dashboard/` — **không cần** Node runtime
- Coolify config: build command `pnpm install && pnpm build`, output `dist/`

### 12.5 Migration path từ pure JS

Pure JS code hiện tại không bỏ — port sang TypeScript trong `src/core/`:
- `mcp.js` → `core/mcp.ts` (add types)
- `db.js` → `core/db.ts` (add IDBDatabase types)
- `llm-adapter.js` → `core/llm/adapter.ts` (add interface)

Logic identical, chỉ add types. 1-2 ngày là xong.
