# Kế hoạch decomposition 2 file engine: ConsumerPage + PageDesigner

> Trạng thái (cập nhật 2026-06-20): **ĐÃ XONG A1→A7 + B1→B3** (mỗi stage 1
> commit, di chuyển verbatim/byte-identical, typecheck + biome 0 error, 530
> unit test xanh). ConsumerPage 6538 → **801 dòng**; PageDesigner 6167 →
> **3935 dòng**. File mới: renderer/{page-types.ts, page-data.tsx,
> widgets/{viz-widgets,input-widgets,FilterWidget,FormDetailWidget,list-widgets,
> layout-widgets}.tsx}; designer/{page-designer-constants.ts (thêm PageComponent+
> ActionBarItem), canvas/canvas-preview.tsx, inspectors/inspector-helpers.tsx}.
>
> **CÒN LẠI: B4** (tách inspector inline trong main PageDesigner) — KHÔNG phải
> pure-move: phải nâng ~19 useState vào hook + prop-thread, **bắt buộc QA render
> thủ công theo từng tab** (lỗi closure/re-render KHÔNG lộ qua typecheck). Để làm
> trong phiên RIÊNG có chạy app (designer mode) để kiểm từng tab.

## Vì sao tách riêng, cẩn thận

- `ConsumerPage.tsx` (~6515 dòng) là **engine render** của MỌI trang low-code.
  `PageDesigner.tsx` (~6167 dòng) là **trình dựng** trang. Lỗi tinh vi (sai state
  closure, mất re-render, đứt context) **KHÔNG lộ qua typecheck** — chỉ thấy khi
  mở trang thật. Nên mỗi bước phải QA render.
- Cả 2 file đều có **`interface PageComponent` CỤC BỘ** (ConsumerPage dòng ~76,
  PageDesigner dòng ~64) — KHÁC `@/types/page`. ⚠ Khi tách type/hàm dùng
  PageComponent ra module chung, KHÔNG import `@/types/page` (lệch type identity
  như đã dính ở Phase 12). Cách xử lý: (a) generic theo shape (như layout-storage
  đã làm), HOẶC (b) chuyển hẳn local PageComponent thành 1 file type chung
  `renderer/page-types.ts` rồi cả 2 cùng import (lựa chọn sạch hơn cho dài hạn,
  nhưng phải so 2 interface trước khi gộp — có thể KHÁC field).

## Nguyên tắc xuyên suốt (giữ như 13 phase đã làm)

1. Chỉ di chuyển code, KHÔNG đổi hành vi. Mỗi stage 1 commit revert được.
2. Sau mỗi stage: `pnpm typecheck` (app baseline hiện 8 lỗi pre-existing:
   useDocumentTitle ×6 + … — không phát sinh lỗi mới) + `biome check src` 0 error.
3. **MỚI cho engine: QA render thủ công** sau mỗi stage (checklist cuối doc).
4. Mỗi widget/inspector tách xong import foundation từ module chung — KHÔNG
   nhân bản hook/context.

---

## A. ConsumerPage.tsx — DỄ HƠN (widget là hàm top-level)

Widget đều là **hàm top-level** (`ListWidget`, `ChartWidget`, …) dispatch qua
`Widget({comp})` (dòng ~5774) theo `comp.kind`. Chúng dùng chung: `usePageState`,
`useWidgetData`/`useWidgetMeta`, `EditableCell`, các type cục bộ. → Tách
foundation TRƯỚC, rồi từng widget import vào.

### Stage A1 — `renderer/page-types.ts` (shared types)
Gom type cục bộ dùng nhiều: `PageComponent`, `PageStateValue/PageStateCtx`,
`LoadFilterOp/LoadFilters`, `UseRecordsOpts`, `WidgetData`, `ServerPagedResult`,
`AggSpec`, `RowDetailCfg`, `EmbeddedFilter`, `FItemCfg`, `ActionBarItem`,
`VisibleRule`, `SplitPanelCfg`, `SplitGridCell`, `ChartKind`.
- Rủi ro thấp (chỉ type). Verify typecheck.

