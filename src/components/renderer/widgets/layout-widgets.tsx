/* Widget bố cục + thanh hành động cho renderer: useSplitRatios/useGridDrag/
   buildSubCfg + RenderSubWidget + GridWidget + SplitWidget (lưới N×M, split panel,
   drag resize) và ActionOverflowBar/EmbeddedActionStrip/withEmbeddedActions/
   ActionBarWidget. Tách từ ConsumerPage.tsx (Phase A7) — chỉ di chuyển code,
   KHÔNG đổi hành vi. Export: GridWidget, SplitWidget, ActionBarWidget,
   withEmbeddedActions (Widget dispatcher dùng). */
import {
  Fragment,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { I } from "@/components/Icons";
import { ActionWidget } from "@/components/renderer/ActionWidget";
import type { ColumnGroupNode } from "@/components/renderer/DataGrid";
import type { CreateFormCfg } from "@/components/renderer/MasterDetailCreateModal";
import { usePageState } from "@/components/renderer/page-data";
import type {
  ActionBarItem,
  LoadFilters,
  PageComponent,
  RowDetailCfg,
  SplitGridCell,
  SplitPanelCfg,
  VisibleRule,
} from "@/components/renderer/page-types";
import { DetailWidget, FormWidget } from "@/components/renderer/widgets/FormDetailWidget";
import { ListWidget, ServerPagedListWidget } from "@/components/renderer/widgets/list-widgets";
import { ChartWidget, KanbanWidget } from "@/components/renderer/widgets/viz-widgets";
import { useT } from "@/hooks/useT";
import type { PageStateLike } from "@/lib/run-action";
import { cn } from "@/lib/utils";
import type { ActionConfig } from "@/types/page";

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
  // panelKey phát ra dạng thường ("a".."d"); đọc CŨNG phải thường để khớp
  // (trước đây toUpperCase → ghi ":a:" đọc ":A:" → master-detail không bao giờ khớp).
  const srcStateKey = panelKey
    ? `${splitKey}:${(panel.filterFromPanel ?? "a").toLowerCase()}`
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
    editableFromState: (panel as Record<string, unknown>).editableFromState,
    visibleWhen: (panel as Record<string, unknown>).visibleWhen,
    batchEdit: panel.batchEdit,
    excelMode: panel.excelMode,
    multiSelect: panel.multiSelect,
    loadGate: panel.loadGate,
    loadFilters: panel.loadFilters,
    rowLimit: panel.rowLimit,
    pageSize: panel.pageSize,
    defaultSort: panel.defaultSort,
    fieldOverrides: (panel as Record<string, unknown>).fieldOverrides,
    fieldLookups: (panel as Record<string, unknown>).fieldLookups,
    linkedToState: (panel as Record<string, unknown>).linkedToState,
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
    ...(kind === "chart" ? { kind: panel.chartKind ?? "bar" } : {}),
    ...(kind === "list"
      ? {
          selectionStateKey: (panel as Record<string, any>).selectionStateKey ?? ownStateKey,
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
    ...(kind === "detail"
      ? { recordIdFromState: (panel as Record<string, any>).recordIdFromState ?? srcStateKey }
      : {}),
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
            const fp = (c.fromPanel ?? panel.filterFromPanel ?? "a").toLowerCase();
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

function isVisibleByRule(rule: VisibleRule | undefined, value: unknown): boolean {
  if (!rule) return true;
  const sv = value == null ? "" : String(value);
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
  const visibleWhen = cfg.visibleWhen as VisibleRule | undefined;
  if (
    !isVisibleByRule(visibleWhen, visibleWhen ? pageState.get(visibleWhen.stateKey) : undefined)
  ) {
    return null;
  }
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
        editableFields={cfg.editableFields as string[] | undefined}
        highlightEmptyFields={cfg.highlightEmptyFields as string[] | undefined}
        computedColumns={
          cfg.computedColumns as Array<{ field: string; product: string[] }> | undefined
        }
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
        embeddedActions={embeddedActions.length > 0 ? embeddedActions : undefined}
        embeddedFilters={cfg.embeddedFilters as any}
      />,
      [],
      pageState,
    );
  }
  if (kind === "detail")
    return withEmbeddedActions(
      // compId = stateKey (comp.id:cell.id) để DetailWidget mirror field bản ghi ra
      // pageState (`detail:<compId>:<field>`); widget khác cùng trang lọc theo đó.
      <DetailWidget cfg={cfg} compId={stateKey} />,
      embeddedActions,
      pageState,
    );
  if (kind === "form")
    return withEmbeddedActions(
      <FormWidget cfg={cfg} compId={stateKey} />,
      embeddedActions,
      pageState,
    );
  if (kind === "chart") return <ChartWidget cfg={cfg} />;
  if (kind === "kanban") return <KanbanWidget cfg={cfg} />;
  return null;
}

/** Grid Layout N×M — kind="grid", config.cells[]; có drag handle giữa cột/hàng */
export function GridWidget({ comp }: { comp: PageComponent }) {
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

export function SplitWidget({ comp }: { comp: PageComponent }) {
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: cfg=comp.config ổn định (load 1 lần từ server); splitKey từ comp.id
  const cfgA = useMemo(
    () => buildSubCfg({ ...panelA, kind: kindA, linkField: undefined }, splitKey, "a"),
    [cfg, splitKey],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: cfg=comp.config ổn định; splitKey từ comp.id
  const cfgB = useMemo(
    () => buildSubCfg({ ...panelB, kind: kindB }, splitKey, "b"),
    [cfg, splitKey],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: cfg=comp.config ổn định; splitKey từ comp.id
  const cfgC = useMemo(
    () => buildSubCfg({ ...panelC, kind: kindC }, splitKey, "c"),
    [cfg, splitKey],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: cfg=comp.config ổn định; splitKey từ comp.id
  const cfgD = useMemo(
    () => buildSubCfg({ ...panelD, kind: kindD }, splitKey, "d"),
    [cfg, splitKey],
  );

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
          {/* Chỉ mount tab ACTIVE — tránh fetch dữ liệu thừa cho tab ẩn */}
          {tabDefs.map((p) =>
            activeTab === p.key ? (
              <div key={p.key} className="h-full overflow-hidden">
                <RenderSubWidget
                  kind={p.kind}
                  cfg={p.cfg}
                  stateKey={`${comp.id}:${p.key.toLowerCase()}`}
                />
              </div>
            ) : null,
          )}
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
  pageState: PageStateLike;
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
  pageState: PageStateLike;
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
export function withEmbeddedActions(
  content: ReactElement,
  items: ActionBarItem[],
  pageState: PageStateLike,
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
export function ActionBarWidget({
  cfg,
  pageState,
}: {
  cfg: Record<string, unknown>;
  pageState: PageStateLike;
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
