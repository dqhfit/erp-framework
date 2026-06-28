/* ==========================================================
   ConsumerPage — render trang ĐÃ THIẾT KẾ ở chế độ người dùng.
   Đọc danh sách widget từ pageContent (do PageDesigner lưu) và
   render trên lưới 12 cột. Widget list/chart/kanban truy vấn
   RECORD THẬT của entity bound (qua ApiDataSource); widget form
   ghi record thật vào backend. KHÔNG còn dữ liệu giả.
   ========================================================== */

import { createProceduresClient } from "@erp-framework/client";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BanVeTypePage } from "@/components/ban-ve/BanVeTypePage";
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
import {
  PageStateProvider,
  usePageDispatch,
  usePageStateKey,
} from "@/components/renderer/page-data";
import type {
  ActionBarItem,
  DerivedColumn,
  EmbeddedFilter,
  LoadFilters,
  PageComponent,
  RowDetailCfg,
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
import {
  ActionBarWidget,
  GridWidget,
  SplitWidget,
  withEmbeddedActions,
} from "@/components/renderer/widgets/layout-widgets";
import { ListWidget, ServerPagedListWidget } from "@/components/renderer/widgets/list-widgets";
import { ReportWidget } from "@/components/renderer/widgets/report-widget";
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

// BangMauTypePage lazy-load — trang đặc biệt (2 pageId cố định), không kéo bundle vào main chunk
const BangMauTypePage = lazy(() =>
  import("@/components/bang-mau/BangMauTypePage").then((m) => ({ default: m.BangMauTypePage })),
);

/** Lọc danh sách nút hành động theo quyền nhóm/tài khoản.
 *  Admin/editor luôn thấy tất cả. Hai lớp độc lập:
 *  1) DENYLIST (mặc-định-thấy): hiddenForGroups/hiddenForUsers ẩn-riêng nút
 *     với nhóm/tài khoản cụ thể; deny THẮNG allow → kiểm tra TRƯỚC.
 *  2) ALLOWLIST (designer): visibleToGroups/visibleToUsers giới hạn chỉ nhóm/
 *     tài khoản được phép; rỗng/vắng = mọi người thấy. */
function filterActions(
  actions: ActionBarItem[],
  role: string | undefined,
  userId: string | undefined,
  groupIds: string[],
): ActionBarItem[] {
  if (role === "admin" || role === "editor") return actions;
  return actions.filter((a) => {
    // Lớp 1 — DENY ẩn-riêng (thắng allow): user/nhóm bị ẩn thì mất nút ngay.
    if (userId && a.hiddenForUsers?.includes(userId)) return false;
    if (a.hiddenForGroups?.some((g) => groupIds.includes(g))) return false;
    // Lớp 2 — ALLOWLIST designer (giữ nguyên hành vi cũ).
    const hasGroupRestriction = a.visibleToGroups && a.visibleToGroups.length > 0;
    const hasUserRestriction = a.visibleToUsers && a.visibleToUsers.length > 0;
    if (!hasGroupRestriction && !hasUserRestriction) return true;
    if (userId && a.visibleToUsers?.includes(userId)) return true;
    if (hasGroupRestriction && groupIds.some((g) => a.visibleToGroups?.includes(g))) return true;
    return false;
  });
}

/** Hook trả về hàm filter đã bind sẵn thông tin user hiện tại. */
function useActionFilter() {
  const user = useAuth((s) => s.user);
  const myGroupIds = useUserObjects((s) => s.myGroupIds);
  return (actions: ActionBarItem[]) => filterActions(actions, user?.role, user?.id, myGroupIds);
}

const procClient = createProceduresClient("");

/** Xoá dữ liệu tạm khi RỜI trang (đổi tab / đóng tab / điều hướng đi).
 *  Trang trong portal vẫn MOUNTED khi đổi tab → bắt theo `active` true→false
 *  (cleanup của effect active=true) lẫn unmount thật. Sau khi xoá, báo list
 *  re-query (trang còn mounted) để hiện rỗng khi quay lại. Đặt trong
 *  PageStateProvider để dùng được usePageState. */
function PageLeaveHandler({
  active,
  proc,
  refreshEntities,
}: {
  active: boolean;
  proc: string;
  refreshEntities: string[];
}) {
  // dispatch stable (không subscribe) → không gây re-render khi state thay đổi
  const dispatch = usePageDispatch();
  // ref để cleanup effect đọc giá trị mới nhất của refreshEntities mà không cần trong deps
  const refRef = useRef(refreshEntities);
  refRef.current = refreshEntities;
  useEffect(() => {
    if (!active) return;
    return () => {
      procClient.invokeModule(proc, {}).catch(() => {});
      const stamp = Date.now();
      for (const eid of refRef.current) dispatch.set(`__refresh:${eid}`, stamp);
    };
  }, [active, proc, dispatch]);
  return null;
}

/** Render một widget theo kind.
 *  - Dùng usePageDispatch() (stable, không subscribe) thay vì usePageState():
 *    Widget không cần đọc state reactive; chỉ truyền ctx xuống ActionWidget/
 *    ActionBarWidget để chúng ghi state trong event handler.
 *  - React.memo: tránh re-render khi ConsumerPage re-render vì lý do khác.
 *    Widget chỉ re-render khi comp/pageId đổi hoặc hook con (useActionFilter) fire. */
const Widget = memo(function Widget({ comp, pageId }: { comp: PageComponent; pageId: string }) {
  const cfg = comp.config ?? {};
  const stateKey = `${pageId}:${comp.id}`;
  const pageState = usePageDispatch();
  const filterActs = useActionFilter();
  if (comp.kind === "action") {
    return <ActionWidget config={cfg as unknown as ActionConfig} pageState={pageState} />;
  }
  if (comp.kind === "actionbar") {
    const filteredItems = filterActs((cfg.items ?? []) as ActionBarItem[]);
    return <ActionBarWidget cfg={{ ...cfg, items: filteredItems }} pageState={pageState} />;
  }
  if (comp.kind === "kpi") return <KpiWidget cfg={cfg} />;
  if (comp.kind === "chart") return <ChartWidget cfg={cfg} />;
  if (comp.kind === "list") {
    const embActs = filterActs((cfg.embeddedActions ?? []) as ActionBarItem[]);
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
        editableFields={cfg.editableFields as string[] | undefined}
        highlightEmptyFields={cfg.highlightEmptyFields as string[] | undefined}
        computedColumns={
          cfg.computedColumns as Array<{ field: string; product: string[] }> | undefined
        }
        derivedColumns={cfg.derivedColumns as DerivedColumn[] | undefined}
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
        // embeddedActions luôn đi vào toolbar của ListWidget (cùng hàng filter).
        // withEmbeddedActions bên dưới nhận [] để không tạo strip tách riêng.
        embeddedActions={embActs.length > 0 ? embActs : undefined}
        embeddedFilters={cfg.embeddedFilters as EmbeddedFilter[] | undefined}
        refetchOnSave={cfg.refetchOnSave === true}
        valueLabels={cfg.valueLabels as Record<string, Record<string, string>> | undefined}
      />,
      [], // embActs đã chuyển vào ListWidget toolbar — không dùng strip ngoài nữa
      pageState,
    );
  }
  if (comp.kind === "form") {
    const embActs = filterActs((cfg.embeddedActions ?? []) as ActionBarItem[]);
    return withEmbeddedActions(<FormWidget cfg={cfg} compId={comp.id} />, embActs, pageState);
  }
  if (comp.kind === "detail") {
    const embActs = filterActs((cfg.embeddedActions ?? []) as ActionBarItem[]);
    return withEmbeddedActions(<DetailWidget cfg={cfg} compId={comp.id} />, embActs, pageState);
  }
  if (comp.kind === "kanban") return <KanbanWidget cfg={cfg} />;
  if (comp.kind === "step") return <StepWidget cfg={cfg} />;
  if (comp.kind === "split") {
    if (
      pageId === "20d6b1e3-a164-4338-867c-d7992972de52" ||
      pageId === "a71707c3-c690-4212-aeb8-615695b87b2d"
    ) {
      return (
        <Suspense fallback={<div className="p-3 text-xs text-muted">Đang tải...</div>}>
          <BangMauTypePage comp={comp} />
        </Suspense>
      );
    }
    return <SplitWidget comp={comp} />;
  }
  if (comp.kind === "grid") return <GridWidget comp={comp} />;
  if (comp.kind === "search") return <SearchWidget cfg={cfg} />;
  if (comp.kind === "filter") return <FilterWidget cfg={cfg} />;
  if (comp.kind === "combobox") return <ComboboxWidget cfg={cfg} />;
  if (comp.kind === "listbox") return <ListboxWidget cfg={cfg} />;
  if (comp.kind === "tagbox") return <TagboxWidget cfg={cfg} />;
  if (comp.kind === "calendar") return <CalendarWidget cfg={cfg} />;
  if (comp.kind === "map") return <MapWidget cfg={cfg} />;
  if (comp.kind === "pivot") return <PivotWidget cfg={cfg} />;
  if (comp.kind === "report") return <ReportWidget cfg={cfg} />;
  if (comp.kind === "document") return <DocumentWidget cfg={cfg} />;
  if (comp.kind === "banve-type") {
    const rawActs = (cfg.embeddedActions ?? []) as ActionBarItem[];
    const embActs = filterActs(rawActs);
    return (
      <BanVeTypePage
        phanloai={(cfg.phanloai as string) ?? "Bản vẽ kỹ thuật"}
        actions={embActs}
        allActions={rawActs}
      />
    );
  }

  if (comp.kind === "html") {
    const embActs = filterActs((cfg.embeddedActions ?? []) as ActionBarItem[]);
    // sandbox="allow-scripts" không có allow-same-origin: frame bị coi
    // là cross-origin nên script bên trong không thể truy cập cookie/
    // localStorage/DOM của app cha — ngăn XSS exfil token.
    return withEmbeddedActions(
      <iframe
        sandbox="allow-scripts"
        srcDoc={(cfg.html as string) ?? ""}
        className="w-full border-0 block"
        title="HTML widget"
        style={{ minHeight: "120px", height: "100%" }}
      />,
      embActs,
      pageState,
    );
  }
  return (
    <div className="p-3 text-xs text-muted h-full flex items-center justify-center text-center">
      Widget "{comp.kind}" — chưa hỗ trợ ở chế độ người dùng.
    </div>
  );
});

