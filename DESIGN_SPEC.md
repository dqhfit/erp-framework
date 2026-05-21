# ERP Framework — Design Spec

> Dùng làm prompt / brief cho designer hoặc Claude Design.
> Mục tiêu: làm rõ **what to design**, **for whom**, **how it feels**,
> **what reference**, **what NOT to design**.

---

## 1. Product summary (1 đoạn)

**ERP Framework** là một ứng dụng web low-code/no-code cho doanh nghiệp
nhỏ và vừa. Người dùng (admin, không cần biết code) tự thiết kế **Entity**
(model dữ liệu), **Page** (giao diện CRUD/dashboard), **Workflow** (quy
trình tự động) và **Agent** (trợ lý AI). Data source là **MCP server**
(backend doanh nghiệp đã có). Người dùng cuối (nhân viên) dùng các page +
workflow + agent này trên cùng app để làm việc hàng ngày.

Giống lai giữa: **Retool** (drag-drop UI) + **n8n / Make.com** (workflow)
+ **Notion** (đơn giản) + **Power BI** (dashboard) + **Claude.ai**
(agent chat).

---

## 2. Target users

| Persona | Vai trò | Mục tiêu |
|---|---|---|
| **Anh Quản trị** | IT/business analyst của công ty | Thiết kế hệ thống quy trình, không muốn code. Cần designer mode mạnh. |
| **Chị Nhân viên** | Sales, kế toán, kho | Dùng các page do anh A tạo ra. Cần consumer mode nhanh, tinh gọn. |
| **Sếp** | Giám đốc | Xem dashboard, approve workflow. Cần mobile-friendly. |

**Hai chế độ chính**:
- **Designer Mode** (anh A): toolbar trên cùng, sidebar phải có inspector, canvas chiếm phần lớn.
- **Consumer Mode** (chị B, sếp): chỉ thấy menu trái + nội dung page, không thấy inspector.

Toggle qua nút "Edit / Preview" trên topbar.

---

## 3. Design principles

1. **Tinh gọn như Notion**: không trang trí thừa, không gradient mè nheo trừ accent. White space rộng.
2. **Powerful như Retool**: hiển thị nhiều thông tin trên 1 màn hình khi cần (sidebar, inspector, canvas).
3. **Friendly như Claude.ai**: agent chat panel quen mắt, message bubble đơn giản.
4. **Consistent**: 1 component có 1 style, không 5 variant.
5. **Vietnamese-first**: nhãn tiếng Việt, font support diacritics tốt (system font ổn).
6. **Dark mode default**, light mode optional.

---

## 4. Visual style

### 4.1 Color palette (dark, default)

| Token | HSL | Hex | Dùng cho |
|---|---|---|---|
| `--bg` | 230 35% 9% | #0b1020 | Background ngoài cùng |
| `--bg-soft` | 232 50% 12% | #0f1530 | Input background, sub-area |
| `--panel` | 230 40% 14% | #141a30 | Panel chính (card, sidebar) |
| `--panel-2` | 232 45% 19% | #1a2140 | Panel cấp 2 (nested) |
| `--hover` | 230 45% 27% | #263363 | Hover state |
| `--border` | 230 40% 24% | #263055 | Viền |
| `--text` | 230 100% 95% | #e6ebff | Text chính |
| `--muted` | 230 25% 65% | #8e98c2 | Text phụ |
| `--accent` | 256 100% 68% | #7c5cff | Primary action, focus |
| `--accent-2` | 190 100% 50% | #00d4ff | Link, info, accent phụ |
| `--success` | 142 71% 45% | #2ecc71 | OK / saved |
| `--warning` | 38 100% 60% | #ffd166 | Warning |
| `--danger` | 348 100% 60% | #ff5577 | Delete / error |

Light mode: invert background (white) + dark text, giữ nguyên accent.

### 4.2 Typography

