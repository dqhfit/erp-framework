# Kế hoạch decomposition 2 file engine: ConsumerPage + PageDesigner

> Trạng thái (cập nhật 2026-06-20): **HOÀN TẤT A1→A7 + B1→B4** — toàn bộ kế
> hoạch decomposition đã làm xong (mỗi stage 1 commit, di chuyển verbatim/
> byte-identical, typecheck + biome 0 error, 530 unit test xanh). ConsumerPage
> 6538 → **801 dòng**; PageDesigner 6167 → **1163 dòng** (orchestrator, đúng mục
> tiêu).
>
> File mới renderer/: page-types.ts, page-data.tsx, widgets/{viz-widgets,
> input-widgets,FilterWidget,FormDetailWidget,list-widgets,layout-widgets}.tsx.
> File mới designer/: page-designer-constants.ts (thêm PageComponent+ActionBarItem),
> canvas/canvas-preview.tsx, inspectors/{inspector-helpers,ChungInspector,
> BandInspector,DieukienInspector,DulieuInspector,BocucInspector,BuocInspector,
> HanhDongInspector,AdvancedFilterInspector}.tsx.
>
> B4 cách làm: mỗi tab inspector inline → 1 component `<XInspector sel update …/>`;
> dữ liệu store (entities/dataSources/dataSourceContent) đọc thẳng qua
> useUserObjects trong component (khỏi prop-thread), chỉ thread state/handler
> main-local (sel/update/setInspTab/splitPanelTab/splitCellSel/expandedStep/
> stateSources/ensureMasterEmits). QA render đã xác nhận tab Chung; các tab còn
> lại cùng pattern.

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

---

## C. DataGrid.tsx — decomposition riêng (file engine thứ 3)

> DataGrid 2254 → **2014 dòng** sau D1+D2 (đã push). Pure-util đã tách sẵn
> `renderer/datagrid/grid-utils.ts` từ trước.

### ĐÃ XONG
- **D1**: `DataGridProps/ServerGridQuery/ServerPagingController` → `datagrid/types.ts`
  (DataGrid re-export, public surface không đổi); `FacetFilterInput` + `FACET_MAX_DISTINCT`
  → `datagrid/FacetFilterInput.tsx`.
- **D2a**: `useColumnAutofit` (measureCol/autofitColumn/autofitAll + effect autofit-on-load
  + autofitDoneRef) → `datagrid/use-column-autofit.ts`.
- **D2b**: `useGridPersistence` (restore mount + debounce-save IDB theo stateKey)
  → `datagrid/use-grid-persistence.ts`.
- QA (Playwright, session-injection): grid render + autofit + persistence-reload + 0
  console-error đã xác nhận trên trang ngũ kim (e69c332b).

### CÒN LẠI — D3: tách `DataGridToolbar` (encapsulate dropdown state) — TURNKEY
Khối **toolbar = dòng 645–1333** (`{toolbar && (<div ref={toolbarBorderRef}>…</div>)}`).
Selection-bar (1335–1386) + grid (`{viewMode === "card" ? … }` 1388+) là sibling RIÊNG,
KHÔNG thuộc toolbar. Cách làm (verbatim block-move → behavior giữ nguyên, typecheck
bắt sai prop, biome bắt sai cú pháp JSX → an toàn, revert được):

1. Tạo `datagrid/DataGridToolbar.tsx`. **CHUYỂN VÀO** (toolbar-only, đã verify không
   dùng ngoài 645–1333 + effect của chúng):
   - state (6): `groupPickerOpen, colChooserOpen, exportMenuOpen, exporting, overflowOpen, toolbarNarrow`
   - ref (8): `groupPickerRef, colChooserRef, exportBtnRef, groupDropdownRef, colDropdownRef, exportDropdownRef, overflowBtnRef, toolbarBorderRef`
   - effect (5): close-group (≈237–248), close-col (≈250–261), close-export (≈541–552),
     overflow-measure ResizeObserver→setToolbarNarrow (≈554–565), close-overflow (≈567–573)
   - handler: `doExport` (≈612–635)
   - derived TÍNH LẠI TỪ `table` bên trong: `sortableColumns, allSortableCols,
     activeFilterCount (= table.getState().columnFilters.length), leafCols, exportCols`
2. **PROP (≈22, shared)**: `table` + `filterRowOpen/setFilterRowOpen,
   showSelectCol/setShowSelectCol, maximized/setMaximized, globalFilter/setGlobalFilter,
   setPasteOpen, autofitAll, selectedCount, someSelected, clearSelection, viewMode/setViewMode,
   label, serverMode, totalCount, filteredCount, data, enableSelection, onPasteApply,
   onAddRow, onExportAll`. (Nhóm thành object cho gọn signature.)
   `grouping/columnFilters` KHÔNG cần prop — đọc `table.getState()`.
3. Thay 645–1333 bằng `<DataGridToolbar … />`; gỡ các decl đã move khỏi DataGrid.
4. Verify: `tsc` (lặp tới sạch) + `biome` + render-QA (mở từng dropdown group/cột/export/
   overflow, export, đổi viewMode, maximize) + `vitest`. ⚠ Làm phiên RIÊNG có app chạy
   để QA tương tác từng nút (render-QA tự động chỉ bắt crash, không bắt lỗi tương tác tinh vi).
   QA nhanh: chèn session tạm `INSERT INTO sessions(id,user_id,active_company_id,expires_at,
   created_at)` (cookie `sid`=id) → Playwright addCookies → /pages/e69c332b → "Xem trước".

### (tuỳ chọn) D3b: `DataGridPagination` (footer phân trang + summary <tfoot>) — sạch hơn,
ít prop hơn toolbar; có thể làm trước D3 nếu muốn win nhỏ an toàn.