const ROW_H = 76;
const GAP = 12; // gap-3

/* ── Helpers lưu/đọc bố cục cá nhân ──────────────────────────
   Logged-in  : key = erp_layout_{userId}_{pageId}
   Anonymous  : key = erp_layout_{pageId}
   ─────────────────────────────────────────────────────────── */
/** Bọc 1 widget: ẩn hẳn (không render ô) khi visibleWhen không thỏa. Chế độ sửa
 *  bố cục (editing) luôn hiện để còn sắp xếp được.
 *  Dùng usePageStateKey(rule.stateKey) thay vì usePageState() — chỉ re-render
 *  khi ĐÚNG KEY đó thay đổi, không phải mọi state change. */
function VisibilityGate({
  rule,
  editing,
  children,
}: {
  rule?: VisibleRule;
  editing: boolean;
  children: React.ReactNode;
}) {
  // Hook PHẢI gọi vô điều kiện trước early-return (React rules).
  // key "" khi rule undefined → subscribe key rỗng = no-op harmless.
  const raw = usePageStateKey(rule?.stateKey ?? "");
  if (editing || !rule) return children;
  const sv = raw == null ? "" : String(raw);
  const arr = Array.isArray(rule.value) ? rule.value.map(String) : [];
  let visible: boolean;
  switch (rule.op) {
    case "eq":
      visible = sv === String(rule.value ?? "");
      break;
    case "neq":
      visible = sv !== String(rule.value ?? "");
      break;
    case "in":
      visible = arr.includes(sv);
      break;
    case "nin":
      visible = !arr.includes(sv);
      break;
    case "set":
      visible = sv !== "";
      break;
    case "notset":
      visible = sv === "";
      break;
    default:
      visible = true;
  }
  return visible ? children : null;
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
    : ((rawContent as { components?: PageComponent[] } | undefined)?.components ?? []);
  const pageMeta: Record<string, unknown> = Array.isArray(rawContent)
    ? {}
    : ((rawContent as { meta?: Record<string, unknown> } | undefined)?.meta ?? {});
  const screenFit = !!pageMeta?.screenFit;
  // Trang scratch (vd "Tạo y/c mua hàng"): xoá working set khi rời trang để
  // danh sách không nhớ dữ liệu giữa các lần ghé. meta.onLeaveProc = tên proc
  // xoá; meta.onLeaveRefresh = entityId cần re-query để hiện rỗng khi quay lại.
  const onLeaveProc = typeof pageMeta.onLeaveProc === "string" ? pageMeta.onLeaveProc : null;
  const onLeaveRefresh = Array.isArray(pageMeta.onLeaveRefresh)
    ? (pageMeta.onLeaveRefresh as string[])
    : [];

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
  // Hàng CHỈ chứa widget "cao bằng nội dung" (bộ lọc) → để `auto` thay vì kéo giãn
  // theo 1fr (screenFit) / ROW_H (thường) → hết khoảng trống dưới thanh bộ lọc.
  // Hàng còn lại giữ 1fr/ROW_H để list/chart vẫn lấp viewport. Chỉ áp khi XEM.
  const autoRowTemplate = useMemo(() => {
    if (isMobile || layoutEditing) return null;
    const maxRow = renderComps.reduce((m, c) => Math.max(m, (c.y ?? 0) + (c.h ?? 1)), 0);
    if (!maxRow) return null;
    const flexUnit = screenFit && availH > 0 ? "minmax(0, 1fr)" : `${ROW_H}px`;
    const tokens: string[] = [];
    let hasAuto = false;
    for (let r = 0; r < maxRow; r++) {
      const occ = renderComps.filter((c) => (c.y ?? 0) <= r && r < (c.y ?? 0) + (c.h ?? 1));
      const isAuto =
        occ.length > 0 && occ.every((c) => c.kind === "filter" || c.kind === "actionbar");
      if (isAuto) hasAuto = true;
      tokens.push(isAuto ? "auto" : flexUnit);
    }
    return hasAuto ? tokens.join(" ") : null;
  }, [renderComps, isMobile, layoutEditing, screenFit, availH]);
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
      {onLeaveProc && (
        <PageLeaveHandler active={active} proc={onLeaveProc} refreshEntities={onLeaveRefresh} />
      )}
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
                        // meta.gridTemplateRows override > tự tính (hàng bộ lọc = auto)
                        // > mặc định gridAutoRows 1fr.
                        gridTemplateRows:
                          (pageMeta.gridTemplateRows as string | undefined) ??
                          autoRowTemplate ??
                          undefined,
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
                      : // Thường (không screenFit/fill): hàng bộ lọc = auto để hết
                        // khoảng trống; hàng khác giữ ROW_H.
                        !isMobile && autoRowTemplate
                        ? { gridTemplateRows: autoRowTemplate }
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
                          // Bộ lọc khi XEM: cao bằng nội dung (không kéo giãn full ô
                          // ROW_H / 1fr) → thanh lọc gọn. Khi sửa giữ giãn để resize.
                          (c.kind === "filter" || c.kind === "actionbar") &&
                            !layoutEditing &&
                            "self-start",
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
                            ? c.kind === "filter" || c.kind === "actionbar"
                              ? undefined
                              : { minHeight: h * ROW_H }
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