- **Font**: system UI (`-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`). Không web font nặng.
- **Mono**: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` cho code/keys.
- **Size scale**:
  - `text-xs`: 11px (hint, badge, foot)
  - `text-sm`: 13px (default body)
  - `text-base`: 14px (form input)
  - `text-lg`: 16px (heading nhỏ)
  - `text-xl`: 18px (section heading)
  - `text-2xl`: 22px (page title)
- **Weight**: 400 thường, 600 bold cho heading/label

### 4.3 Spacing (Tailwind scale)

- Padding component: `p-3` (12px) hoặc `p-4` (16px)
- Gap giữa fields: `gap-3` (12px)
- Section spacing: `space-y-4` (16px)
- Border radius: `rounded-md` (6px) cho input/button, `rounded-lg` (8px) cho card

### 4.4 Elevation

- Panel: chỉ border, không shadow.
- Modal: `shadow-2xl` + `border`.
- Dropdown: `shadow-lg` + `border`.
- Hover button: `hover:bg-[hsl(var(--hover))]` không bóng.

### 4.5 Icons

- Library: **Lucide React** (đã có trong deps).
- Size: 14px (sm), 16px (md), 18px (lg).
- Không emoji trong UI chính (chỉ trong toast/empty-state vui).

---

## 5. Layout patterns

### 5.1 App shell

```
┌──────────────────────────────────────────────────────┐
│  Topbar (h=48px)                                      │
│  Logo · Nav · Theme · MCP status · LLM profile · User │
├────────┬─────────────────────────────────┬───────────┤
│ Side-  │  Main canvas / content          │ Inspector │
│ menu   │  (route-driven)                 │ (Designer │
│ (240px)│                                 │  mode     │
│        │                                 │  only,    │
│        │                                 │  320px)   │
└────────┴─────────────────────────────────┴───────────┘
```

- Sidebar: list of Entities, Pages, Workflows, Settings. Có thể collapse → icon-only 56px.
- Inspector: hiện trong Designer Mode, ẩn trong Consumer.
- Mobile (< 768px): sidebar trượt overlay, inspector trượt từ phải.

### 5.2 Designer Mode (Entity / Page / Workflow Designer)

```
┌──────────────────────────────────────────────────────┐
│ Topbar                                                │
├────────┬─────────────────────────────┬───────────────┤
│ Side-  │ Toolbar (Save · Undo · Run · Preview · …)   │
│ menu   ├─────────────────────────────┬───────────────┤
│        │ Canvas (drag-drop area)     │ Inspector     │
│        │                             │ - Property    │
│        │                             │   editor cho  │
│        │                             │   item đang   │
│        │                             │   chọn        │
│        │                             │ - Tabs:       │
│        │                             │   Data/Style/ │
│        │                             │   Events      │
└────────┴─────────────────────────────┴───────────────┘
```

### 5.3 Consumer Mode (page rendering)

```
┌──────────────────────────────────────────────────────┐
│ Topbar (rút gọn: brand + user)                       │
├────────┬─────────────────────────────────────────────┤
│ Side-  │ Page content (rendered từ PageDef)          │
│ menu   │                                              │
│        │  ┌─List──┐ ┌─Form───────┐                   │
│        │  │       │ │            │                   │
│        │  │       │ │            │                   │
│        │  └───────┘ └────────────┘                   │
│        │  ┌─Chart────────┐ ┌─KPI─┐                   │
└────────┴─────────────────────────────────────────────┘
```

---

## 6. Component inventory

### 6.1 Atoms (đã có 5 trong `src/components/ui/`)

- [x] `Button` — variants: primary, default, ghost, danger; sizes: sm, md, lg
- [x] `Input` — text/number/email/password/search
- [x] `Select` — native select wrapped
- [x] `Label`
- [x] `Card`
- [ ] `Textarea`
- [ ] `Checkbox`
- [ ] `Radio`
- [ ] `Switch` (toggle)
- [ ] `Slider`
- [ ] `Badge` (chip)
- [ ] `Avatar`
- [ ] `Skeleton` (loading placeholder)
- [ ] `Spinner`
- [ ] `Separator`
- [ ] `Tooltip`
- [ ] `Toast` (notification)

### 6.2 Molecules

- [ ] `FormField` (Label + Input + error message)
- [ ] `SearchInput` (Input với icon search + clear button)
- [ ] `Dropdown` (button + menu)
- [ ] `DatePicker`, `TimePicker`, `DateRangePicker`
- [ ] `FileUploader` (drag-drop zone)
- [ ] `ColorPicker`
- [ ] `JsonEditor` (textarea với syntax highlight đơn giản)
- [ ] `FormulaEditor` (input với autocomplete biến)
- [ ] `LookupPicker` (search + select từ entity khác)
- [ ] `Chip` (closable tag) — đã có style cho group chip

### 6.3 Organisms

- [ ] `Topbar` — đã có skeleton
- [ ] `Sidebar` — list nav items collapsible
- [ ] `Inspector` — tabs + property forms
- [ ] `Modal` (đã có trong dashboard, port qua)
- [ ] `Drawer` (panel trượt từ phải)
- [ ] `Dialog` (alert / confirm)
- [ ] `CommandPalette` (Cmd+K)
- [ ] `BreadcrumbBar`
- [ ] `Tabs`
- [ ] `Accordion`

### 6.4 Domain components (specific cho ERP)

- [x] `EntityDesigner` — đã có
- [ ] `PageDesigner` — grid drag-drop với resize handles
- [ ] `WorkflowDesigner` — canvas với nodes + edges (ReactFlow)
- [ ] `AutoForm` — render form từ entity schema (react-hook-form + Zod)
- [ ] `DataGrid` — TanStack Table với sort/filter/group/agg (port từ dashboard)
- [ ] `Kanban` — columns by status field
- [ ] `Gantt` — timeline với deps
- [ ] `Tree` — hierarchical list
- [ ] `Chart` — bar/line/pie từ Chart.js (port)
- [ ] `AgentChatPanel` — messages + input + suggestion cards
- [ ] `WorkflowRunPanel` — log step-by-step
- [ ] `LLMProfilePicker` — dropdown chọn profile
- [ ] `EntityPicker` — dropdown chọn entity (cho lookup field)
- [ ] `FieldPicker` — dropdown chọn field của entity

---

## 7. Key screens (cần design Figma)

### 7.1 Home / Workspace
- Hero: "Chào X, bạn muốn làm gì hôm nay?"
- 3 quick-actions: + Entity / + Page / + Workflow
- Recent: list 5 item gần nhất user mở
- Stats: số entities, pages, workflows, agents

### 7.2 Entity Designer
- Header: tên entity + breadcrumb + "Save" + "Preview as Form"
- Trái: list 18 field types (drag từ đây vào canvas)
- Giữa: list fields hiện tại (sortable, click để select)
- Phải: inspector — property của field đang chọn (label, validation, options, ref...)
- Bottom: tab "MCP Bindings" để map 5 ops (list/get/create/update/delete)

### 7.3 Page Designer
- Canvas grid 12 cột, gridstack
- Trái: component palette (List, Form, Chart, KPI, Kanban, ...)
- Phải: inspector — config component đang chọn (binding entity, filter, columns, ...)
- Top toolbar: Undo/Redo, Save, Preview, Devices (desktop/tablet/mobile)

### 7.4 Workflow Designer
- Canvas SVG (ReactFlow)
- Trái: palette node types (Trigger, Action, Condition, Loop, Agent, Approval, Delay)
- Drag node vào canvas, connect bằng line
- Click node → inspector phải hiện properties:
  - Action: chọn MCP tool + map input
  - Condition: viết expression
  - Agent: chọn LLM profile + system prompt + tools
- Bottom: tab "Test Run" — chạy thử + xem log từng step

### 7.5 Agent Chat Panel
- Right drawer, 400px wide
- Header: tên agent + LLM profile badge
- Body: message bubbles (user phải, agent trái)
- Suggestion cards: agent đề xuất action ("Tạo đơn hàng?", "Mời thêm khách?")
- Footer: textarea + nút Send + mic icon
- Khi agent dùng tool: hiện "🔧 Đang gọi tool `search_customer`..."

### 7.6 Settings — LLM Profiles
- List profile (card view)
- Mỗi card: name, adapter badge, model, có/không có API key (icon ✓/✗)
- Click → modal edit
- Test button trong modal: gửi "Xin chào" thử

### 7.7 Settings — MCP
- Form: mode (demo/http), URL, headers
- Test button → hiện list tools nếu OK
- List tools đã connect (read-only)

### 7.8 Consumer page (rendered)
- Layout từ PageDef
- Filter bar phía trên (nếu page có filter)
- Page content render dynamic component
- Floating action button "Hỏi agent" góc phải dưới → mở chat panel

---

## 8. Interactions

### 8.1 Drag-drop

| Where | Drag from | Drop to | Effect |
|---|---|---|---|
| Entity Designer | Field type palette | Fields list | Add field |
| Entity Designer | Field row | Field row khác | Reorder |
| Page Designer | Component palette | Canvas grid | Add component |
| Page Designer | Component corner handle | (mouse drag) | Resize |
| Workflow Designer | Node palette | Canvas | Add node |
| Workflow Designer | Node output port | Node input port | Connect edge |
| DataGrid | Column header | Group bar | Group by column |

Tất cả drag-drop có visual feedback: dragged item mờ (opacity 0.4), drop zone highlight viền accent2.

### 8.2 Keyboard shortcuts

- `Cmd/Ctrl + K` — Command palette
- `Cmd/Ctrl + S` — Save current designer
- `Cmd/Ctrl + Z` / `Cmd/Ctrl + Shift + Z` — Undo/Redo
- `Esc` — Close modal/drawer/inspector
- `Cmd/Ctrl + Enter` — Submit form
- `/` — Focus search
- `?` — Show shortcuts dialog

### 8.3 Inline editing

- Click vào title/label → biến thành input ngay tại chỗ
- Enter để save, Esc để cancel

### 8.4 Optimistic UI

- Save entity / page / workflow → update local store NGAY rồi mới sync MCP background
- Hiển thị spinner nhỏ cạnh title "Đang lưu..." → "Đã lưu" với check mark sau khi xong

---

## 9. States

Mỗi component cần có 4 state UI:

1. **Empty** — chưa có data: icon + message "Chưa có X. Bấm + để tạo mới."
2. **Loading** — đang fetch: skeleton placeholder cho list/grid, spinner cho action
3. **Error** — fetch fail: icon đỏ + message + nút "Thử lại"
4. **Success** — có data: render bình thường

Toast positions: bottom-right, auto-dismiss 3s. 4 variant: info, success, warning, error.

---

## 10. Accessibility (a11y)

- Tất cả interactive: `role`, `aria-label`, `tabindex` đúng
- Focus visible: 2px ring accent quanh element
- Skip-to-content link đầu page
- Modal: trap focus + return focus khi đóng
- Color contrast: WCAG AA (4.5:1 cho text thường, 3:1 cho large text)
- Hỗ trợ screen reader: form field link với label qua `htmlFor`/`id`

---

## 11. Responsive

| Breakpoint | Layout |
|---|---|
| < 640px (mobile) | Sidebar trượt overlay, inspector trượt từ phải, single-column canvas |
| 640-1024px (tablet) | Sidebar collapse icon-only, inspector toggle |
| > 1024px (desktop) | Full 3-column layout |

Touch-friendly: tap target tối thiểu 36×36px trên mobile.

---

## 12. Reference apps

- **Retool** (https://retool.com) — page designer drag-drop layout
- **n8n** (https://n8n.io) — workflow node editor canvas
- **Make.com** — module-style workflow with hover preview
- **Notion** — clean typography, inline editing
- **Power BI Desktop** — field wells panel, dashboard
- **Linear** — keyboard shortcuts, command palette
- **Figma** — multi-cursor, comment thread, inspector tabs
- **Claude.ai** — agent chat bubble + tool call display
- **AG Grid** — DataGrid advanced features inspiration

---

## 13. Brand / illustration style

- Logo: lightning bolt ⚡ trong square gradient accent → accent2
- Empty state illustrations: minimal line art, monochrome muted color
- Avatar fallback: monogram gradient
- Không dùng stock photo

---

## 14. Deliverables expected from designer

1. **Figma file** với:
   - Token library (colors, typography, spacing, shadow)
   - Component library (~30 components atomic → organism)
   - 8 screens key (mục 7) — desktop + mobile variants
   - Interaction prototype cho drag-drop critical paths
2. **Style guide markdown** — bổ sung mục 4 với example
3. **Icon set** — chọn từ Lucide, có thể custom 5-10 icon riêng cho ERP (entity, workflow, agent, ...)

---

## 15. NOT to design (out of scope cho v1)

- Mobile native app
- Theme custom của user (chỉ có built-in dark + light)
- Multi-tenant landing page
- Marketing site

---

## 16. Constraints kỹ thuật designer cần biết

- Output: **Tailwind CSS classes** (không CSS custom phức tạp)
- Stack: React 19 + shadcn/ui — designer dùng được pattern của shadcn nếu quen
- Bundle budget: < 200KB gzip JS, < 50KB CSS
- Browser support: Chrome/Edge/Firefox/Safari 2 major versions gần nhất
- Vietnamese font: dùng system font (đã đủ tốt cho diacritics)

---

**Phiên bản**: 1.0 · 2026-05-19
**Liên hệ**: Toan (toanvu93@gmail.com)
