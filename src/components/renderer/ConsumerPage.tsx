/* ==========================================================
   ConsumerPage — render trang ĐÃ THIẾT KẾ ở chế độ người dùng.
   Đọc danh sách widget từ pageContent (do PageDesigner lưu) và
   render trên lưới 12 cột. Widget list/chart/kanban truy vấn
   RECORD THẬT của entity bound (qua ApiDataSource); widget form
   ghi record thật vào backend. KHÔNG còn dữ liệu giả.
   ========================================================== */

import type { ReactElement } from "react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { ActionWidget } from "@/components/renderer/ActionWidget";
import {
  clearPersonalLayoutLS,
  layoutStorageKey,
  loadPersonalLayout,
  savePersonalLayoutLS,
} from "@/components/renderer/consumer-utils";
import type { ColumnGroupNode } from "@/components/renderer/DataGrid";
import { DocumentWidget } from "@/components/renderer/DocumentWidget";
import type { CreateFormCfg } from "@/components/renderer/MasterDetailCreateModal";
import { PageStateProvider, usePageState } from "@/components/renderer/page-data";
import type {
  ActionBarItem,
  EmbeddedFilter,
  LoadFilters,
  PageComponent,
  RowDetailCfg,
  SplitGridCell,
  SplitPanelCfg,
  VisibleRule,
} from "@/components/renderer/page-types";
import { FilterWidget } from "@/components/renderer/widgets/FilterWidget";
import { DetailWidget, FormWidget } from "@/components/renderer/widgets/FormDetailWidget";
import {
  ComboboxWidget,
  ListboxWidget,
  SearchWidget,
  TagboxWidget,
} from "@/components/renderer/widgets/input-widgets";
import { ListWidget, ServerPagedListWidget } from "@/components/renderer/widgets/list-widgets";
import {
  CalendarWidget,
  ChartWidget,
  KanbanWidget,
  KpiWidget,
  MapWidget,
  PivotWidget,
  StepWidget,
} from "@/components/renderer/widgets/viz-widgets";
import { isScalableKind, ScaleToFit } from "@/components/ScaleToFit";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useT } from "@/hooks/useT";
import { applyInsertAndResolve } from "@/lib/page-layout";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionConfig, FilterNode } from "@/types/page";