### Stage A2 — `renderer/page-data.tsx` (FOUNDATION — bước then chốt)
Chuyển: `const api`, `PageStateContext`, `PageStateProvider`, `usePageState`,
`DEFAULT_ROW_LIMIT/MAX_ROW_LIMIT`, và CÁC HOOK dữ liệu: `useDataOpts`,
`useRecords`, `useEntity`, `useDataSourceRecords`, `useServerPagedRecords`,
`useWidgetData`, `useWidgetMeta`. Export hết. ConsumerPage + mọi widget import.
- ⚠ Đây là phần khó nhất của ConsumerPage: các hook này phụ thuộc `api` client,
  `applyFilters` (page-filters), `idbGet/Set`, stores. Kéo theo import.
- ⚠ `useServerPagedRecords` ~190 dòng, nhiều state — copy NGUYÊN, không sửa.
- **QA render sau stage này** (vì foundation đổi nơi định nghĩa): mở 1 trang list
  thường + 1 trang server-paged + 1 trang có datasource → kiểm dữ liệu vẫn tải.

### Stage A3 — leaf widget độc lập (rủi ro thấp)
Tách từng nhóm vào `renderer/widgets/` (mỗi widget import page-data + page-types):
`ChartWidget`, `KpiWidget`, `PivotWidget`, `CalendarWidget`, `MapWidget`+`LeafletMap`,
`KanbanWidget`, `StepWidget`, `SearchWidget`, `ComboboxWidget`, `ListboxWidget`,
`TagboxWidget`. Mỗi cái prop `cfg` → dùng `useWidgetData`. **QA: mở trang có từng
loại widget.**

### Stage A4 — cụm Filter
`FilterItem` + `MultiItemFilter` + `FilterWidget` + `LegacyCascadeFilter` →
`renderer/widgets/FilterWidget.tsx`. (Cẩn thận: filter đẩy pageState — test
combobox/tagbox lọc cha-con.)

### Stage A5 — cụm Detail/Form
`DetailWidget` + `CollectionSection`; `FormWidget`. → file riêng. QA: mở trang
detail (xem field + collection 1-N), trang form (tạo/sửa record).

### Stage A6 — cụm List (KHÓ NHẤT — để cuối)
`EditableCell`, `RemoveNewRowButton`, `usePersistedDraft`, `EditableListWidget`,
`ServerPagedListWidget`, `ListWidget` (~815 dòng), helper `bindRowIdToAction`.
→ `renderer/widgets/list/`. List dùng DataGrid + ExcelGrid + paste/export +
inline edit + batch. **QA kỹ: sửa ô, thêm/xoá dòng, paste, export, server-paging.**

### Stage A7 — Layout/Split/Grid + ActionBar
`useSplitRatios`, `useGridDrag`, `buildSubCfg`, `RenderSubWidget`, `GridWidget`,
`SplitWidget`; `ActionOverflowBar`/`EmbeddedActionStrip`/`ActionBarWidget`. →
`renderer/widgets/layout/`. QA: trang split panel + grid + action bar overflow.

### Kết: ConsumerPage còn lại
`Widget` dispatcher + `ConsumerPage` main + `VisibilityGate`/`evalVisible` +
`ROW_H/GAP` → orchestrator ~400–600 dòng.

---

## B. PageDesigner.tsx — KHÓ HƠN (inspector là JSX inline)

`PageDesigner()` (dòng ~581–4445, ~3865 dòng) chứa **inspector dạng JSX inline**:
`{inspTab === "chung" && (...)}`, `{inspTab === "dulieu" && (...)}`,
`"band"/"dieukien"/"bocuc"…` — đóng-closure trên ~19 biến `useState`. Đây là phần
khó: KHÔNG phải hàm tách sẵn, phải **nâng state vào hook + truyền prop/context**.

### Stage B1 — constants thuần (rủi ro ~0, làm ngay được)
`PALETTE`, `RECORD_DATA_KINDS`, `LOAD_OPS`, `BINDING_KINDS`, `INPUT_WIDGET_KINDS`,
`EMBED_PALETTE`, type `ComponentKind` → `designer/page-designer-constants.ts`.
(grid-layout đã tách ở Phase 13.)