/** Drag-resize cho N panel: mảng ratios + onHandleDrag(index, e) cho từng thanh ngăn */
function useSplitRatios(
  initRatios: number[],
  containerRef: React.RefObject<HTMLDivElement | null>,
  axis: "h" | "v",
) {
  const [ratios, setRatios] = useState(() => [...initRatios]);
  const onHandleDrag = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    const start = axis === "h" ? e.clientX : e.clientY;
    const snap = [...ratios];
    const total = snap.reduce((a, b) => a + b, 0);
    const onMove = (ev: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const size = axis === "h" ? rect.width : rect.height;
      const delta = (((axis === "h" ? ev.clientX : ev.clientY) - start) / size) * total;
      const min = total * 0.05;
      const next = [...snap];
      // biome-ignore lint/style/noNonNullAssertion: i/i+1 always in range
      next[i] = Math.max(min, snap[i]! + delta);
      // biome-ignore lint/style/noNonNullAssertion: i/i+1 always in range
      next[i + 1] = Math.max(min, snap[i]! + snap[i + 1]! - next[i]!);
      setRatios(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  return { ratios, onHandleDrag };
}

/** Drag-resize cho grid N×M: trả colFr/rowFr local + handler mousedown cho mỗi thanh ngăn */
function useGridDrag(
  initColFr: number[],
  initRowFr: number[],
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [colFr, setColFr] = useState(() => [...initColFr]);
  const [rowFr, setRowFr] = useState(() => [...initRowFr]);

  const onColDrag = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const snap = [...colFr];
    const total = snap.reduce((a, b) => a + b, 0);
    const onMove = (ev: MouseEvent) => {
      const cw = containerRef.current?.getBoundingClientRect().width ?? 0;
      if (!cw) return;
      const delta = ((ev.clientX - startX) / cw) * total;
      const minFr = total * 0.05;
      const next = [...snap];
      // biome-ignore lint/style/noNonNullAssertion: i and i+1 are always in range
      next[i] = Math.max(minFr, snap[i]! + delta);
      // biome-ignore lint/style/noNonNullAssertion: i and i+1 are always in range
      next[i + 1] = Math.max(minFr, snap[i]! + snap[i + 1]! - next[i]!);
      setColFr(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const onRowDrag = (j: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const snap = [...rowFr];
    const total = snap.reduce((a, b) => a + b, 0);
    const onMove = (ev: MouseEvent) => {
      const ch = containerRef.current?.getBoundingClientRect().height ?? 0;
      if (!ch) return;
      const delta = ((ev.clientY - startY) / ch) * total;
      const minFr = total * 0.05;
      const next = [...snap];
      // biome-ignore lint/style/noNonNullAssertion: j and j+1 are always in range
      next[j] = Math.max(minFr, snap[j]! + delta);
      // biome-ignore lint/style/noNonNullAssertion: j and j+1 are always in range
      next[j + 1] = Math.max(minFr, snap[j]! + snap[j + 1]! - next[j]!);
      setRowFr(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return { colFr, rowFr, onColDrag, onRowDrag };
}

/**
 * panelKey: "a"|"b"|"c"|"d" khi gọi từ SplitWidget — mỗi panel có key riêng để
 * các panel khác có thể lọc độc lập. Bỏ qua (undefined) khi gọi từ GridWidget
 * để giữ hành vi cũ (dùng chung splitKey).
 */
function buildSubCfg(
  panel: SplitPanelCfg,
  splitKey: string,
  panelKey?: string,
): Record<string, unknown> {
  const kind = panel.kind ?? "list";
  // Với split widget: mỗi panel dùng key riêng; grid widget dùng splitKey chung.
  const ownStateKey = panelKey ? `${splitKey}:${panelKey}` : splitKey;
  const srcStateKey = panelKey
    ? `${splitKey}:${(panel.filterFromPanel ?? "a").toUpperCase()}`
    : splitKey;
  return {
    entity: panel.entity,
    dataSourceId: panel.dataSourceId,
    title: panel.title,
    fields: panel.fields,
    columnLabels: panel.columnLabels,
    columnGroups: panel.columnGroups,
    serverPaging: panel.serverPaging,
    editable: panel.editable,
    batchEdit: panel.batchEdit,
    excelMode: panel.excelMode,
    multiSelect: panel.multiSelect,
    loadGate: panel.loadGate,
    loadFilters: panel.loadFilters,
    rowLimit: panel.rowLimit,
    pageSize: panel.pageSize,
    defaultSort: panel.defaultSort,
    embeddedActions: panel.embeddedActions,
    rowActionsBuiltin: panel.rowActionsBuiltin,
    rowActionsHidden: panel.rowActionsHidden,
    rowActionsStyle: panel.rowActionsStyle,
    rowActions: panel.rowActions,
    createForm: panel.createForm,
    editForm: panel.editForm,
    selectable: panel.selectable,
    addRowAtEnd: panel.addRowAtEnd,
    addRowPos: panel.addRowPos,
    groupBy: panel.groupBy,
    valueField: panel.valueField,
    // chart kind maps to cfg.kind (ChartWidget reads cfg.kind for bar/line/pie…)
    ...(kind === "chart" ? { kind: panel.chartKind ?? "bar" } : {}),
    ...(kind === "list"
      ? {
          selectionStateKey: ownStateKey,
          ...(panel.sourceField ? { selectionField: panel.sourceField } : {}),
          // sourceFields: mỗi field phát thêm 1 state key riêng {ownStateKey}:{field}
          ...(panel.sourceFields?.length
            ? {
                selectionEmits: Object.fromEntries(
                  panel.sourceFields.map((f) => [`${ownStateKey}:${f}`, f]),
                ),
              }
            : {}),
        }
      : {}),
    ...(kind === "detail" ? { recordIdFromState: srcStateKey } : {}),
    // linkField đơn (backwards compat) → filterFromState như cũ.
    // Bỏ qua khi linkConditions đã khai báo: linkConditions ưu tiên + filterFromState
    // sẽ dùng row-id (uuid) làm stateKey → không bao giờ khớp field nghiệp vụ → ẩn hết.
    ...((kind === "list" || kind === "chart" || kind === "kanban") &&
    panel.linkField &&
    !panel.linkConditions?.length
      ? { filterFromState: { field: panel.linkField, stateKey: srcStateKey } }
      : {}),
    // linkConditions: mảng điều kiện AND — fromField → key phụ; bỏ fromField → key chính
    ...((kind === "list" || kind === "chart" || kind === "kanban") && panel.linkConditions?.length
      ? {
          filterConditions: panel.linkConditions.map((c) => {
            const fp = (c.fromPanel ?? panel.filterFromPanel ?? "a").toUpperCase();
            const fromStateKey = panelKey
              ? c.fromField
                ? `${splitKey}:${fp}:${c.fromField}`
                : `${splitKey}:${fp}`
              : splitKey;
            return { field: c.toField, stateKey: fromStateKey };
          }),
        }
      : {}),
    ...(kind === "form" && panel.linkField
      ? { linkedToState: { field: panel.linkField, stateKey: srcStateKey } }
      : {}),
  };
}

function RenderSubWidget({
  kind,
  cfg,
  stateKey,
}: {
  kind: string;
  cfg: Record<string, unknown>;
  stateKey: string;
}) {
  const pageState = usePageState();
  const embeddedActions = (cfg.embeddedActions ?? []) as ActionBarItem[];

  // Split widget lồng nhau bên trong tab panel — dùng stateKey làm id để namespace state
  if (kind === "split") {
    const fakeComp: PageComponent = {
      id: stateKey.replace(/[^a-zA-Z0-9_]/g, "_"),
      kind: "split",
      x: 0,
      y: 0,
      w: 12,
      h: 12,
      config: cfg,
    };
    return <SplitWidget comp={fakeComp} />;
  }

  if (kind === "list") {
    // Bảng lớn: serverPaging → phân trang/sắp/lọc server-side (hỗ trợ cả sửa ô).
    if (cfg.serverPaging === true && cfg.excelMode !== true)
      return withEmbeddedActions(
        <ServerPagedListWidget
          entityId={cfg.entity as string | undefined}
          dataSourceId={cfg.dataSourceId as string | undefined}
          stateKey={stateKey}
          fields={cfg.fields as string[] | undefined}
          columnLabels={cfg.columnLabels as Record<string, string> | undefined}
          columnGroups={cfg.columnGroups as ColumnGroupNode[] | undefined}
          selectionStateKey={cfg.selectionStateKey as string | undefined}
          title={cfg.title as string | undefined}
          multiSelect={cfg.multiSelect === true}
          editable={cfg.editable === true}
          batchEdit={cfg.batchEdit === true}
          pageSize={cfg.pageSize as number | undefined}
          loadFilters={cfg.loadFilters as LoadFilters | undefined}
          loadGate={cfg.loadGate as string | undefined}
          selectable={cfg.selectable === true}
        />,
        embeddedActions,
        pageState,
      );
    return withEmbeddedActions(
      <ListWidget
        entityId={cfg.entity as string | undefined}
        dataSourceId={cfg.dataSourceId as string | undefined}
        stateKey={stateKey}
        fields={cfg.fields as string[] | undefined}
        columnLabels={cfg.columnLabels as Record<string, string> | undefined}
        columnGroups={cfg.columnGroups as ColumnGroupNode[] | undefined}
        defaultGrouping={cfg.defaultGrouping as string[] | undefined}
        selectionStateKey={cfg.selectionStateKey as string | undefined}
        selectionField={cfg.selectionField as string | undefined}
        selectionEmits={cfg.selectionEmits as Record<string, string> | undefined}
        filterFromState={cfg.filterFromState as { field: string; stateKey: string } | undefined}
        filterConditions={
          cfg.filterConditions as Array<{ field: string; stateKey: string }> | undefined
        }
        searchFromState={cfg.searchFromState as string | undefined}
        title={cfg.title as string | undefined}
        multiSelect={cfg.multiSelect === true}
        editable={cfg.editable === true}
        batchEdit={cfg.batchEdit === true}
        excelMode={cfg.excelMode === true}
        rowLimit={cfg.rowLimit as number | undefined}
        pageSize={cfg.pageSize as number | undefined}
        loadFilters={cfg.loadFilters as LoadFilters | undefined}
        loadGate={cfg.loadGate as string | undefined}
        rowDetail={cfg.rowDetail as RowDetailCfg | undefined}
        createForm={cfg.createForm as CreateFormCfg | undefined}
        editForm={cfg.editForm as CreateFormCfg | undefined}
        rowActions={cfg.rowActions as ActionConfig[] | undefined}
        rowActionsBuiltin={cfg.rowActionsBuiltin === true}
        editFields={cfg.editFields as string[] | undefined}
        rowActionsHidden={cfg.rowActionsHidden as string[] | undefined}
        rowActionsStyle={cfg.rowActionsStyle as "inline" | "popover" | undefined}
        selectable={cfg.selectable === true}
        addRowAtEnd={cfg.addRowAtEnd === true}
        addRowPos={cfg.addRowPos === "top" ? "top" : "bottom"}
        defaultSort={cfg.defaultSort as { field: string; dir: "asc" | "desc" } | undefined}
      />,
      embeddedActions,
      pageState,
    );
  }
  if (kind === "detail")
    return withEmbeddedActions(<DetailWidget cfg={cfg} />, embeddedActions, pageState);
  if (kind === "form")
    return withEmbeddedActions(<FormWidget cfg={cfg} />, embeddedActions, pageState);
  if (kind === "chart") return <ChartWidget cfg={cfg} />;
  if (kind === "kanban") return <KanbanWidget cfg={cfg} />;
  return null;
}

/** Grid Layout N×M — kind="grid", config.cells[]; có drag handle giữa cột/hàng */
function GridWidget({ comp }: { comp: PageComponent }) {
  const cfg = comp.config ?? {};
  const splitKey = `split_${comp.id}_sel`;
  const cols = (cfg.cols as number) || 2;
  const rows = (cfg.rows as number) || 1;
  const cells = (cfg.cells as SplitGridCell[]) ?? [];
  const gridLabel = cfg.label as string | undefined;

  // Normalize fr arrays to match col/row count
  const savedColFr = cfg.colFr as number[] | undefined;
  const savedRowFr = cfg.rowFr as number[] | undefined;
  const initColFr: number[] = Array.from({ length: cols }, (_, i): number => savedColFr?.[i] ?? 1);
  const initRowFr: number[] = Array.from({ length: rows }, (_, j): number => savedRowFr?.[j] ?? 1);

  const containerRef = useRef<HTMLDivElement>(null);
  const { colFr, rowFr, onColDrag, onRowDrag } = useGridDrag(
    initColFr,
    initRowFr,
    containerRef as React.RefObject<HTMLDivElement | null>,
  );

  // Template interleaves content fr tracks with 4px handle tracks
  // e.g. cols=3: "1fr 4px 1fr 4px 1fr"
  const colTemplate = colFr.map((f, i) => (i < cols - 1 ? `${f}fr 4px` : `${f}fr`)).join(" ");
  const rowTemplate = rowFr.map((f, j) => (j < rows - 1 ? `${f}fr 4px` : `${f}fr`)).join(" ");

  // Content col c → display col (c-1)*2+1; colSpan s → display span s*2-1
  const cellStyle = (cell: SplitGridCell) => ({
    gridColumn: `${(cell.col - 1) * 2 + 1} / span ${cell.colSpan * 2 - 1}`,
    gridRow: `${(cell.row - 1) * 2 + 1} / span ${cell.rowSpan * 2 - 1}`,
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {gridLabel && (
        <div className="px-3 py-1.5 border-b border-border/40 shrink-0 text-sm font-medium">
          {gridLabel}
        </div>
      )}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ display: "grid", gridTemplateColumns: colTemplate, gridTemplateRows: rowTemplate }}
      >
        {/* Handles rendered BEFORE cells — merged cells sit on top via DOM stacking order */}
        {Array.from({ length: cols - 1 }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: thanh ngăn cột — index ổn định
            key={`ch-${i}`}
            className="cursor-col-resize bg-border/30 hover:bg-accent/40 active:bg-accent/60 transition-colors"
            style={{
              gridColumn: `${(i + 1) * 2}`,
              gridRow: `1 / span ${rows * 2 - 1}`,
            }}
            onMouseDown={(e) => onColDrag(i, e)}
          />
        ))}
        {Array.from({ length: rows - 1 }, (_, j) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: thanh ngăn hàng — index ổn định
            key={`rh-${j}`}
            className="cursor-row-resize bg-border/30 hover:bg-accent/40 active:bg-accent/60 transition-colors"
            style={{
              gridColumn: `1 / span ${cols * 2 - 1}`,
              gridRow: `${(j + 1) * 2}`,
            }}
            onMouseDown={(e) => onRowDrag(j, e)}
          />
        ))}
        {/* Content cells — rendered last, on top of handle divs */}
        {cells.map((cell) => {
          const kind = cell.kind ?? "list";
          const cellCfg = buildSubCfg(cell as SplitPanelCfg, splitKey);
          return (
            <div key={cell.id} className="overflow-hidden" style={cellStyle(cell)}>
              {cell.entity || cell.dataSourceId ? (
                <RenderSubWidget kind={kind} cfg={cellCfg} stateKey={`${comp.id}:${cell.id}`} />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted/50">
                  Chưa bind
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SplitWidget({ comp }: { comp: PageComponent }) {
  const cfg = comp.config ?? {};
  const splitKey = `split_${comp.id}_sel`;
  const pageState = usePageState();
  const tabStateKey = cfg.tabStateKey as string | undefined;

  const orientation = (cfg.orientation as string) ?? "h";
  const count = Math.max(2, Math.min(3, (cfg.count as number) ?? 2));
  const isTabs = orientation === "tabs";
  const isBoth = orientation === "both";
  const isBoth2 = orientation === "both2";
  const isBoth3 = orientation === "both3";
  const isBoth4 = orientation === "both4";
  const isBoth5 = orientation === "both5";
  const isH =
    !isBoth && !isBoth2 && !isBoth3 && !isBoth4 && !isBoth5 && !isTabs && orientation !== "v";

  const panelA = (cfg.panelA as SplitPanelCfg | undefined) ?? {};
  const panelB = (cfg.panelB as SplitPanelCfg | undefined) ?? {};
  const panelC = (cfg.panelC as SplitPanelCfg | undefined) ?? {};
  const panelD = (cfg.panelD as SplitPanelCfg | undefined) ?? {};
  const kindA = panelA.kind ?? "list";
  const kindB = panelB.kind ?? "detail";
  const kindC = panelC.kind ?? "list";
  const kindD = panelD.kind ?? "list";
  const cfgA = buildSubCfg({ ...panelA, kind: kindA, linkField: undefined }, splitKey, "a");
  const cfgB = buildSubCfg({ ...panelB, kind: kindB }, splitKey, "b");
  const cfgC = buildSubCfg({ ...panelC, kind: kindC }, splitKey, "c");
  const cfgD = buildSubCfg({ ...panelD, kind: kindD }, splitKey, "d");

  // Ratios — initialized from saved config, adjusted by drag at runtime only
  const savedRatios = cfg.splitRatios as number[] | undefined;
  const initRatioH = (cfg.ratio as number) ?? 40;
  const initRatioV = (cfg.ratioV as number) ?? 50;
  const initRatioV2 = (cfg.ratioV2 as number) ?? 50;
  const panelCount = isBoth || isBoth2 || isBoth3 || isBoth4 || isBoth5 ? 2 : count;
  const initMain = savedRatios ?? (panelCount >= 3 ? [33, 33, 34] : [initRatioH, 100 - initRatioH]);
  const initBothV = [initRatioV, 100 - initRatioV];
  const initBothV2 = [initRatioV2, 100 - initRatioV2];

  // All hooks unconditional (React rules)
  const containerRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const rightRef2 = useRef<HTMLDivElement>(null);
  const subRowRef = useRef<HTMLDivElement>(null);
  const subRowRef2 = useRef<HTMLDivElement>(null);
  const mainRef = containerRef as React.RefObject<HTMLDivElement | null>;
  const bvRef = rightRef as React.RefObject<HTMLDivElement | null>;
  const bvRef2 = rightRef2 as React.RefObject<HTMLDivElement | null>;
  const bhRef = subRowRef as React.RefObject<HTMLDivElement | null>;
  const bhRef2 = subRowRef2 as React.RefObject<HTMLDivElement | null>;
  const { ratios: mainR, onHandleDrag: onMainDrag } = useSplitRatios(
    initMain,
    mainRef,
    isH || isBoth || isBoth2 || isBoth3 ? "h" : "v",
  );
  const { ratios: bothVR, onHandleDrag: onBothVDrag } = useSplitRatios(initBothV, bvRef, "v");
  const { ratios: bothVR2, onHandleDrag: onBothVDrag2 } = useSplitRatios(initBothV2, bvRef2, "v");
  // both4/both5: sub-row horizontal split (reuse ratioV for ratio source)
  const { ratios: bothHR, onHandleDrag: onBothHDrag } = useSplitRatios(initBothV, bhRef, "h");
  const { ratios: bothHR2, onHandleDrag: onBothHDrag2 } = useSplitRatios(initBothV, bhRef2, "h");
  const [activeTab, setActiveTab] = useState("A");

  // Emit tab title vào pageState khi isTabs + tabStateKey được cấu hình
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ cần chạy khi mount để set giá trị ban đầu
  useEffect(() => {
    if (!tabStateKey) return;
    const rawTabPanels = cfg.tabPanels as Array<{ title?: string }> | undefined;
    const firstLabel = rawTabPanels?.[0]?.title ?? "A";
    pageState.set(tabStateKey, firstLabel);
  }, [tabStateKey]);

  const handleCls = (ax: "h" | "v") =>
    `shrink-0 ${ax === "h" ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"} bg-border hover:bg-accent/50 transition-colors active:bg-accent`;

  // ── Tabs ──────────────────────────────────────────────────────────────
  if (isTabs) {
    // tabPanels array → N tabs (không giới hạn A/B/C); fallback về fixed A/B/C cũ
    const rawTabPanels = cfg.tabPanels as Array<SplitPanelCfg & { title?: string }> | undefined;
    const tabDefs = rawTabPanels?.length
      ? rawTabPanels.map((p, i) => {
          const kind = (p.kind as string) ?? "list";
          // kind="split" → pass-through raw config (panelA/panelB/orientation phải giữ nguyên)
          // Các kind khác → buildSubCfg chuẩn hóa (thêm selectionStateKey, linkField…)
          const tabCfg =
            kind === "split"
              ? (p as unknown as Record<string, unknown>)
              : buildSubCfg({ ...p, linkField: undefined }, splitKey, String(i));
          return { key: String(i), cfg: tabCfg, kind, label: p.title ?? `Tab ${i + 1}` };
        })
      : [
          { key: "A", cfg: cfgA, kind: kindA, label: panelA.title || "A" },
          { key: "B", cfg: cfgB, kind: kindB, label: panelB.title || "B" },
          ...(count >= 3 ? [{ key: "C", cfg: cfgC, kind: kindC, label: panelC.title || "C" }] : []),
        ];
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex border-b border-border shrink-0">
          {tabDefs.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setActiveTab(p.key);
                if (tabStateKey) pageState.set(tabStateKey, p.label);
              }}
              className={cn(
                "px-4 py-2 text-sm -mb-px border-b-2 transition-colors whitespace-nowrap",
                activeTab === p.key
                  ? "border-accent text-accent font-medium"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-hidden">
          {tabDefs.map((p) => (
            <div
              key={p.key}
              className="h-full overflow-hidden"
              style={{ display: activeTab === p.key ? "block" : "none" }}
            >
              <RenderSubWidget
                kind={p.kind}
                cfg={p.cfg}
                stateKey={`${comp.id}:${p.key.toLowerCase()}`}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Both (A | B trên / C dưới) ────────────────────────────────────────
  if (isBoth) {
    const total = mainR[0]! + mainR[1]!;
    const hPct = (mainR[0]! / total) * 100;
    const vTotal = bothVR[0]! + bothVR[1]!;
    const vPct = (bothVR[0]! / vTotal) * 100;
    return (
      <div ref={containerRef} className="flex flex-row h-full overflow-hidden">
        <div className="overflow-hidden" style={{ width: `${hPct}%` }}>
          <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("h")} />
        <div ref={rightRef} className="flex flex-col flex-1 overflow-hidden">
          <div className="overflow-hidden" style={{ height: `${vPct}%` }}>
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
          <div onMouseDown={(e) => onBothVDrag(0, e)} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
          </div>
        </div>
      </div>
    );
  }

  // ── Both2 ((A trên / B dưới) | C) ────────────────────────────────────
  if (isBoth2) {
    const total = mainR[0]! + mainR[1]!;
    const hPct = (mainR[0]! / total) * 100;
    const vTotal = bothVR[0]! + bothVR[1]!;
    const vPct = (bothVR[0]! / vTotal) * 100;
    return (
      <div ref={containerRef} className="flex flex-row h-full overflow-hidden">
        <div ref={rightRef} className="flex flex-col overflow-hidden" style={{ width: `${hPct}%` }}>
          <div className="overflow-hidden" style={{ height: `${vPct}%` }}>
            <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
          </div>
          <div onMouseDown={(e) => onBothVDrag(0, e)} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("h")} />
        <div className="flex-1 overflow-hidden">
          <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
        </div>
      </div>
    );
  }

  // ── Both3 ((A/B) | (C/D)) ────────────────────────────────────────────
  if (isBoth3) {
    const total3 = mainR[0]! + mainR[1]!;
    const hPct = (mainR[0]! / total3) * 100;
    const vTotal = bothVR[0]! + bothVR[1]!;
    const vPct = (bothVR[0]! / vTotal) * 100;
    const vTotal2 = bothVR2[0]! + bothVR2[1]!;
    const vPct2 = (bothVR2[0]! / vTotal2) * 100;
    return (
      <div ref={containerRef} className="flex flex-row h-full overflow-hidden">
        <div ref={rightRef} className="flex flex-col overflow-hidden" style={{ width: `${hPct}%` }}>
          <div className="overflow-hidden" style={{ height: `${vPct}%` }}>
            <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
          </div>
          <div onMouseDown={(e) => onBothVDrag(0, e)} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("h")} />
        <div ref={rightRef2} className="flex flex-col flex-1 overflow-hidden">
          <div className="overflow-hidden" style={{ height: `${vPct2}%` }}>
            <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
          </div>
          <div onMouseDown={(e) => onBothVDrag2(0, e)} className={handleCls("v")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindD} cfg={cfgD} stateKey={`${comp.id}:d`} />
          </div>
        </div>
      </div>
    );
  }

  // ── Both4 (A trên / B trái dưới, C phải dưới) ────────────────────────
  if (isBoth4) {
    const total = mainR[0]! + mainR[1]!;
    const vPct = (mainR[0]! / total) * 100;
    const hTotal = bothHR[0]! + bothHR[1]!;
    const hPct = (bothHR[0]! / hTotal) * 100;
    return (
      <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
        <div className="overflow-hidden" style={{ height: `${vPct}%` }}>
          <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("v")} />
        <div ref={subRowRef} className="flex flex-row flex-1 overflow-hidden">
          <div className="overflow-hidden" style={{ width: `${hPct}%` }}>
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
          <div onMouseDown={(e) => onBothHDrag(0, e)} className={handleCls("h")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
          </div>
        </div>
      </div>
    );
  }

  // ── Both5 (A trái trên, B phải trên / C dưới) ─────────────────────────
  if (isBoth5) {
    const total = mainR[0]! + mainR[1]!;
    const vPct = (mainR[0]! / total) * 100;
    const hTotal = bothHR2[0]! + bothHR2[1]!;
    const hPct = (bothHR2[0]! / hTotal) * 100;
    return (
      <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
        <div
          ref={subRowRef2}
          className="flex flex-row overflow-hidden"
          style={{ height: `${vPct}%` }}
        >
          <div className="overflow-hidden" style={{ width: `${hPct}%` }}>
            <RenderSubWidget kind={kindA} cfg={cfgA} stateKey={`${comp.id}:a`} />
          </div>
          <div onMouseDown={(e) => onBothHDrag2(0, e)} className={handleCls("h")} />
          <div className="flex-1 overflow-hidden">
            <RenderSubWidget kind={kindB} cfg={cfgB} stateKey={`${comp.id}:b`} />
          </div>
        </div>
        <div onMouseDown={(e) => onMainDrag(0, e)} className={handleCls("v")} />
        <div className="flex-1 overflow-hidden">
          <RenderSubWidget kind={kindC} cfg={cfgC} stateKey={`${comp.id}:c`} />
        </div>
      </div>
    );
  }

  // ── H / V (2 hoặc 3 panels) ───────────────────────────────────────────
  const flexDir = isH ? "flex-row" : "flex-col";
  const sizeKey = isH ? "width" : "height";
  const dragAxis = isH ? "h" : "v";
  const total = mainR.reduce((a, b) => a + b, 0);
  const allPanels = [
    { key: "a", cfg: cfgA, kind: kindA },
    { key: "b", cfg: cfgB, kind: kindB },
    ...(panelCount >= 3 ? [{ key: "c", cfg: cfgC, kind: kindC }] : []),
  ];

  return (
    <div ref={containerRef} className={`flex ${flexDir} h-full overflow-hidden`}>
      {allPanels.map((p, idx) => {
        const isLast = idx === allPanels.length - 1;
        const pct = ((mainR[idx] ?? 1) / total) * 100;
        return (
          <Fragment key={p.key}>
            <div
              className="overflow-hidden"
              style={isLast ? { flex: 1 } : { [sizeKey]: `${pct}%` }}
            >
              <RenderSubWidget kind={p.kind} cfg={p.cfg} stateKey={`${comp.id}:${p.key}`} />
            </div>
            {!isLast && (
              <div onMouseDown={(e) => onMainDrag(idx, e)} className={handleCls(dragAxis)} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Strip hành động nhúng bên trong widget (list/form/detail). */
/** Thanh hành động tràn → popover, dùng chung cho EmbeddedActionStrip + ActionBarWidget. */
function ActionOverflowBar({
  items,
  compact,
  justify = "justify-start",
  pageState,
  wrapClass,
}: {
  items: ActionBarItem[];
  compact: boolean;
  justify?: string;
  pageState: ReturnType<typeof usePageState>;
  wrapClass?: string;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<{ top: number; right: number } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items.length + compact đủ
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const ghost = ghostRef.current;
    if (!outer || !ghost) return;

    const measure = () => {
      const avail = outer.clientWidth;
      const children = Array.from(ghost.children) as HTMLElement[];
      const moreEl = children[children.length - 1];
      const moreW = (moreEl?.offsetWidth ?? 24) + 6;
      const itemEls = children.slice(0, -1);
      if (!itemEls.length) {
        setVisibleCount(0);
        return;
      }

      const last = itemEls[itemEls.length - 1];
      if (last && last.offsetLeft + last.offsetWidth <= avail) {
        setVisibleCount(itemEls.length);
        return;
      }
      let count = 0;
      for (let i = 0; i < itemEls.length; i++) {
        const el = itemEls[i]!;
        if (el.offsetLeft + el.offsetWidth + moreW <= avail) count = i + 1;
        else break;
      }
      setVisibleCount(Math.max(1, count));
    };

    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    measure();
    return () => ro.disconnect();
  }, [items.length, compact]);

  // Đóng popover khi click ngoài (check cả btn lẫn popover body)
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!moreBtnRef.current?.contains(t) && !popoverRef.current?.contains(t)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  const toggleMore = () => {
    if (!moreOpen) {
      const rect = moreBtnRef.current?.getBoundingClientRect();
      if (rect) {
        setPopoverStyle({
          top: rect.bottom + 4,
          right: window.innerWidth - rect.right,
        });
      }
    }
    setMoreOpen((v) => !v);
  };

  const visibleItems = items.slice(0, visibleCount);
  const hiddenItems = items.slice(visibleCount);

  return (
    <div ref={outerRef} className={cn("relative", wrapClass)}>
      {/* Ghost invisible để đo width thực — nằm trong outer (không overflow-hidden) */}
      <div
        ref={ghostRef}
        aria-hidden="true"
        className="absolute inset-0 flex items-center gap-1 px-2 invisible pointer-events-none"
      >
        {items.map((item) => (
          <ActionWidget
            key={item.id}
            config={item}
            pageState={pageState}
            inline
            compact={compact}
          />
        ))}
        <button type="button" className="h-6 w-6 shrink-0 rounded flex items-center justify-center">
          <I.MoreHorizontal size={13} />
        </button>
      </div>

      {/* Nội dung thật — overflow-hidden giữ 1 dòng */}
      <div className={cn("flex items-center gap-1 px-2 overflow-hidden h-full", justify)}>
        {visibleItems.map((item) => (
          <ActionWidget
            key={item.id}
            config={item}
            pageState={pageState}
            inline
            compact={compact}
          />
        ))}
        {hiddenItems.length > 0 && (
          <button
            ref={moreBtnRef}
            type="button"
            onClick={toggleMore}
            className={cn(
              "ml-auto shrink-0 h-6 w-6 rounded border border-border/60 text-muted hover:bg-hover flex items-center justify-center",
              moreOpen && "bg-hover border-accent/40 text-accent",
            )}
            title={`${hiddenItems.length} hành động khác`}
          >
            <I.MoreHorizontal size={13} />
          </button>
        )}
      </div>

      {/* Popover qua portal → không bị clip bởi overflow-hidden của ancestors */}
      {moreOpen &&
        hiddenItems.length > 0 &&
        popoverStyle &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              top: popoverStyle.top,
              right: popoverStyle.right,
              zIndex: 9999,
            }}
            className="bg-panel border border-border rounded-lg shadow-lg p-1 flex flex-col gap-0.5 min-w-[140px]"
          >
            {hiddenItems.map((item) => (
              <ActionWidget key={item.id} config={item} pageState={pageState} menuItem />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function EmbeddedActionStrip({
  items,
  pageState,
}: {
  items: ActionBarItem[];
  pageState: ReturnType<typeof usePageState>;
}) {
  return (
    <ActionOverflowBar
      items={items}
      compact
      pageState={pageState}
      wrapClass="border-b border-border/40 bg-panel-2/30 shrink-0 h-8"
    />
  );
}

/** Bọc widget có embeddedActions trong flex-col với strip hành động ở trên. */
function withEmbeddedActions(
  content: ReactElement,
  items: ActionBarItem[],
  pageState: ReturnType<typeof usePageState>,
): ReactElement {
  if (items.length === 0) return content;
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <EmbeddedActionStrip items={items} pageState={pageState} />
      <div className="flex-1 min-h-0 overflow-hidden">{content}</div>
    </div>
  );
}

/** Thanh nhiều nút hành động nằm ngang. */
function ActionBarWidget({
  cfg,
  pageState,
}: {
  cfg: Record<string, unknown>;
  pageState: ReturnType<typeof usePageState>;
}) {
  const t = useT();
  const items = (cfg.items ?? []) as ActionBarItem[];
  const align = cfg.align as string | undefined;
  const compact = cfg.compact === true;
  const justify =
    align === "right" ? "justify-end" : align === "between" ? "justify-between" : "justify-start";

  if (items.length === 0) {
    return (
      <div className="h-full flex items-center px-2.5">
        <span className="text-xs text-muted/50 italic">{t("widget.no_actions")}</span>
      </div>
    );
  }

  return (
    <ActionOverflowBar
      items={items}
      compact={compact}
      justify={justify}
      pageState={pageState}
      wrapClass="h-full"
    />
  );
}

/** Render một widget theo kind. */
function Widget({ comp, pageId }: { comp: PageComponent; pageId: string }) {
  const cfg = comp.config ?? {};
  const stateKey = `${pageId}:${comp.id}`;
  const pageState = usePageState();
  if (comp.kind === "action") {
    return <ActionWidget config={cfg as unknown as ActionConfig} pageState={pageState} />;
  }
  if (comp.kind === "actionbar") {
    return <ActionBarWidget cfg={cfg} pageState={pageState} />;
  }
  if (comp.kind === "kpi") return <KpiWidget cfg={cfg} />;
  if (comp.kind === "chart") return <ChartWidget cfg={cfg} />;
  if (comp.kind === "list") {
    const embActs = (cfg.embeddedActions ?? []) as ActionBarItem[];
    // Bảng lớn: serverPaging → phân trang/sắp/lọc server-side (hỗ trợ cả sửa ô).
    if (cfg.serverPaging === true && cfg.excelMode !== true)
      return withEmbeddedActions(
        <ServerPagedListWidget
          entityId={cfg.entity as string | undefined}
          dataSourceId={cfg.dataSourceId as string | undefined}
          stateKey={stateKey}
          fields={cfg.fields as string[] | undefined}
          columnLabels={cfg.columnLabels as Record<string, string> | undefined}
          columnGroups={cfg.columnGroups as ColumnGroupNode[] | undefined}
          selectionStateKey={cfg.selectionStateKey as string | undefined}
          title={cfg.title as string | undefined}
          multiSelect={cfg.multiSelect === true}
          editable={cfg.editable === true}
          batchEdit={cfg.batchEdit === true}
          pageSize={cfg.pageSize as number | undefined}
          loadFilters={cfg.loadFilters as LoadFilters | undefined}
          loadGate={cfg.loadGate as string | undefined}
          selectable={cfg.selectable === true}
        />,
        embActs,
        pageState,
      );
    return withEmbeddedActions(
      <ListWidget
        entityId={cfg.entity as string | undefined}
        dataSourceId={cfg.dataSourceId as string | undefined}
        stateKey={stateKey}
        fields={cfg.fields as string[] | undefined}
        columnLabels={cfg.columnLabels as Record<string, string> | undefined}
        columnGroups={cfg.columnGroups as ColumnGroupNode[] | undefined}
        defaultGrouping={cfg.defaultGrouping as string[] | undefined}
        selectionStateKey={cfg.selectionStateKey as string | undefined}
        selectionField={cfg.selectionField as string | undefined}
        selectionEmits={cfg.selectionEmits as Record<string, string> | undefined}
        filterFromState={cfg.filterFromState as { field: string; stateKey: string } | undefined}
        filterConditions={
          cfg.filterConditions as Array<{ field: string; stateKey: string }> | undefined
        }
        filters={cfg.filters as FilterNode | null | undefined}
        searchFromState={cfg.searchFromState as string | undefined}
        searchStateKey={cfg.searchStateKey as string | undefined}
        title={cfg.title as string | undefined}
        multiSelect={cfg.multiSelect === true}
        editable={cfg.editable === true}
        batchEdit={cfg.batchEdit === true}
        excelMode={cfg.excelMode === true}
        rowLimit={cfg.rowLimit as number | undefined}
        pageSize={cfg.pageSize as number | undefined}
        loadFilters={cfg.loadFilters as LoadFilters | undefined}
        loadGate={cfg.loadGate as string | undefined}
        emptyStateShowsAll={
          // Mặc định true khi filterFromState có cấu hình: combobox "tất cả" → hiện hết.
          // Explicit false = master-detail (ẩn khi chưa chọn).
          cfg.emptyStateShowsAll !== false && !!cfg.filterFromState
        }
        rowDetail={cfg.rowDetail as RowDetailCfg | undefined}
        createForm={cfg.createForm as CreateFormCfg | undefined}
        editForm={cfg.editForm as CreateFormCfg | undefined}
        rowActions={cfg.rowActions as ActionConfig[] | undefined}
        rowActionsBuiltin={cfg.rowActionsBuiltin === true}
        editFields={cfg.editFields as string[] | undefined}
        rowActionsHidden={cfg.rowActionsHidden as string[] | undefined}
        rowActionsStyle={cfg.rowActionsStyle as "inline" | "popover" | undefined}
        selectable={cfg.selectable === true}
        addRowAtEnd={cfg.addRowAtEnd === true}
        addRowPos={cfg.addRowPos === "top" ? "top" : "bottom"}
        defaultSort={cfg.defaultSort as { field: string; dir: "asc" | "desc" } | undefined}
        // Có createForm → nút embeddedActions (vd Nạp lại) render CÙNG hàng với
        // nút "Thêm mới" trong header ListWidget; khi đó strip trên để rỗng.
        embeddedActions={cfg.createForm ? embActs : undefined}
        embeddedFilters={
          cfg.createForm ? (cfg.embeddedFilters as EmbeddedFilter[] | undefined) : undefined
        }
        refetchOnSave={cfg.refetchOnSave === true}
        valueLabels={cfg.valueLabels as Record<string, Record<string, string>> | undefined}
      />,
      cfg.createForm ? [] : embActs,
      pageState,
    );
  }
  if (comp.kind === "form") {
    const embActs = (cfg.embeddedActions ?? []) as ActionBarItem[];
    return withEmbeddedActions(<FormWidget cfg={cfg} compId={comp.id} />, embActs, pageState);
  }
  if (comp.kind === "detail") {
    const embActs = (cfg.embeddedActions ?? []) as ActionBarItem[];
    return withEmbeddedActions(<DetailWidget cfg={cfg} compId={comp.id} />, embActs, pageState);
  }
  if (comp.kind === "kanban") return <KanbanWidget cfg={cfg} />;
  if (comp.kind === "step") return <StepWidget cfg={cfg} />;
  if (comp.kind === "split") return <SplitWidget comp={comp} />;
  if (comp.kind === "grid") return <GridWidget comp={comp} />;
  if (comp.kind === "search") return <SearchWidget cfg={cfg} />;
  if (comp.kind === "filter") return <FilterWidget cfg={cfg} />;
  if (comp.kind === "combobox") return <ComboboxWidget cfg={cfg} />;
  if (comp.kind === "listbox") return <ListboxWidget cfg={cfg} />;
  if (comp.kind === "tagbox") return <TagboxWidget cfg={cfg} />;
  if (comp.kind === "calendar") return <CalendarWidget cfg={cfg} />;
  if (comp.kind === "map") return <MapWidget cfg={cfg} />;
  if (comp.kind === "pivot") return <PivotWidget cfg={cfg} />;
  if (comp.kind === "document") return <DocumentWidget cfg={cfg} />;
  if (comp.kind === "html") {
    // sandbox="allow-scripts" không có allow-same-origin: frame bị coi
    // là cross-origin nên script bên trong không thể truy cập cookie/
    // localStorage/DOM của app cha — ngăn XSS exfil token.
    return (
      <iframe
        sandbox="allow-scripts"
        srcDoc={(cfg.html as string) ?? ""}
        className="w-full border-0 block"
        title="HTML widget"
        style={{ minHeight: "120px", height: "100%" }}
      />
    );
  }
  return (
    <div className="p-3 text-xs text-muted h-full flex items-center justify-center text-center">
      Widget "{comp.kind}" — chưa hỗ trợ ở chế độ người dùng.
    </div>
  );
}

const ROW_H = 76;
const GAP = 12; // gap-3

/* ── Helpers lưu/đọc bố cục cá nhân ──────────────────────────
   Logged-in  : key = erp_layout_{userId}_{pageId}
   Anonymous  : key = erp_layout_{pageId}
   ─────────────────────────────────────────────────────────── */
/** Quy tắc ẩn/hiện widget theo 1 state key (vd selKetcau). Đặt ở cfg.visibleWhen. */
function evalVisible(rule: VisibleRule, pageState: ReturnType<typeof usePageState>): boolean {
  const raw = pageState.get(rule.stateKey);
  const sv = raw == null ? "" : String(raw);
  const arr = Array.isArray(rule.value) ? rule.value.map(String) : [];
  switch (rule.op) {
    case "eq":
      return sv === String(rule.value ?? "");
    case "neq":
      return sv !== String(rule.value ?? "");
    case "in":
      return arr.includes(sv);
    case "nin":
      return !arr.includes(sv);
    case "set":
      return sv !== "";
    case "notset":
      return sv === "";
    default:
      return true;
  }
}
/** Bọc 1 widget: ẩn hẳn (không render ô) khi visibleWhen không thỏa. Chế độ sửa
 *  bố cục (editing) luôn hiện để còn sắp xếp được. */
function VisibilityGate({
  rule,
  editing,
  children,
}: {
  rule?: VisibleRule;
  editing: boolean;
  children: React.ReactNode;
}) {
  const pageState = usePageState();
  if (editing || !rule) return <>{children}</>;
  return evalVisible(rule, pageState) ? children : null;
}

export function ConsumerPage({
  pageId,
  chromeless = false,
  active = false,
}: {
  pageId: string;
  /** Portal: bỏ thanh tiêu đề trong trang; đẩy nút điều khiển bố cục lên header
   *  portal (slot #portal-page-actions) qua createPortal. */
  chromeless?: boolean;
  /** Trang đang xem (chỉ trang active mới đẩy nút lên slot — tránh chồng nút). */
  active?: boolean;
}) {
  const t = useT();
  const isMobile = useIsMobile();
  const content = useUserObjects((s) => s.pageContent[pageId]);
  const userId = useAuth((s) => s.user?.id ?? null);

  // Slot header portal cho nút điều khiển bố cục khi chromeless.
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (chromeless) setActionSlot(document.getElementById("portal-page-actions"));
  }, [chromeless]);

  // Hỗ trợ 2 định dạng content: mảng cũ (PageComponent[]) hoặc mới { meta, components }.
  type RawContent =
    | PageComponent[]
    | { meta?: Record<string, unknown>; components?: PageComponent[] };
  const rawContent = content as RawContent;
  const baseComponents: PageComponent[] = Array.isArray(rawContent)
    ? (rawContent as PageComponent[])
    : ((rawContent as { components?: PageComponent[] }).components ?? []);
  const pageMeta: Record<string, unknown> = Array.isArray(rawContent)
    ? {}
    : ((rawContent as { meta?: Record<string, unknown> }).meta ?? {});
  const screenFit = !!pageMeta.screenFit;

  /* ── Bố cục cá nhân (per-user, localStorage) ──────────── */
  const storageKey = layoutStorageKey(pageId, userId);
  const [personalLayout, setPersonalLayout] = useState<PageComponent[] | null>(null);

  // Nạp khi userId / pageId thay đổi (auth xong mới biết userId)
  useEffect(() => {
    setPersonalLayout(loadPersonalLayout<PageComponent>(storageKey));
  }, [storageKey]);

  const saveLayout = useCallback(
    (comps: PageComponent[]) => {
      savePersonalLayoutLS(storageKey, comps);
      setPersonalLayout(comps);
    },
    [storageKey],
  );
  const resetLayout = useCallback(() => {
    clearPersonalLayoutLS(storageKey);
    setPersonalLayout(null);
  }, [storageKey]);

  /* ── Layout editing state ─────────────────────────────── */
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [localComps, setLocalComps] = useState<PageComponent[]>([]);

  // Nguồn hiển thị: bố cục cá nhân → bố cục gốc
  const displayComps = layoutEditing ? localComps : (personalLayout ?? baseComponents);
  const hasPersonal = personalLayout !== null;
  // Mobile: stack 1 cột theo thứ tự đọc (trên→dưới, trái→phải).
  const renderComps = isMobile
    ? [...displayComps].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))
    : displayComps;

  /* ── Drag state ───────────────────────────────────────── */
  const [dragCompId, setDragCompId] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<{ x: number; y: number } | null>(null);

  /* ── Resize state ─────────────────────────────────────── */
  const gridRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);

  // Tự KHÍT viewport: widget cuộn được (list/chart/…) ở ĐÁY trang được giãn
  // số hàng (span) để lấp hết chiều cao còn lại của khung main → trang KHÔNG
  // cuộn ngoài, chỉ cuộn trong widget đó. Chỉ desktop + không sửa layout.
  const fillId = useMemo(() => {
    // screenFit: toàn bộ lưới co giãn theo viewport → không cần fillId riêng.
    if (isMobile || layoutEditing || screenFit) return null;
    const FILL = new Set(["list", "chart", "kanban", "pivot", "table"]);

    // Ưu tiên: widget có config.fillHeight === true (opt-in tường minh).
    const explicit = renderComps.filter((c) => c.config?.fillHeight === true && FILL.has(c.kind));
    if (explicit.length === 1) return explicit[0]?.id ?? null;
    // Nhiều widget opt-in → dùng screenFit thay vì fillId; không tự chọn 1.
    if (explicit.length > 1) return null;

    // Fallback: auto-detect widget cuộn được ở đáy (hành vi cũ).
    let bottom: PageComponent | null = null;
    let bottomEnd = -1;
    let tieCount = 0; // số widget cùng chạm hàng đáy (y+h lớn nhất)
    for (const c of renderComps) {
      const end = (c.y ?? 0) + (c.h ?? 0);
      if (end > bottomEnd) {
        bottomEnd = end;
        bottom = c;
        tieCount = 1;
      } else if (end === bottomEnd) {
        tieCount++;
      }
    }
    // Nhiều widget cùng chạm đáy (vd các cột full-height cạnh nhau: trái/giữa/phải
    // đều y=0,h=20) → KHÔNG có widget "đáy" duy nhất để giãn. Nếu vẫn giãn 1 widget
    // (gridRow "1/-1" + gridTemplateRows 1 hàng 1fr) thì các widget kia span nhiều
    // hàng tạo hàng ngầm 76px → ép hàng 1fr co về ~0 → widget fill bị ẩn. Bỏ fill,
    // để lưới render tự nhiên theo h (mọi cột cao bằng nhau, đều hiển thị).
    if (tieCount > 1) return null;
    return bottom && FILL.has(bottom.kind) ? bottom.id : null;
  }, [renderComps, isMobile, layoutEditing, screenFit]);
  const [availH, setAvailH] = useState(0);
  useEffect(() => {
    if (!fillId && !screenFit) {
      setAvailH(0);
      return;
    }
    const measure = () => {
      const top = gridRef.current?.getBoundingClientRect().top ?? 0;
      setAvailH(Math.max(0, window.innerHeight - top - 8));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fillId, screenFit]);
  // Hàng (1-based) bắt đầu của widget fill — để dựng gridTemplateRows: các hàng
  // trên cố định ROW_H, hàng widget fill = 1fr → lấp KHÍT phần dư (không làm
  // tròn theo bội số ROW_H như cách giãn span cũ → hết khoảng trống dưới list).
  const fillRowStart = useMemo(() => {
    const fc = renderComps.find((c) => c.id === fillId);
    return fc ? (fc.y ?? 0) + 1 : 0;
  }, [renderComps, fillId]);
  const resizeRef = useRef<{
    compId: string;
    dir: "e" | "s" | "se";
    startMouseX: number;
    startMouseY: number;
    startW: number;
    startH: number;
    compX: number;
  } | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);

  /* ── Auto-scroll ──────────────────────────────────────── */
  const stopAutoScroll = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  }, []);
  const startAutoScroll = useCallback(
    (speed: number) => {
      stopAutoScroll();
      const tick = () => {
        canvasRef.current?.scrollBy({ top: speed });
        scrollRafRef.current = requestAnimationFrame(tick);
      };
      scrollRafRef.current = requestAnimationFrame(tick);
    },
    [stopAutoScroll],
  );
  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  /* ── Window mouse events (resize) ─────────────────────── */
  useEffect(() => {
    if (!layoutEditing) return;
    const ROW_STRIDE = ROW_H + GAP;
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const grid = gridRef.current;
      if (!grid) return;
      const colW = (grid.offsetWidth - 11 * GAP) / 12;
      const dx = e.clientX - r.startMouseX;
      const dy = e.clientY - r.startMouseY;
      let newW = r.startW;
      let newH = r.startH;
      if (r.dir === "e" || r.dir === "se")
        newW = Math.max(1, Math.min(12 - r.compX, Math.round(r.startW + dx / colW)));
      if (r.dir === "s" || r.dir === "se")
        newH = Math.max(1, Math.round(r.startH + dy / ROW_STRIDE));
      setLocalComps((cs) => cs.map((c) => (c.id === r.compId ? { ...c, w: newW, h: newH } : c)));
    };
    const onUp = () => {
      if (!resizeRef.current) return;
      const id = resizeRef.current.compId;
      resizeRef.current = null;
      setResizingId(null);
      setLocalComps((cs) => {
        const resolved = applyInsertAndResolve(id, cs);
        saveLayout(resolved); // lưu bố cục cá nhân
        return resolved;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [layoutEditing, saveLayout]);

  /* ── Grid coordinate helper ───────────────────────────── */
  const computeDropPos = (mouseX: number, mouseY: number) => {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(11, Math.floor(((mouseX - rect.left) / rect.width) * 12)));
    const y = Math.max(0, Math.floor((mouseY - rect.top) / (ROW_H + GAP)));
    return { x, y };
  };

  /* ── Canvas drag handlers ─────────────────────────────── */
  const onCanvasDragOver = (e: React.DragEvent) => {
    if (!dragCompId) return;
    e.preventDefault();
    setDropPos(computeDropPos(e.clientX, e.clientY));
    const el = canvasRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const ZONE = 64;
      const dy = e.clientY - rect.top;
      const db = rect.bottom - e.clientY;
      if (dy < ZONE) startAutoScroll(-Math.ceil((1 - dy / ZONE) * 14));
      else if (db < ZONE) startAutoScroll(Math.ceil((1 - db / ZONE) * 14));
      else stopAutoScroll();
    }
  };
  const onCanvasDragLeave = (e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDropPos(null);
      stopAutoScroll();
    }
  };
  const onCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    stopAutoScroll();
    const raw = dropPos ?? computeDropPos(e.clientX, e.clientY);
    if (dragCompId && raw) {
      const comp = localComps.find((c) => c.id === dragCompId);
      if (comp) {
        const nx = Math.max(0, Math.min(12 - comp.w, raw.x));
        const ny = Math.max(0, raw.y);
        const updated = applyInsertAndResolve(
          dragCompId,
          localComps.map((c) => (c.id === dragCompId ? { ...c, x: nx, y: ny } : c)),
        );
        setLocalComps(updated);
        saveLayout(updated); // lưu bố cục cá nhân
      }
    }
    setDragCompId(null);
    setDropPos(null);
  };

  /* ── Enter / exit / reset ─────────────────────────────── */
  const enterEdit = () => {
    // bắt đầu từ bố cục cá nhân đang hiện (hoặc bố cục gốc)
    setLocalComps(personalLayout ?? baseComponents);
    setLayoutEditing(true);
  };
  const exitEdit = () => {
    setLayoutEditing(false);
    setDragCompId(null);
    setDropPos(null);
    stopAutoScroll();
  };
  const handleReset = () => {
    resetLayout();
    setLayoutEditing(false);
    setDragCompId(null);
    setDropPos(null);
    stopAutoScroll();
  };

  // Nút điều khiển bố cục (Mặc định / Sắp xếp / Xong) — chỉ dùng cho header portal (chromeless).
  const headerControls = (
    <>
      {/* Nút trở về mặc định — hiện khi có bố cục cá nhân */}
      {hasPersonal && !layoutEditing && !isMobile && (
        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border hover:bg-danger/10 hover:border-danger/40 hover:text-danger text-muted transition-colors"
          title="Xoá bố cục cá nhân, trở về bố cục mặc định của trang"
        >
          <I.Undo size={13} />
          Mặc định
        </button>
      )}

      {/* Nút Sắp xếp / Xong — ẩn trên mobile (kéo-thả không khả dụng) */}
      {isMobile ? null : layoutEditing ? (
        <button
          type="button"
          onClick={exitEdit}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-accent text-white hover:bg-accent/90 font-medium"
        >
          <I.Check size={13} />
          Xong
        </button>
      ) : (
        <button
          type="button"
          onClick={enterEdit}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border hover:bg-hover text-muted"
        >
          <I.Grip size={13} />
          Sắp xếp
        </button>
      )}
    </>
  );

  return (
    <PageStateProvider>
      <div ref={canvasRef} className="overflow-y-auto overflow-x-hidden h-full">
        {/* Nội dung trang full width (bỏ giới hạn max-w để tràn 100%).
            px trái/phải = 1px để thành phần sát mép; giữ py trên/dưới. */}
        <div className="py-0.5 px-px">
          {/* Chromeless (portal): CHỈ trang đang xem đẩy nút lên header portal. */}
          {chromeless &&
            active &&
            actionSlot &&
            createPortal(
              <div className="flex items-center gap-1.5">{headerControls}</div>,
              actionSlot,
            )}

          {displayComps.length === 0 ? (
            <div className="card p-12 text-center text-muted text-sm">{t("widget.empty_page")}</div>
          ) : (
            <div
              onDragOver={layoutEditing ? onCanvasDragOver : undefined}
              onDragLeave={layoutEditing ? onCanvasDragLeave : undefined}
              onDrop={layoutEditing ? onCanvasDrop : undefined}
            >
              <div
                ref={gridRef}
                className="grid gap-1"
                style={{
                  gridTemplateColumns: isMobile ? "1fr" : "repeat(12, 1fr)",
                  // screenFit → mỗi hàng 1fr (chia tỷ lệ theo h);
                  // mặc định: ROW_H px cố định (mobile = auto-fit nội dung).
                  gridAutoRows: isMobile
                    ? "auto"
                    : !layoutEditing && screenFit && availH > 0
                      ? "1fr"
                      : `${ROW_H}px`,
                  // screenFit: ghim chiều cao = availH để fr hoạt động.
                  ...(!isMobile && !layoutEditing && screenFit && availH > 0
                    ? {
                        height: availH,
                        // meta.gridTemplateRows cho phép override từng hàng (vd "48px minmax(0,1fr)")
                        ...(pageMeta.gridTemplateRows
                          ? { gridTemplateRows: pageMeta.gridTemplateRows as string }
                          : {}),
                      }
                    : // fillId: 1 widget đáy lấp hết chiều cao còn lại (hành vi cũ).
                      !isMobile && fillId && availH > 0 && fillRowStart > 0
                      ? {
                          height: availH,
                          // fillRowStart===1 → repeat(0,…) CSS không hợp lệ → chỉ
                          // phát repeat khi có hàng trên widget fill.
                          gridTemplateRows:
                            fillRowStart > 1
                              ? `repeat(${fillRowStart - 1}, auto) minmax(0, 1fr)`
                              : "minmax(0, 1fr)",
                        }
                      : {}),
                }}
              >
                {/* Ghost placeholder during drag */}
                {layoutEditing &&
                  dragCompId &&
                  dropPos &&
                  (() => {
                    const dc = localComps.find((c) => c.id === dragCompId);
                    if (!dc) return null;
                    const gx = Math.max(0, Math.min(12 - dc.w, dropPos.x));
                    const gy = Math.max(0, dropPos.y);
                    return (
                      <div
                        className="pointer-events-none rounded-md border-2 border-dashed border-accent bg-accent/10 z-10"
                        style={{
                          gridColumn: `${gx + 1} / span ${dc.w}`,
                          gridRow: `${gy + 1} / span ${dc.h}`,
                        }}
                      />
                    );
                  })()}

                {renderComps.map((c) => {
                  const colStart = (c.x ?? 0) + 1;
                  const rowStart = (c.y ?? 0) + 1;
                  const w = Math.min(c.w || 3, 12);
                  // Widget fill (đáy, cuộn được): giãn span để lấp hết viewport.
                  let h = c.h || 2;
                  if (c.id === fillId && availH > 0) {
                    const GAP = 4; // gap-1 giữa các hàng
                    const availForFill = availH - (rowStart - 1) * (ROW_H + GAP);
                    h = Math.max(2, Math.floor((availForFill + GAP) / (ROW_H + GAP)));
                  }
                  const isBeingDragged = dragCompId === c.id;
                  const isBeingResized = resizingId === c.id;
                  return (
                    <VisibilityGate
                      key={c.id}
                      rule={(c.config as { visibleWhen?: VisibleRule } | undefined)?.visibleWhen}
                      editing={layoutEditing}
                    >
                      <div
                        draggable={layoutEditing && !isBeingResized && !isMobile}
                        className={cn(
                          "card overflow-hidden",
                          layoutEditing && !isMobile && "relative group/card",
                          layoutEditing &&
                            !isBeingResized &&
                            !isMobile &&
                            "cursor-grab active:cursor-grabbing",
                          isBeingDragged && "opacity-40",
                          isBeingResized && "select-none",
                        )}
                        style={
                          isMobile
                            ? { minHeight: h * ROW_H }
                            : {
                                gridColumn: `${colStart} / span ${w}`,
                                // Widget fill: span tới HÀNG CUỐI (1fr) để lấp khít;
                                // còn lại span theo số hàng h.
                                gridRow:
                                  c.id === fillId && availH > 0
                                    ? `${rowStart} / -1`
                                    : `${rowStart} / span ${h}`,
                              }
                        }
                        onDragStart={
                          layoutEditing
                            ? (e) => {
                                if (isBeingResized) {
                                  e.preventDefault();
                                  return;
                                }
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", c.id);
                                setDragCompId(c.id);
                                setDropPos(null);
                              }
                            : undefined
                        }
                        onDragEnd={
                          layoutEditing
                            ? () => {
                                setDragCompId(null);
                                setDropPos(null);
                                stopAutoScroll();
                              }
                            : undefined
                        }
                      >
                        {isMobile || !isScalableKind(c.kind) ? (
                          // Danh sách/tương tác: giữ nguyên + tự cuộn; mobile: layout dọc.
                          <Widget comp={c} pageId={pageId} />
                        ) : (
                          <ScaleToFit>
                            <Widget comp={c} pageId={pageId} />
                          </ScaleToFit>
                        )}

                        {/* Resize handles — chỉ hiện khi layoutEditing */}
                        {layoutEditing && (
                          <>
                            <div
                              className="absolute right-0 top-0 bottom-2.5 w-1.5 cursor-ew-resize z-20 opacity-0 group-hover/card:opacity-100 hover:bg-accent/40 transition-colors"
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                resizeRef.current = {
                                  compId: c.id,
                                  dir: "e",
                                  startMouseX: e.clientX,
                                  startMouseY: e.clientY,
                                  startW: c.w,
                                  startH: c.h,
                                  compX: c.x,
                                };
                                setResizingId(c.id);
                              }}
                            />
                            <div
                              className="absolute left-0 right-2.5 bottom-0 h-1.5 cursor-ns-resize z-20 opacity-0 group-hover/card:opacity-100 hover:bg-accent/40 transition-colors"
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                resizeRef.current = {
                                  compId: c.id,
                                  dir: "s",
                                  startMouseX: e.clientX,
                                  startMouseY: e.clientY,
                                  startW: c.w,
                                  startH: c.h,
                                  compX: c.x,
                                };
                                setResizingId(c.id);
                              }}
                            />
                            <div
                              className="absolute right-0 bottom-0 w-2.5 h-2.5 cursor-nwse-resize z-30 opacity-0 group-hover/card:opacity-100 hover:bg-accent/40 transition-colors flex items-center justify-center"
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                resizeRef.current = {
                                  compId: c.id,
                                  dir: "se",
                                  startMouseX: e.clientX,
                                  startMouseY: e.clientY,
                                  startW: c.w,
                                  startH: c.h,
                                  compX: c.x,
                                };
                                setResizingId(c.id);
                              }}
                            >
                              <svg
                                width="7"
                                height="7"
                                viewBox="0 0 7 7"
                                className="text-accent/70"
                                aria-hidden="true"
                              >
                                <path
                                  d="M1 6 L6 1 M3.5 6 L6 3.5"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </div>
                          </>
                        )}
                      </div>
                    </VisibilityGate>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </PageStateProvider>
  );
}