### Stage B2 — `ComponentBody` (canvas preview, ~1230 dòng, dòng ~4746)
Đây là HÀM top-level (không inline) → tách được như widget. Nó render preview
component trên canvas (gọi ConsumerPage widget). → `designer/canvas/ComponentBody.tsx`.
**QA: mở designer, kéo các loại component vào canvas, xem preview đúng.**

### Stage B3 — sub-component đã-là-hàm
`ComponentCard` (+`ComponentCardProps`), `PreviewBox`, `SplitPanelDropZone`,
`EmbeddedActionStrip`, `ActionBarInspector` (+props), `BindingSourceConfig`,
`DataLoadConfig`, `FilterItemsInspector`, `tabsForKind` → `designer/canvas/` +
`designer/inspectors/`. Đều là hàm top-level → tách an toàn, import vào main.

### Stage B4 — TÁCH INSPECTOR INLINE (khó nhất, làm sau cùng, từng tab một)
Mỗi block `{inspTab === "<tab>" && (...)}` trong main:
1. Gom state + handler mà block đó dùng vào 1 object/hook (vd `useInspectorState`).
2. Tạo `designer/inspectors/<Tab>Inspector.tsx` nhận props (selected component +
   callbacks update + state cần).
3. Thay block inline bằng `<XInspector ... />`.
- Làm **TỪNG TAB một** (chung → dulieu → band → dieukien → bocuc → …), QA designer
  sau mỗi tab (chọn component, đổi mọi field trong tab đó, xem canvas cập nhật +
  autosave chạy).
- ⚠ Giữ nguyên `key={...}`/`useEffect` deps (CLAUDE.md: useExhaustiveDependencies
  suppress, KHÔNG thêm/bớt deps).

### Kết: PageDesigner còn lại
Main `PageDesigner` = state + layout + canvas mount + inspector tabs mount →
orchestrator ~800–1200 dòng.

---

## Thứ tự đề xuất (giảm rủi ro)
1. **B1** (constants, ~0 rủi ro) — khởi động.
2. **A1 → A2** (ConsumerPage types + foundation) — mở khoá tách widget.
3. **A3 → A7** (widget ConsumerPage, dễ→khó).
4. **B2 → B3** (Componentbody + sub-component PageDesigner).
5. **B4** (inspector inline — khó nhất, từng tab).

Mỗi mục = 1+ commit, push sớm để giảm cửa sổ xung đột (2 file này hay bị sửa).

## Verification — QA RENDER (bắt buộc, vì typecheck không bắt được)

Sau mỗi stage, mở app (`pnpm dev`) và kiểm thủ công phần liên quan:

**ConsumerPage (mở trang thật ở /pages/<id> hoặc /portal):**
- [ ] List: hiển thị, sort/filter/group, sửa ô (double-click), thêm/xoá dòng, paste, export CSV/XLSX, server-paging.
- [ ] Detail: field scalar + collection 1-N (thêm/sửa/xoá con).
- [ ] Form: tạo + sửa record, field điều kiện.
- [ ] Chart/Kpi/Pivot/Calendar/Map/Kanban/Step: render đúng theo cfg.
- [ ] Filter (combobox/tagbox/listbox/search): lọc cha-con + đẩy pageState.
- [ ] Split/Grid panel: layout + drag resize; ActionBar overflow "more".
- [ ] Personal layout: kéo sắp xếp + reload giữ nguyên (localStorage).

**PageDesigner (mở /pages/<id> chế độ dựng):**
- [ ] Kéo component từ palette vào canvas; preview đúng.
- [ ] Chọn component → mỗi tab inspector (chung/dữ liệu/band/điều kiện/bố cục…):
      đổi field → canvas cập nhật + autosave.
- [ ] Split panel: thêm/bớt cột-hàng, merge/split cell, đổi orientation.
- [ ] Action bar inspector: thêm/sửa/xoá action.
- [ ] Undo/redo; publish.

## Rollback
Mỗi stage 1 commit độc lập → `git revert <sha>` nếu QA phát hiện lỗi render mà
typecheck không bắt. KHÔNG gộp nhiều stage vào 1 commit (khó cô lập lỗi engine).
