import { useEffect, useMemo, useRef, useState } from "react";
import { ActionInspector } from "@/components/designer/ActionInspector";
import { AiAssistDrawer } from "@/components/designer/AiAssistDrawer";
import { BandEditor } from "@/components/designer/inspectors/BandEditor";
import { FilterBuilder } from "@/components/designer/inspectors/FilterBuilder";
import { MasterFieldBinder } from "@/components/designer/inspectors/MasterFieldBinder";
import { MobileDesignerNotice } from "@/components/designer/MobileDesignerNotice";
import { FieldDisplayToggle, fieldBoth, useFieldDisplay } from "@/components/FieldDisplayToggle";
import { I } from "@/components/Icons";
import { ConsumerPage } from "@/components/renderer/ConsumerPage";
import type { ColumnGroupNode } from "@/components/renderer/DataGrid";
import { ROW_ACTION_OPTIONS } from "@/components/renderer/RowActionsCell";
import { isScalableKind, ScaleToFit } from "@/components/ScaleToFit";
import {
  Button,
  Chip,
  EmptyState,
  FormField,
  Input,
  Select,
  Switch,
  Textarea,
} from "@/components/ui";
import { useMcpClient } from "@/hooks/useMcpClient";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useShortcut } from "@/hooks/useShortcut";
import { useT } from "@/hooks/useT";
import { useUndoable } from "@/hooks/useUndoable";
import type { PageDesign } from "@/lib/ai-design-prompts";
import type { IconName } from "@/lib/object-types";
import { applyInsertAndResolve } from "@/lib/page-layout";
import { collectStateSources, type StateSource } from "@/lib/page-state-sources";
import { cn } from "@/lib/utils";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionConfig, ActionVariant, FilterNode } from "@/types/page";

type ComponentKind =
  | "list"
  | "detail"
  | "form"
  | "chart"
  | "kpi"
  | "kanban"
  | "split"
  | "search"
  | "combobox"
  | "listbox"
  | "tagbox"
  // "filter": bộ lọc cascade (do migration sinh) — bind datasource, phát state
  // cho widget khác (loadGate). Không nằm trong palette nhưng sửa được ở inspector.
  | "filter"
  | "calendar"
  | "map"
  | "pivot"
  | "html"
  | "action"
  | "actionbar"
  | "step";

type ActionBarItem = { id: string } & ActionConfig;

interface PageComponent {
  id: string;
  kind: ComponentKind;
  x: number;
  y: number;
  w: number;
  h: number; // grid units
  config: Record<string, unknown>;
}

const PALETTE: Array<{
  kind: ComponentKind;
  label: string;
  icon: IconName;
  defaultSize: { w: number; h: number };
}> = [
  { kind: "list", label: "List / Table", icon: "Table", defaultSize: { w: 12, h: 4 } },
  { kind: "detail", label: "Detail", icon: "PanelRight", defaultSize: { w: 6, h: 5 } },
  { kind: "form", label: "Form", icon: "Edit", defaultSize: { w: 6, h: 5 } },
  { kind: "chart", label: "Chart", icon: "BarChart", defaultSize: { w: 6, h: 3 } },
  { kind: "kpi", label: "KPI", icon: "TrendUp", defaultSize: { w: 3, h: 2 } },
  { kind: "kanban", label: "Kanban", icon: "Kanban", defaultSize: { w: 12, h: 4 } },
  { kind: "split", label: "Split Panel", icon: "Columns2", defaultSize: { w: 12, h: 5 } },
  { kind: "search", label: "Search", icon: "Search", defaultSize: { w: 4, h: 2 } },
  { kind: "combobox", label: "Combobox", icon: "ChevronDown", defaultSize: { w: 3, h: 2 } },
  { kind: "listbox", label: "Listbox", icon: "List", defaultSize: { w: 3, h: 4 } },
  { kind: "tagbox", label: "Tagbox", icon: "Tag", defaultSize: { w: 4, h: 2 } },
  { kind: "html", label: "HTML / Note", icon: "Type", defaultSize: { w: 6, h: 2 } },
  { kind: "action", label: "Action", icon: "Play", defaultSize: { w: 3, h: 1 } },
  { kind: "actionbar", label: "Thanh hành động", icon: "Toolbar", defaultSize: { w: 12, h: 1 } },
  { kind: "step", label: "Wizard / Theo bước", icon: "Workflow", defaultSize: { w: 12, h: 6 } },
];

interface Props {
  pageId: string;
}

/* ── Cấu hình tải dữ liệu (số dòng + điều kiện + cổng) ─────────────────────
   Dùng chung cho mọi widget đọc record-list. Ghi vào config keys: rowLimit
   (trần tải server-side), pageSize (số dòng/trang khi render), loadFilters
   (map field→{op,value}), loadGate (stateKey). Renderer đọc các key này qua
   useDataOpts + DataGrid (ConsumerPage). */
const RECORD_DATA_KINDS = new Set([
  "list",
  "chart",
  "kanban",
  "calendar",
  "map",
  "pivot",
  "kpi",
  "combobox",
  "listbox",
  "tagbox",
]);
const LOAD_OPS = ["=", "!=", ">", ">=", "<", "<=", "contains", "in"] as const;
type LoadCond = { op: string; value: unknown };

/* Widget hỗ trợ chọn nguồn = entity HOẶC datasource (gồm cả detail/form). */
const BINDING_KINDS = new Set([...RECORD_DATA_KINDS, "detail", "form"]);

/* Widget NHẬP (search/combobox/listbox/tagbox) — gắn nguồn + state ở tab
   "Nguồn & Điều khiển". Dùng để nhắc discoverability (badge canvas + nút
   chuyển tab trong inspector). */
const INPUT_WIDGET_KINDS = new Set(["search", "combobox", "listbox", "tagbox"]);

/* Bộ chọn nguồn dữ liệu: Entity ↔ Nguồn dữ liệu (datasource). Ghi cfg.entity
   hoặc cfg.dataSourceId. dataSourceId === undefined = mode entity; định nghĩa
   (kể cả "") = mode datasource. */
function BindingSourceConfig({
  cfg,
  dataSources,
  onChange,
}: {
  cfg: Record<string, unknown>;
  dataSources: Array<{ id: string; name: string }>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const dsId = cfg.dataSourceId as string | undefined;
  const isDs = dsId !== undefined;
  // Nhớ datasource đã chọn để KHÔI PHỤC khi bấm qua lại 2 tab. Chuyển tab CHỈ đổi
  // chế độ hiển thị, KHÔNG đụng cấu hình (giữ entity + fields). Chỉ khi CHỌN LẠI
  // nguồn dữ liệu (Select) hoặc chọn entity (khối riêng) mới thay đổi thật.
  // Component được key theo widget id (call site) nên state này riêng từng widget.
  const [lastDsId, setLastDsId] = useState(isDs && dsId ? dsId : "");
  const btn = (active: boolean) =>
    cn(
      "flex-1 rounded border px-2 py-1 text-xs",
      active ? "border-accent bg-accent/10 text-accent" : "border-border text-muted",
    );
  return (
    <div className="rounded-md border border-border p-2 space-y-2 bg-bg-soft/40">
      <div className="text-xs font-semibold text-muted">Nguồn bind</div>
      <div className="flex gap-1">
        <button
          type="button"
          className={btn(!isDs)}
          // Sang Entity: CHỈ đổi mode. Nhớ DS để khôi phục, GIỮ entity + fields.
          onClick={() => {
            if (!isDs) return;
            if (dsId) setLastDsId(dsId);
            onChange({ dataSourceId: undefined });
          }}
        >
          Entity
        </button>
        <button
          type="button"
          className={btn(isDs)}
          // Sang Nguồn dữ liệu: khôi phục DS đã nhớ (hoặc trống). GIỮ entity + fields.
          onClick={() => {
            if (isDs) return;
            onChange({ dataSourceId: lastDsId });
          }}
        >
          Nguồn dữ liệu
        </button>
      </div>
      {isDs && (
        <Select
          value={dsId ?? ""}
          // Chọn nguồn KHÁC = thay đổi THẬT → reset fields (schema khác). Chọn lại
          // đúng nguồn hiện tại = no-op (giữ nguyên cấu hình cột).
          onChange={(e) => {
            if (e.target.value === dsId) return;
            setLastDsId(e.target.value);
            onChange({ dataSourceId: e.target.value, fields: null });
          }}
        >
          <option value="">— chọn nguồn dữ liệu —</option>
          {dataSources.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

function DataLoadConfig({
  cfg,
  fields,
  onChange,
}: {
  cfg: Record<string, unknown>;
  fields: Array<{ name: string; label?: string }>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { fieldDisp } = useFieldDisplay();
  const rowLimit = typeof cfg.rowLimit === "number" ? cfg.rowLimit : undefined;
  const pageSize = typeof cfg.pageSize === "number" ? cfg.pageSize : undefined;
  const gate = (cfg.loadGate as string) ?? "";
  const lf = (cfg.loadFilters as Record<string, LoadCond>) ?? {};
  const entries = Object.entries(lf);

  const writeFilters = (next: Record<string, LoadCond>) =>
    onChange({ loadFilters: Object.keys(next).length ? next : undefined });

  const setCond = (field: string, op: string, value: string) => {
    if (!field) return;
    writeFilters({ ...lf, [field]: { op, value } });
  };
  const renameField = (oldField: string, newField: string) => {
    if (!newField || newField === oldField || lf[newField]) return;
    const next: Record<string, LoadCond> = {};
    for (const [k, v] of Object.entries(lf)) next[k === oldField ? newField : k] = v;
    writeFilters(next);
  };
  const removeCond = (field: string) => {
    const next = { ...lf };
    delete next[field];
    writeFilters(next);
  };
  const addCond = () => {
    const avail = fields.find((f) => !lf[f.name]);
    if (!avail) return;
    writeFilters({ ...lf, [avail.name]: { op: "=", value: "" } });
  };

  const fieldLabel = (name: string) => {
    const f = fields.find((x) => x.name === name);
    return f ? fieldDisp(f) : name;
  };

  return (
    <div className="rounded-md border border-border p-2 space-y-2 bg-bg-soft/40">
      <div className="text-xs font-semibold text-muted">Tải dữ liệu</div>
      <FormField label="Số dòng tối đa tải (trống = 500, tối đa 10.000)">
        <Input
          type="number"
          min="1"
          max="10000"
          placeholder="500"
          value={rowLimit ?? ""}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            onChange({
              rowLimit: Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : undefined,
            });
          }}
        />
      </FormField>
      <FormField label="Số dòng mỗi trang (trống = 50; phân trang để render nhẹ hơn)">
        <Input
          type="number"
          min="1"
          max="10000"
          placeholder="50"
          value={pageSize ?? ""}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            onChange({
              pageSize: Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : undefined,
            });
          }}
        />
      </FormField>
      <FormField label="Chỉ tải khi state có giá trị (cổng)">
        <Input
          placeholder="vd: bo_phan_da_chon (để trống = luôn tải)"
          value={gate}
          onChange={(e) => onChange({ loadGate: e.target.value.trim() || undefined })}
        />
      </FormField>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-muted">Điều kiện trước khi load (lọc tại DB)</span>
          <button
            type="button"
            onClick={addCond}
            disabled={fields.length === 0 || entries.length >= fields.length}
            className="text-[11px] text-accent hover:underline disabled:opacity-40 disabled:no-underline"
          >
            + Thêm
          </button>
        </div>
        {fields.length === 0 ? (
          <p className="text-[11px] text-muted italic">Chọn Entity trước để thêm điều kiện.</p>
        ) : entries.length === 0 ? (
          <p className="text-[11px] text-muted italic">Không có điều kiện — tải tất cả.</p>
        ) : (
          entries.map(([field, cond]) => (
            <div key={field} className="flex items-center gap-1 mb-1">
              <Select
                className="flex-1 min-w-0"
                value={field}
                onChange={(e) => renameField(field, e.target.value)}
              >
                {fields.map((f) => (
                  <option key={f.name} value={f.name} disabled={f.name !== field && !!lf[f.name]}>
                    {fieldLabel(f.name)}
                  </option>
                ))}
              </Select>
              <Select
                className="w-20 shrink-0"
                value={cond.op}
                onChange={(e) => setCond(field, e.target.value, String(cond.value ?? ""))}
              >
                {LOAD_OPS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </Select>
              <Input
                className="w-24 shrink-0"
                placeholder="giá trị"
                value={String(cond.value ?? "")}
                onChange={(e) => setCond(field, cond.op, e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeCond(field)}
                className="shrink-0 text-muted hover:text-danger px-1"
                title="Xóa điều kiện"
              >
                <I.X size={12} />
              </button>
            </div>
          ))
        )}
        {entries.some((e) => e[1].op === "in") && (
          <p className="text-[10px] text-muted mt-0.5">
            Toán tử "in": nhập nhiều giá trị cách nhau dấu phẩy.
          </p>
        )}
      </div>
    </div>
  );
}

export function PageDesigner({ pageId }: Props) {
  const t = useT();
  const isMobile = useIsMobile();
  const inspectorVisible = useUI((s) => s.inspectorVisible);
  const setInspectorVisible = useUI((s) => s.setInspectorVisible);
  const { fieldDisp } = useFieldDisplay();

  const [components, setComponents, { canUndo, canRedo, undo, redo }] = useUndoable<
    PageComponent[]
  >([
    {
      id: "c1",
      kind: "kpi",
      x: 0,
      y: 0,
      w: 3,
      h: 2,
      config: { label: "Doanh thu hôm nay", value: "84.5M ₫", trend: "+12%" },
    },
    {
      id: "c2",
      kind: "kpi",
      x: 3,
      y: 0,
      w: 3,
      h: 2,
      config: { label: "Đơn hàng", value: "142", trend: "+8" },
    },
    {
      id: "c3",
      kind: "kpi",
      x: 6,
      y: 0,
      w: 3,
      h: 2,
      config: { label: "Khách mới", value: "23", trend: "+15%" },
    },
    {
      id: "c4",
      kind: "kpi",
      x: 9,
      y: 0,
      w: 3,
      h: 2,
      config: { label: "Tồn kho thấp", value: "3", trend: "⚠" },
    },
    {
      id: "c5",
      kind: "chart",
      x: 0,
      y: 2,
      w: 8,
      h: 3,
      config: { kind: "bar", title: "Doanh số 5 tháng" },
    },
    { id: "c6", kind: "list", x: 8, y: 2, w: 4, h: 3, config: { entity: "order" } },
  ]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragKind, setDragKind] = useState<ComponentKind | null>(null);
  const [compSearch, setCompSearch] = useState("");
  const [dragCompId, setDragCompId] = useState<string | null>(null);
  const [dragOverCompId, setDragOverCompId] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<{ x: number; y: number } | null>(null);
  const [inspTab, setInspTab] = useState("chung");
  const [aiOpen, setAiOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [paletteVisible, setPaletteVisible] = useState(true);
  const publishRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRafRef = useRef<number | null>(null);
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
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const { tools: mcpTools } = useMcpClient();
  const setPageContent = useUserObjects((s) => s.setPageContent);
  const publishPage = useUserObjects((s) => s.publishPage);
  const unpublishPage = useUserObjects((s) => s.unpublishPage);
  const setPageViewerGroups = useUserObjects((s) => s.setPageViewerGroups);
  const page = useUserObjects((s) => s.pages.find((p) => p.id === pageId));
  const vGroups = useUserObjects((s) => s.viewerGroupsList);
  const isPublished = page?.isPublished ?? false;
  const publishMode = page?.publishMode ?? "private";
  const entities = useUserObjects((s) => s.entities);
  const dataSources = useUserObjects((s) => s.dataSources);
  const dataSourceContent = useUserObjects((s) => s.dataSourceContent);
  const ready = useUserObjects((s) => s.ready);

  // Click ngoài dropdown publish → đóng
  useEffect(() => {
    if (!publishOpen) return;
    const handler = (e: MouseEvent) => {
      if (publishRef.current && !publishRef.current.contains(e.target as Node)) {
        setPublishOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [publishOpen]);

  // Load nội dung đã lưu khi đổi page hoặc khi hydration hoàn tất
  // biome-ignore lint/correctness/useExhaustiveDependencies: setComponents là setter ổn định, chỉ chạy lại khi đổi page/ready
  useEffect(() => {
    if (!ready) return;
    const stored = useUserObjects.getState().pageContent[pageId];
    if (Array.isArray(stored)) setComponents(stored as PageComponent[]);
    // Trang mới / chưa có nội dung (content = {} hoặc undefined) → canvas
    // TRẮNG, KHÔNG giữ lại demo/nội dung trang trước (lỗi "kế thừa trang cũ").
    else setComponents([]);
  }, [pageId, ready]);

  // Reset selection khi chuyển page
  // biome-ignore lint/correctness/useExhaustiveDependencies: chủ ý chỉ reset khi pageId đổi, setSelected setter ổn định
  useEffect(() => {
    setSelected(null);
  }, [pageId]);

  useEffect(() => {
    if (!selected) return;
    const comp = components.find((c) => c.id === selected);
    if (!comp) return;
    const available = tabsForKind(comp.kind);
    setInspTab((cur) => (available.some((t) => t.key === cur) ? cur : "chung"));
  }, [selected, components]);

  const stopAutoScroll = () => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
  };
  const startAutoScroll = (speed: number) => {
    stopAutoScroll();
    const tick = () => {
      canvasRef.current?.scrollBy({ top: speed });
      scrollRafRef.current = requestAnimationFrame(tick);
    };
    scrollRafRef.current = requestAnimationFrame(tick);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup mount/unmount duy nhất, stopAutoScroll dùng ref nội bộ
  useEffect(() => stopAutoScroll, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ gắn listener resize 1 lần, setComponents setter ổn định
  useEffect(() => {
    const GAP = 12; // gap-3 = 12px
    const ROW_STRIDE = 80 + GAP;
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
      if (r.dir === "e" || r.dir === "se") {
        newW = Math.max(1, Math.min(12 - r.compX, Math.round(r.startW + dx / colW)));
      }
      if (r.dir === "s" || r.dir === "se") {
        newH = Math.max(1, Math.round(r.startH + dy / ROW_STRIDE));
      }
      setComponents((cs) => cs.map((c) => (c.id === r.compId ? { ...c, w: newW, h: newH } : c)));
    };
    const onUp = () => {
      if (!resizeRef.current) return;
      const id = resizeRef.current.compId;
      resizeRef.current = null;
      setResizingId(null);
      setComponents((cs) => applyInsertAndResolve(id, cs));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []); // stable refs + functional setters only

  const save = () => {
    setPageContent(pageId, components);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  // Phím tắt trình dựng — binding cấu hình được ở /settings/shortcuts.
  // (handler được ref nội bộ trong useShortcut nên luôn gọi bản mới nhất.)
  useShortcut("designer-save", save);
  useShortcut("designer-undo", undo);
  useShortcut("designer-redo", redo);
  useShortcut("designer-preview", () => {
    // Lưu nội dung hiện tại trước khi xem trước (giống nút "Xem trước").
    setPageContent(pageId, components);
    setPreviewMode(true);
  });
  // Thoát xem trước CHỈ bật khi đang ở chế độ xem trước (mặc định Esc).
  useShortcut("designer-exit-preview", () => setPreviewMode(false), { enabled: previewMode });

  // AI apply — replace toàn bộ components từ đề xuất
  const handleAiApply = (design: PageDesign) => {
    const comps: PageComponent[] = (design.components ?? []).map((c, i) => ({
      id: `ai_${Date.now()}_${i}`,
      kind: (c.type || "list").toLowerCase() as ComponentKind,
      x: Math.max(0, Math.min(11, c.x ?? 0)),
      y: Math.max(0, c.y ?? 0),
      w: Math.max(1, Math.min(12, c.w ?? 6)),
      h: Math.max(1, c.h ?? 3),
      config: {
        title: c.title,
        entity: c.entityId,
        kind: c.chartKind,
        metric: c.metric,
        field: c.field,
        groupBy: c.groupBy,
      },
    }));
    setComponents(comps);
    setAiOpen(false);
  };

  const sel = components.find((c) => c.id === selected);

  /** Tổng hợp các nguồn state widget khác đang emit — dùng cho mọi
   *  MasterPicker trong inspector. Tính lại khi components hoặc selected
   *  đổi. Loại trừ widget hiện đang edit. */
  const stateSources = useMemo<StateSource[]>(
    () => collectStateSources(components, sel?.id ?? "", entities),
    [components, sel?.id, entities],
  );

  /** Khi user chọn source là 1 List và List đó chưa có selectionStateKey,
   *  gán cho List để wiring hoạt động. */
  const ensureMasterEmits = (source: StateSource | null) => {
    if (!source) return;
    if (source.componentKind !== "list") return;
    const list = components.find((c) => c.id === source.componentId);
    if (!list) return;
    if (list.config.selectionStateKey === source.stateKey) return;
    update(list.id, {
      config: { ...list.config, selectionStateKey: source.stateKey },
    });
  };

  const computeDropPos = (mouseX: number, mouseY: number) => {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(11, Math.floor(((mouseX - rect.left) / rect.width) * 12)));
    const y = Math.max(0, Math.floor((mouseY - rect.top) / (80 + 12)));
    return { x, y };
  };

  const findDropPos = (
    w: number,
    h: number,
    desiredX: number,
    desiredY: number,
    excludeId?: string,
  ): { x: number; y: number } => {
    const x = Math.max(0, Math.min(12 - w, desiredX));
    const others = components.filter((c) => c.id !== excludeId);
    const overlaps = (tx: number, ty: number) =>
      others.some((c) => tx < c.x + c.w && tx + w > c.x && ty < c.y + c.h && ty + h > c.y);
    let y = Math.max(0, desiredY);
    while (overlaps(x, y)) y++;
    return { x, y };
  };

  const addAt = (kind: ComponentKind, atX: number, atY: number) => {
    const meta = PALETTE.find((p) => p.kind === kind);
    if (!meta) return;
    const id = `c_${Math.random().toString(36).slice(2, 7)}`;
    const newComp: PageComponent = {
      id,
      kind,
      x: Math.max(0, Math.min(12 - meta.defaultSize.w, atX)),
      y: Math.max(0, atY),
      w: meta.defaultSize.w,
      h: meta.defaultSize.h,
      config: {},
    };
    setComponents((cs) => applyInsertAndResolve(id, [...cs, newComp]));
    setSelected(id);
  };
  const remove = (id: string) => {
    setComponents((cs) => cs.filter((c) => c.id !== id));
    if (selected === id) setSelected(null);
  };
  const update = (id: string, patch: Partial<PageComponent>) =>
    setComponents((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  // Mobile: trình thiết kế kéo-thả không dùng được → hiện banner + xem trước
  // (ConsumerPage tự stack 1 cột). Chỉnh sửa bố cục để dành cho desktop.
  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        <div className="h-11 shrink-0 flex items-center px-3 gap-2 border-b border-border bg-panel">
          <div className="w-7 h-7 rounded-md bg-accent/15 text-accent flex items-center justify-center">
            <I.Layout size={14} />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <div className="font-semibold text-base truncate">{page?.name ?? pageId}</div>
            <div className="text-[11px] text-muted">{components.length} component(s)</div>
          </div>
        </div>
        <MobileDesignerNotice />
        <div className="flex-1 overflow-auto">
          <ConsumerPage pageId={pageId} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="h-11 shrink-0 flex items-center px-3 gap-2 border-b border-border bg-panel">
        <div className="w-7 h-7 rounded-md bg-accent/15 text-accent flex items-center justify-center">
          <I.Layout size={14} />
        </div>
        <div className="flex flex-col leading-tight">
          <div className="font-semibold text-base">{page?.name ?? pageId}</div>
          <div className="text-[11px] text-muted">{components.length} component(s)</div>
        </div>
        <div className="flex-1" />
        <Button
          variant="default"
          size="sm"
          icon={<I.Sparkles size={13} />}
          onClick={() => setAiOpen(true)}
        >
          AI Assist
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<I.Undo size={13} />}
          onClick={undo}
          disabled={!canUndo}
          title="Ctrl+Z"
        >
          {t("designer.undo")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<I.Redo size={13} />}
          onClick={redo}
          disabled={!canRedo}
          title="Ctrl+Shift+Z"
        />
        <Button
          variant={previewMode ? "primary" : "default"}
          size="sm"
          icon={previewMode ? <I.EyeOff size={13} /> : <I.Eye size={13} />}
          onClick={() => {
            if (!previewMode) setPageContent(pageId, components);
            setPreviewMode((v) => !v);
          }}
        >
          {previewMode ? t("designer.exit_preview") : t("designer.preview")}
        </Button>
        <Button variant="primary" size="sm" icon={<I.Save size={13} />} onClick={save}>
          {t("designer.save_with_shortcut")}
        </Button>
        {saved && (
          <span className="text-xs text-success flex items-center gap-1">
            <I.Check size={11} /> {t("designer.saved")}
          </span>
        )}
        {/* Publish dropdown */}
        <div ref={publishRef} className="relative">
          {isPublished ? (
            <button
              type="button"
              onClick={() => setPublishOpen((v) => !v)}
              className="h-6 px-1.5 rounded border border-success/40 bg-success/10 text-success hover:bg-success/20 flex items-center gap-1"
              title={
                publishMode === "public"
                  ? t("designer.published_public")
                  : t("designer.published_private")
              }
            >
              {publishMode === "public" ? <I.Globe size={12} /> : <I.Lock size={12} />}
              <I.ChevronDown size={10} />
            </button>
          ) : (
            <div className="flex items-center gap-0.5">
              <Button
                variant="default"
                size="sm"
                icon={<I.Globe size={13} />}
                onClick={() => publishPage(pageId, "private")}
              >
                {t("designer.publish")}
              </Button>
              <button
                type="button"
                onClick={() => setPublishOpen((v) => !v)}
                className="h-7 px-1 rounded border border-border hover:bg-hover text-muted"
                title={t("designer.publish_options")}
              >
                <I.ChevronDown size={11} />
              </button>
            </div>
          )}
          {publishOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-panel border border-border rounded shadow-lg py-1 w-52 text-sm">
              {isPublished ? (
                <>
                  <div className="px-3 pt-1 pb-0.5 text-[10px] text-muted uppercase tracking-wider">
                    {t("designer.change_mode")}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      publishPage(pageId, "private");
                      setPublishOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 hover:bg-hover flex items-center gap-2",
                      publishMode === "private" && "text-accent",
                    )}
                  >
                    <I.Lock size={13} /> {t("designer.publish_private")}
                    {publishMode === "private" && <I.Check size={11} className="ml-auto" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      publishPage(pageId, "public");
                      setPublishOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 hover:bg-hover flex items-center gap-2",
                      publishMode === "public" && "text-accent",
                    )}
                  >
                    <I.Globe size={13} /> {t("designer.publish_public")}
                    {publishMode === "public" && <I.Check size={11} className="ml-auto" />}
                  </button>
                  {publishMode === "public" && (
                    <div className="px-3 py-1.5 border-t border-border mt-1 space-y-1">
                      <div className="text-[10px] text-muted uppercase tracking-wider">
                        {t("designer.public_url")}
                      </div>
                      <div className="flex items-center gap-1 bg-panel rounded px-2 py-1 text-[11px] font-mono text-text/70 min-w-0">
                        <span className="truncate flex-1">
                          {window.location.origin}/view/{pageId}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(`${window.location.origin}/view/${pageId}`)
                              .then(() => {
                                setLinkCopied(true);
                                setTimeout(() => setLinkCopied(false), 2000);
                              });
                          }}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded text-[11px] bg-panel-2 hover:bg-hover border border-border transition-colors"
                        >
                          {linkCopied ? (
                            <>
                              <I.Check size={11} className="text-success" /> {t("designer.copied")}
                            </>
                          ) : (
                            <>
                              <I.Copy size={11} /> {t("designer.copy_link")}
                            </>
                          )}
                        </button>
                        <a
                          href={`/view/${pageId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded text-[11px] bg-panel-2 hover:bg-hover border border-border transition-colors"
                          title={t("designer.open_in_tab")}
                        >
                          <I.ExternalLink size={11} />
                        </a>
                      </div>
                    </div>
                  )}
                  <div className="px-3 py-1.5 border-t border-border">
                    <div className="text-[10px] text-muted uppercase tracking-wider mb-1">
                      {t("designer.visible_to_groups")}
                    </div>
                    {vGroups.length === 0 ? (
                      <div className="text-[10px] text-muted/60">
                        {t("designer.no_groups_hint")}
                      </div>
                    ) : (
                      vGroups.map((g) => {
                        const checked = (page?.viewerGroupIds ?? []).includes(g.id);
                        return (
                          <label
                            key={g.id}
                            className="flex items-center gap-2 py-0.5 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const current = page?.viewerGroupIds ?? [];
                                const next = checked
                                  ? current.filter((id) => id !== g.id)
                                  : [...current, g.id];
                                setPageViewerGroups(pageId, next);
                              }}
                              className="w-3 h-3"
                            />
                            <span className="text-[11px]" style={{ color: g.color }}>
                              {g.name}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  <div className="border-t border-border">
                    <button
                      type="button"
                      onClick={() => {
                        unpublishPage(pageId);
                        setPublishOpen(false);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-hover text-danger flex items-center gap-2"
                    >
                      <I.X size={13} /> {t("designer.unpublish")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="px-3 py-1.5 text-[11px] text-muted uppercase tracking-wider">
                    {t("designer.publish_as")}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      publishPage(pageId, "private");
                      setPublishOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-hover flex items-center gap-2"
                  >
                    <I.Lock size={13} />
                    <div>
                      <div>{t("designer.publish_private")}</div>
                      <div className="text-[11px] text-muted">
                        {t("designer.publish_private_desc")}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      publishPage(pageId, "public");
                      setPublishOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-hover flex items-center gap-2"
                  >
                    <I.Globe size={13} />
                    <div>
                      <div>{t("designer.publish_public")}</div>
                      <div className="text-[11px] text-muted">
                        {t("designer.publish_public_desc")}
                      </div>
                    </div>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="w-px h-5 bg-border mx-1" />
        <FieldDisplayToggle label="" />
        <div className="w-px h-5 bg-border mx-1" />
        <button
          type="button"
          title={paletteVisible ? "Ẩn bảng thành phần" : "Hiện bảng thành phần"}
          onClick={() => setPaletteVisible((v) => !v)}
          className={cn(
            "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
            paletteVisible
              ? "bg-accent/15 text-accent hover:bg-accent/25"
              : "text-muted hover:bg-hover/60",
          )}
        >
          <I.PanelLeft size={14} />
        </button>
        <button
          type="button"
          title={inspectorVisible ? "Ẩn inspector" : "Hiện inspector"}
          onClick={() => setInspectorVisible(!inspectorVisible)}
          className={cn(
            "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
            inspectorVisible
              ? "bg-accent/15 text-accent hover:bg-accent/25"
              : "text-muted hover:bg-hover/60",
          )}
        >
          <I.PanelRight size={14} />
        </button>
      </div>
      <AiAssistDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        objectType="page"
        current={
          components.length > 0
            ? {
                name: page?.name ?? `Page ${pageId}`,
                components: components.map((c) => ({
                  type: c.kind,
                  title: String(c.config.title ?? c.config.label ?? c.kind),
                  x: c.x,
                  y: c.y,
                  w: c.w,
                  h: c.h,
                  entityId: c.config.entity as string | undefined,
                  chartKind: c.config.kind as string | undefined,
                })),
              }
            : undefined
        }
        context={{
          mcpTools: mcpTools.map((t) => ({ name: t.name, description: t.description })),
          otherEntities: entities.map((e) => ({
            id: e.id,
            name: e.name,
            mcp: e.mcp,
            fieldKeys: e.fields.map((f) => f.name),
          })),
        }}
        onApply={handleAiApply}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {/* Preview overlay */}
        {previewMode && (
          <div className="absolute inset-0 z-10 bg-bg overflow-auto">
            <ConsumerPage pageId={pageId} />
          </div>
        )}
        {/* Palette */}
        {paletteVisible && (
          <div className="w-[180px] shrink-0 border-r border-border bg-panel flex flex-col">
            <div className="px-3 py-2.5 border-b border-border space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
                {t("designer.components")}
              </div>
              <div className="relative">
                <I.Search
                  size={12}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                />
                <input
                  value={compSearch}
                  onChange={(e) => setCompSearch(e.target.value)}
                  placeholder={t("common.search")}
                  className="w-full h-7 pl-6 pr-2 rounded-md bg-bg-soft border border-border text-xs outline-none focus:border-accent/60"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {PALETTE.filter((p) => {
                const q = compSearch.trim().toLowerCase();
                if (!q) return true;
                return t(`page.comp.${p.kind}`).toLowerCase().includes(q);
              }).map((p) => {
                const IC = I[p.icon];
                return (
                  <div
                    key={p.kind}
                    draggable
                    onDragStart={(e) => {
                      setDragKind(p.kind);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onDragEnd={() => {
                      setDragKind(null);
                      stopAutoScroll();
                    }}
                    onDoubleClick={() => {
                      const meta2 = PALETTE.find((pp) => pp.kind === p.kind);
                      const w2 = meta2?.defaultSize.w ?? 4,
                        h2 = meta2?.defaultSize.h ?? 2;
                      const maxY = components.length
                        ? Math.max(...components.map((c) => c.y + c.h))
                        : 0;
                      const pos2 = findDropPos(w2, h2, 0, maxY);
                      addAt(p.kind, pos2.x, pos2.y);
                    }}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-md border border-border bg-bg-soft hover:border-accent/60 cursor-grab active:cursor-grabbing text-xs",
                      dragKind === p.kind && "dragging",
                    )}
                  >
                    <IC size={14} className="text-muted shrink-0" />
                    <span className="font-medium">{t(`page.comp.${p.kind}`)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Canvas grid */}
        <div
          ref={canvasRef}
          className="flex-1 overflow-auto canvas-dots"
          onDragOver={(e) => {
            if (dragKind || dragCompId) {
              e.preventDefault();
              setDropPos(computeDropPos(e.clientX, e.clientY));
              const el = e.currentTarget as HTMLElement;
              const rect = el.getBoundingClientRect();
              const ZONE = 64;
              const dy = e.clientY - rect.top;
              const db = rect.bottom - e.clientY;
              if (dy < ZONE) {
                startAutoScroll(-Math.ceil((1 - dy / ZONE) * 14));
              } else if (db < ZONE) {
                startAutoScroll(Math.ceil((1 - db / ZONE) * 14));
              } else {
                stopAutoScroll();
              }
            }
          }}
          onDragLeave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
              setDropPos(null);
              stopAutoScroll();
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            stopAutoScroll();
            const raw = dropPos ?? computeDropPos(e.clientX, e.clientY);
            if (dragKind) {
              if (raw) addAt(dragKind, raw.x, raw.y);
              else addAt(dragKind, 0, 0);
              setDragKind(null);
              setDropPos(null);
            } else if (dragCompId) {
              const comp = components.find((c) => c.id === dragCompId);
              if (raw && comp) {
                const nx = Math.max(0, Math.min(12 - comp.w, raw.x));
                const ny = Math.max(0, raw.y);
                setComponents((cs) =>
                  applyInsertAndResolve(
                    dragCompId,
                    cs.map((c) => (c.id === dragCompId ? { ...c, x: nx, y: ny } : c)),
                  ),
                );
              }
              setDragCompId(null);
              setDropPos(null);
              setDragOverCompId(null);
            }
          }}
        >
          <div className="max-w-[1200px] mx-auto p-4">
            <div ref={gridRef} className="grid grid-cols-12 gap-3 auto-rows-[80px]">
              {components.length === 0 && !dragKind && (
                <div
                  style={{ gridColumn: "1 / span 12" }}
                  className="flex items-center justify-center py-8"
                >
                  <EmptyState
                    icon={<I.Layout size={20} className="text-muted" />}
                    title={t("designer.page_empty_title")}
                    hint={t("designer.page_empty_hint")}
                  />
                </div>
              )}
              {(dragKind || dragCompId) &&
                dropPos &&
                (() => {
                  let w = 4,
                    h = 2;
                  if (dragKind) {
                    const meta = PALETTE.find((p) => p.kind === dragKind);
                    w = meta?.defaultSize.w ?? 4;
                    h = meta?.defaultSize.h ?? 2;
                  } else if (dragCompId) {
                    const dc = components.find((c) => c.id === dragCompId);
                    if (dc) {
                      w = dc.w;
                      h = dc.h;
                    }
                  }
                  const gx = Math.max(0, Math.min(12 - w, dropPos.x));
                  const gy = Math.max(0, dropPos.y);
                  return (
                    <div
                      className="pointer-events-none rounded-md border-2 border-dashed border-accent bg-accent/10 z-10"
                      style={{
                        gridColumn: `${gx + 1} / span ${w}`,
                        gridRow: `${gy + 1} / span ${h}`,
                      }}
                    />
                  );
                })()}
              {components.map((c) => (
                <ComponentCard
                  key={c.id}
                  comp={c}
                  selected={selected === c.id}
                  onSelect={() => {
                    if (!resizeRef.current) setSelected(c.id);
                  }}
                  onRemove={() => remove(c.id)}
                  isDragging={dragCompId === c.id}
                  isDragOver={dragOverCompId === c.id}
                  isReorderDrag={dragCompId !== null}
                  isResizing={resizingId === c.id}
                  previewMode={previewMode}
                  onDragStart={() => {
                    setDragCompId(c.id);
                    setDragKind(null);
                    setDropPos(null);
                  }}
                  onDragEnd={() => {
                    setDragCompId(null);
                    setDragOverCompId(null);
                    setDropPos(null);
                    stopAutoScroll();
                  }}
                  onDragOver={() => {
                    if (dragCompId && dragCompId !== c.id) setDragOverCompId(c.id);
                  }}
                  onDragLeave={() => setDragOverCompId((prev) => (prev === c.id ? null : prev))}
                  onResizeStart={(dir, mouseX, mouseY) => {
                    resizeRef.current = {
                      compId: c.id,
                      dir,
                      startMouseX: mouseX,
                      startMouseY: mouseY,
                      startW: c.w,
                      startH: c.h,
                      compX: c.x,
                    };
                    setResizingId(c.id);
                    setSelected(c.id);
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Inspector */}
        {inspectorVisible && (
          <aside className="w-[280px] shrink-0 border-l border-border bg-panel flex flex-col">
            <div className="h-11 shrink-0 px-3 flex items-center justify-between border-b border-border text-sm font-semibold">
              {t("designer.inspector")}
              {sel && (
                <button
                  type="button"
                  onClick={() => remove(sel.id)}
                  title={t("designer.delete_component")}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:bg-danger/15 hover:text-danger transition-colors"
                >
                  <I.Trash size={13} />
                </button>
              )}
            </div>
            {sel ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex border-b border-border shrink-0">
                  {tabsForKind(sel.kind).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setInspTab(tab.key)}
                      className={cn(
                        "flex-1 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
                        inspTab === tab.key
                          ? "border-accent text-accent"
                          : "border-transparent text-muted hover:text-fg",
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {inspTab === "chung" && (
                    <>
                      <FormField label={t("designer.comp_type")}>
                        <Chip variant="accent">{t(`page.comp.${sel.kind}`)}</Chip>
                      </FormField>
                      <FormField label={t("designer.comp_title")}>
                        <Input
                          placeholder={t("designer.comp_title_placeholder")}
                          value={(sel.config.title as string) ?? ""}
                          onChange={(e) =>
                            update(sel.id, { config: { ...sel.config, title: e.target.value } })
                          }
                        />
                      </FormField>
                      {/* Widget HTML / Ghi chú — ô nhập nội dung (trước đây
                          thiếu inspector nên "không ghi chú được"). */}
                      {sel.kind === "html" && (
                        <FormField
                          label="Nội dung HTML / Ghi chú"
                          hint="Nhập HTML hoặc ghi chú; hiển thị trong khung sandbox ở trang."
                        >
                          <Textarea
                            className="font-mono"
                            rows={8}
                            placeholder={"<h3>Ghi chú</h3>\n<p>Nội dung…</p>"}
                            value={(sel.config.html as string) ?? ""}
                            onChange={(e) =>
                              update(sel.id, { config: { ...sel.config, html: e.target.value } })
                            }
                          />
                        </FormField>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <FormField label={t("field.width")}>
                          <Input
                            type="number"
                            min="1"
                            max="12"
                            value={sel.w}
                            onChange={(e) =>
                              update(sel.id, {
                                w: Math.max(
                                  1,
                                  Math.min(12, Number.parseInt(e.target.value, 10) || 1),
                                ),
                              })
                            }
                          />
                        </FormField>
                        <FormField label={t("designer.comp_height")}>
                          <Input
                            type="number"
                            min="1"
                            value={sel.h}
                            onChange={(e) =>
                              update(sel.id, {
                                h: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                              })
                            }
                          />
                        </FormField>
                      </div>
                      <div className="text-[10px] text-muted/70 leading-relaxed">
                        Mẹo: kéo cạnh phải/đáy hoặc góc dưới-phải của widget trên canvas để đổi kích
                        thước (hoặc nhập số ô ở trên).
                      </div>
                      {INPUT_WIDGET_KINDS.has(sel.kind) && (
                        <button
                          type="button"
                          onClick={() => setInspTab("dieukien")}
                          className="w-full text-left text-[11px] px-2 py-1.5 rounded-md border border-accent/30 bg-accent/5 text-accent hover:bg-accent/10"
                        >
                          → Gắn nguồn dữ liệu (Entity + Field) ở tab “Nguồn &amp; Điều khiển”
                        </button>
                      )}
                    </>
                  )}
                  {/* Tải dữ liệu — số dòng + điều kiện + cổng (mọi widget record-list) */}
                  {/* Chọn nguồn bind: Entity hoặc Nguồn dữ liệu (datasource) */}
                  {inspTab === "dulieu" && BINDING_KINDS.has(sel.kind) && (
                    <BindingSourceConfig
                      key={sel.id}
                      cfg={sel.config}
                      dataSources={dataSources}
                      onChange={(patch) => update(sel.id, { config: { ...sel.config, ...patch } })}
                    />
                  )}
                  {/* Filter — cấu hình bộ lọc cascade (nguồn + nhãn/giá trị/nhóm
                     + state phát ra + nạp lại nguồn). */}
                  {inspTab === "dulieu" &&
                    sel.kind === "filter" &&
                    (() => {
                      const fcfg = sel.config as {
                        title?: string;
                        dataSourceId?: string;
                        labelField?: string;
                        valueField?: string;
                        familyField?: string;
                        emitStateKey?: string;
                        refreshDataSourceId?: string;
                      };
                      const upd = (patch: Record<string, unknown>) =>
                        update(sel.id, { config: { ...sel.config, ...patch } });
                      const dsc = fcfg.dataSourceId
                        ? dataSourceContent[fcfg.dataSourceId]
                        : undefined;
                      const dsCols = (dsc?.fields ?? []).map((f) => ({
                        name: f.key,
                        label: f.label || f.key,
                      }));
                      return (
                        <>
                          <FormField label="Tiêu đề">
                            <Input
                              placeholder="vd: Lọc theo sản phẩm"
                              value={fcfg.title ?? ""}
                              onChange={(e) => upd({ title: e.target.value })}
                            />
                          </FormField>
                          <div className="rounded-md border border-border p-2 space-y-2 bg-bg-soft/40">
                            <div className="text-xs font-semibold text-muted">
                              Nguồn tuỳ chọn (datasource)
                            </div>
                            <Select
                              value={fcfg.dataSourceId ?? ""}
                              onChange={(e) =>
                                upd({
                                  dataSourceId: e.target.value,
                                  labelField: undefined,
                                  valueField: undefined,
                                  familyField: undefined,
                                })
                              }
                            >
                              <option value="">— chọn nguồn dữ liệu —</option>
                              {dataSources.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name}
                                </option>
                              ))}
                            </Select>
                          </div>
                          {dsc ? (
                            <>
                              <FormField label="Trường nhãn (hiển thị)">
                                <Select
                                  value={fcfg.labelField ?? ""}
                                  onChange={(e) => upd({ labelField: e.target.value })}
                                >
                                  <option value="">— chọn —</option>
                                  {dsCols.map((c) => (
                                    <option key={c.name} value={c.name}>
                                      {c.label}
                                    </option>
                                  ))}
                                </Select>
                              </FormField>
                              <FormField label="Trường giá trị (lưu / phát ra)">
                                <Select
                                  value={fcfg.valueField ?? ""}
                                  onChange={(e) => upd({ valueField: e.target.value })}
                                >
                                  <option value="">— chọn —</option>
                                  {dsCols.map((c) => (
                                    <option key={c.name} value={c.name}>
                                      {c.label}
                                    </option>
                                  ))}
                                </Select>
                              </FormField>
                              <FormField label="Trường nhóm (cascade, tuỳ chọn)">
                                <Select
                                  value={fcfg.familyField ?? ""}
                                  onChange={(e) =>
                                    upd({ familyField: e.target.value || undefined })
                                  }
                                >
                                  <option value="">— không —</option>
                                  {dsCols.map((c) => (
                                    <option key={c.name} value={c.name}>
                                      {c.label}
                                    </option>
                                  ))}
                                </Select>
                              </FormField>
                            </>
                          ) : (
                            <div className="text-[11px] text-muted/70 px-0.5">
                              Chọn nguồn dữ liệu để cấu hình trường nhãn / giá trị / nhóm.
                            </div>
                          )}
                          <FormField label="State key phát ra">
                            <Input
                              placeholder="vd: selMasp"
                              value={fcfg.emitStateKey ?? ""}
                              onChange={(e) => upd({ emitStateKey: e.target.value })}
                            />
                            <div className="text-[10px] text-muted/70 mt-0.5 px-0.5">
                              Widget khác (vd List) đặt “Chỉ tải khi state có giá trị” = key này để
                              cascade.
                            </div>
                          </FormField>
                          <FormField label="Nạp lại nguồn khi chọn (tuỳ chọn)">
                            <Select
                              value={fcfg.refreshDataSourceId ?? ""}
                              onChange={(e) =>
                                upd({ refreshDataSourceId: e.target.value || undefined })
                              }
                            >
                              <option value="">— không —</option>
                              {dataSources.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name}
                                </option>
                              ))}
                            </Select>
                          </FormField>
                        </>
                      );
                    })()}
                  {inspTab === "dulieu" &&
                    RECORD_DATA_KINDS.has(sel.kind) &&
                    sel.config.dataSourceId === undefined && (
                      <DataLoadConfig
                        cfg={sel.config}
                        fields={
                          (entities.find((e) => e.id === (sel.config.entity as string | undefined))
                            ?.fields ?? []) as Array<{ name: string; label?: string }>
                        }
                        onChange={(patch) =>
                          update(sel.id, { config: { ...sel.config, ...patch } })
                        }
                      />
                    )}
                  {/* Cài đặt chung + (entity-mode) bộ chọn Entity. Cài đặt list
                     (chọn nhiều/sửa/cột hành động/chọn dòng…) hiện cho CẢ entity
                     lẫn datasource; riêng bộ chọn Entity + checklist field ẩn khi
                     bind datasource (đã có bộ chọn "Nguồn bind" riêng ở trên). */}
                  {inspTab === "dulieu" &&
                    (sel.kind === "list" ||
                      sel.kind === "detail" ||
                      sel.kind === "form" ||
                      sel.kind === "chart" ||
                      sel.kind === "kanban") &&
                    (() => {
                      const selEntity = entities.find(
                        (e) => e.id === (sel.config.entity as string | undefined),
                      );
                      const entityFields = selEntity?.fields ?? [];
                      const allSelected = sel.config.fields == null;
                      const selectedFieldNames = (sel.config.fields as string[] | undefined) ?? [];

                      return (
                        <>
                          {sel.config.dataSourceId === undefined && (
                            <>
                              <FormField label="Entity">
                                <Select
                                  value={(sel.config.entity as string) ?? ""}
                                  onChange={(e) =>
                                    update(sel.id, {
                                      config: {
                                        ...sel.config,
                                        entity: e.target.value,
                                        fields: null,
                                        groupBy: "",
                                        valueField: "",
                                      },
                                    })
                                  }
                                >
                                  <option value="">{t("field.choose")}</option>
                                  {entities.map((en) => (
                                    <option key={en.id} value={en.id}>
                                      {en.name}
                                    </option>
                                  ))}
                                </Select>
                              </FormField>

                              {/* Field checklist — list / form / detail khi đã bind entity */}
                              {(sel.kind === "list" ||
                                sel.kind === "form" ||
                                sel.kind === "detail") &&
                                entityFields.length > 0 && (
                                  <FormField label={t("designer.fields_to_show")}>
                                    <div className="border border-border rounded-md overflow-hidden">
                                      <div className="max-h-44 overflow-y-auto bg-bg-soft">
                                        {entityFields.map((f) => {
                                          const checked =
                                            allSelected || selectedFieldNames.includes(f.name);
                                          const isLookup =
                                            f.type === "lookup" || f.type === "multi-lookup";
                                          const refEnt =
                                            isLookup && f.ref
                                              ? entities.find((e) => e.id === f.ref)
                                              : null;
                                          return (
                                            <label
                                              key={f.name}
                                              className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-hover/40 border-b border-border/50 last:border-0"
                                            >
                                              <input
                                                type="checkbox"
                                                className="accent-accent shrink-0"
                                                checked={checked}
                                                onChange={(e) => {
                                                  const base = allSelected
                                                    ? entityFields.map((x) => x.name)
                                                    : [...selectedFieldNames];
                                                  const next = e.target.checked
                                                    ? base.includes(f.name)
                                                      ? base
                                                      : [...base, f.name]
                                                    : base.filter((n) => n !== f.name);
                                                  update(sel.id, {
                                                    config: {
                                                      ...sel.config,
                                                      fields:
                                                        next.length === entityFields.length
                                                          ? null
                                                          : next,
                                                    },
                                                  });
                                                }}
                                              />
                                              <span className="flex-1 truncate">
                                                {fieldDisp(f)}
                                              </span>
                                              {refEnt ? (
                                                <span className="text-[9px] text-accent shrink-0 flex items-center gap-0.5">
                                                  <I.Link size={8} />
                                                  {refEnt.name}
                                                </span>
                                              ) : isLookup && !f.ref ? (
                                                <span
                                                  className="text-[9px] text-warning shrink-0 flex items-center gap-0.5"
                                                  title="Chưa chọn entity đích"
                                                >
                                                  <I.Link size={8} />?
                                                </span>
                                              ) : null}
                                              <code className="text-[10px] text-muted font-mono shrink-0">
                                                {f.name}
                                              </code>
                                            </label>
                                          );
                                        })}
                                      </div>
                                      <div className="px-2 py-1 border-t border-border flex items-center justify-between bg-panel">
                                        <span className="text-[10px] text-muted">
                                          {t("designer.fields_count", {
                                            count: allSelected
                                              ? entityFields.length
                                              : selectedFieldNames.length,
                                          })}
                                        </span>
                                        <div className="flex items-center gap-2">
                                          {!allSelected && (
                                            <button
                                              type="button"
                                              className="text-[10px] text-accent hover:underline"
                                              onClick={() =>
                                                update(sel.id, {
                                                  config: { ...sel.config, fields: null },
                                                })
                                              }
                                            >
                                              {t("designer.fields_select_all")}
                                            </button>
                                          )}
                                          {(allSelected || selectedFieldNames.length > 0) && (
                                            <button
                                              type="button"
                                              className="text-[10px] text-muted hover:underline"
                                              onClick={() =>
                                                update(sel.id, {
                                                  config: { ...sel.config, fields: [] },
                                                })
                                              }
                                            >
                                              {t("designer.fields_deselect_all")}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </FormField>
                                )}
                            </>
                          )}

                          {/* Master (lọc theo) — widget này có thể lọc theo
                            state của bất kỳ widget khác trên trang (List
                            row, Combobox, Search, Tagbox, Form live...).
                            MasterPicker trả về stateKey trực tiếp. */}
                          {sel.kind === "list" && (
                            <div className="space-y-1.5">
                              <MasterFieldBinder
                                sources={stateSources}
                                entityFields={entityFields}
                                value={
                                  sel.config.filterFromState as
                                    | { field: string; stateKey: string }
                                    | undefined
                                }
                                onChange={(v) =>
                                  update(sel.id, {
                                    config: { ...sel.config, filterFromState: v },
                                  })
                                }
                                onPickSource={ensureMasterEmits}
                                masterLabel="Lọc theo (Master)"
                              />
                              <details className="pt-2 border-t border-border">
                                <summary className="text-xs font-semibold text-muted uppercase tracking-wide cursor-pointer hover:text-text">
                                  Bộ lọc nâng cao (AND / OR)
                                </summary>
                                <div className="mt-2">
                                  <FilterBuilder
                                    value={sel.config.filters as FilterNode | null | undefined}
                                    onChange={(next) =>
                                      update(sel.id, {
                                        config: { ...sel.config, filters: next },
                                      })
                                    }
                                    sources={stateSources}
                                    entityFields={entityFields}
                                    onPickSource={ensureMasterEmits}
                                  />
                                </div>
                              </details>
                            </div>
                          )}

                          {sel.kind === "list" && sel.config.filterFromState != null && (
                            <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                              <div className="flex flex-col leading-tight">
                                <span className="text-sm">Rỗng = hiện tất cả</span>
                                <span className="text-[11px] text-muted">
                                  Khi "Lọc theo" chưa chọn gì (vd Combobox để "— tất cả —") thì hiện
                                  toàn bộ thay vì ẩn hết. Tắt = master-detail (ẩn khi chưa chọn).
                                </span>
                              </div>
                              <Switch
                                checked={sel.config.emptyStateShowsAll === true}
                                onChange={(v) =>
                                  update(sel.id, {
                                    config: { ...sel.config, emptyStateShowsAll: v },
                                  })
                                }
                              />
                            </div>
                          )}

                          {sel.kind === "list" && (
                            <FormField label="Tìm kiếm từ ô Search">
                              <Input
                                placeholder="state key của Search widget (vd: search_q)"
                                value={(sel.config.searchFromState as string) ?? ""}
                                onChange={(e) =>
                                  update(sel.id, {
                                    config: {
                                      ...sel.config,
                                      searchFromState: e.target.value || undefined,
                                    },
                                  })
                                }
                              />
                            </FormField>
                          )}

                          {sel.kind === "list" && (
                            <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                              <div className="flex flex-col leading-tight">
                                <span className="text-sm">Chế độ chọn nhiều</span>
                                <span className="text-[11px] text-muted">
                                  Hiển thị checkbox, cho phép chọn nhiều dòng
                                </span>
                              </div>
                              <Switch
                                checked={sel.config.multiSelect === true}
                                onChange={(v) =>
                                  update(sel.id, { config: { ...sel.config, multiSelect: v } })
                                }
                              />
                            </div>
                          )}

                          {sel.kind === "list" && (
                            <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                              <div className="flex flex-col leading-tight">
                                <span className="text-sm">Có thể chỉnh sửa</span>
                                <span className="text-[11px] text-muted">
                                  Click đúp vào ô để sửa và lưu về datasource
                                </span>
                              </div>
                              <Switch
                                checked={sel.config.editable === true}
                                onChange={(v) =>
                                  update(sel.id, { config: { ...sel.config, editable: v } })
                                }
                              />
                            </div>
                          )}

                          {sel.kind === "list" && (
                            <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                              <div className="flex flex-col leading-tight">
                                <span className="text-sm">Chọn dòng (checkbox)</span>
                                <span className="text-[11px] text-muted">
                                  Cho phép tích chọn dòng · chọn tất cả đã lọc / mọi trang (mặc định
                                  ẩn)
                                </span>
                              </div>
                              <Switch
                                checked={sel.config.selectable === true}
                                onChange={(v) =>
                                  update(sel.id, {
                                    config: { ...sel.config, selectable: v },
                                  })
                                }
                              />
                            </div>
                          )}

                          {sel.kind === "list" && sel.config.editable === true && (
                            <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft ml-3">
                              <div className="flex flex-col leading-tight">
                                <span className="text-sm">Lưu theo lô (Batch edit)</span>
                                <span className="text-[11px] text-muted">
                                  Tích lũy thay đổi, hiển thị nút Lưu tất cả
                                </span>
                              </div>
                              <Switch
                                checked={sel.config.batchEdit === true}
                                onChange={(v) =>
                                  update(sel.id, { config: { ...sel.config, batchEdit: v } })
                                }
                              />
                            </div>
                          )}

                          {sel.kind === "list" &&
                            sel.config.editable === true &&
                            sel.config.batchEdit === true && (
                              <div className="rounded-md border border-border bg-bg-soft ml-3 p-2.5 space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex flex-col leading-tight">
                                    <span className="text-sm">Dòng thêm mới trong lưới</span>
                                    <span className="text-[11px] text-muted">
                                      Hiện dòng “＋ Thêm dòng mới”; bấm để thêm dòng nháp
                                    </span>
                                  </div>
                                  <Switch
                                    checked={sel.config.addRowAtEnd === true}
                                    onChange={(v) =>
                                      update(sel.id, { config: { ...sel.config, addRowAtEnd: v } })
                                    }
                                  />
                                </div>
                                {sel.config.addRowAtEnd === true && (
                                  <FormField label="Vị trí dòng thêm mới">
                                    <Select
                                      value={sel.config.addRowPos === "top" ? "top" : "bottom"}
                                      onChange={(e) =>
                                        update(sel.id, {
                                          config: { ...sel.config, addRowPos: e.target.value },
                                        })
                                      }
                                    >
                                      <option value="bottom">Cuối lưới</option>
                                      <option value="top">Đầu lưới</option>
                                    </Select>
                                  </FormField>
                                )}
                              </div>
                            )}

                          {sel.kind === "list" && (
                            <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                              <div className="flex flex-col leading-tight">
                                <span className="text-sm">Chế độ bảng tính (Excel)</span>
                                <span className="text-[11px] text-muted">
                                  Giao diện Excel với hỗ trợ công thức (=SUM, =IF…)
                                </span>
                              </div>
                              <Switch
                                checked={sel.config.excelMode === true}
                                onChange={(v) =>
                                  update(sel.id, {
                                    config: {
                                      ...sel.config,
                                      excelMode: v,
                                      ...(v ? { serverPaging: false } : {}),
                                    },
                                  })
                                }
                              />
                            </div>
                          )}

                          {sel.kind === "list" && sel.config.excelMode === true && (
                            <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft ml-3">
                              <div className="flex flex-col leading-tight">
                                <span className="text-sm">Lưu theo lô</span>
                                <span className="text-[11px] text-muted">
                                  Chỉ lưu khi bấm nút, không tự lưu khi rời ô
                                </span>
                              </div>
                              <Switch
                                checked={sel.config.batchEdit === true}
                                onChange={(v) =>
                                  update(sel.id, { config: { ...sel.config, batchEdit: v } })
                                }
                              />
                            </div>
                          )}

                          {sel.kind === "list" && (
                            <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                              <div className="flex flex-col leading-tight">
                                <span className="text-sm">Phân trang server (bảng lớn)</span>
                                <span className="text-[11px] text-muted">
                                  Sắp/lọc/phân trang trên server — duyệt được TOÀN bảng (&gt;10k
                                  dòng), sửa ô inline vẫn dùng được. Dùng "Tải dữ liệu → điều kiện"
                                  cho lọc cố định.
                                </span>
                              </div>
                              <Switch
                                checked={sel.config.serverPaging === true}
                                onChange={(v) =>
                                  update(sel.id, {
                                    config: {
                                      ...sel.config,
                                      serverPaging: v,
                                      // XOR với chế độ Excel (dùng grid riêng).
                                      ...(v ? { excelMode: false } : {}),
                                    },
                                  })
                                }
                              />
                            </div>
                          )}

                          {/* Chart config */}
                          {sel.kind === "chart" && (
                            <>
                              <FormField label={t("field.chart_type")}>
                                <Select
                                  value={(sel.config.kind as string) ?? "bar"}
                                  onChange={(e) =>
                                    update(sel.id, {
                                      config: { ...sel.config, kind: e.target.value },
                                    })
                                  }
                                >
                                  <option value="bar">Bar</option>
                                  <option value="line">Line</option>
                                  <option value="area">Area</option>
                                  <option value="pie">Pie</option>
                                  <option value="doughnut">Doughnut</option>
                                </Select>
                              </FormField>
                              <FormField label={t("designer.chart_group_field")}>
                                {entityFields.length > 0 ? (
                                  <Select
                                    value={(sel.config.groupBy as string) ?? ""}
                                    onChange={(e) =>
                                      update(sel.id, {
                                        config: { ...sel.config, groupBy: e.target.value },
                                      })
                                    }
                                  >
                                    <option value="">{t("field.choose")}</option>
                                    {entityFields.map((f) => (
                                      <option key={f.name} value={f.name}>
                                        {fieldBoth(f)}
                                      </option>
                                    ))}
                                  </Select>
                                ) : (
                                  <Input
                                    value={(sel.config.groupBy as string) ?? ""}
                                    placeholder="vd: status"
                                    onChange={(e) =>
                                      update(sel.id, {
                                        config: { ...sel.config, groupBy: e.target.value },
                                      })
                                    }
                                  />
                                )}
                              </FormField>
                              <FormField label={t("designer.chart_value_field")}>
                                {entityFields.length > 0 ? (
                                  <Select
                                    value={(sel.config.valueField as string) ?? ""}
                                    onChange={(e) =>
                                      update(sel.id, {
                                        config: { ...sel.config, valueField: e.target.value },
                                      })
                                    }
                                  >
                                    <option value="">Đếm số bản ghi</option>
                                    {entityFields
                                      .filter((f) => ["number", "currency"].includes(f.type))
                                      .map((f) => (
                                        <option key={f.name} value={f.name}>
                                          {fieldBoth(f)}
                                        </option>
                                      ))}
                                  </Select>
                                ) : (
                                  <Input
                                    value={(sel.config.valueField as string) ?? ""}
                                    placeholder="vd: tong_tien"
                                    onChange={(e) =>
                                      update(sel.id, {
                                        config: { ...sel.config, valueField: e.target.value },
                                      })
                                    }
                                  />
                                )}
                              </FormField>
                            </>
                          )}

                          {/* Kanban config */}
                          {sel.kind === "kanban" && (
                            <FormField label="Nhóm theo field">
                              {entityFields.length > 0 ? (
                                <Select
                                  value={(sel.config.groupBy as string) ?? ""}
                                  onChange={(e) =>
                                    update(sel.id, {
                                      config: { ...sel.config, groupBy: e.target.value },
                                    })
                                  }
                                >
                                  <option value="">{t("field.choose")}</option>
                                  {entityFields.map((f) => (
                                    <option key={f.name} value={f.name}>
                                      {fieldBoth(f)}
                                    </option>
                                  ))}
                                </Select>
                              ) : (
                                <Input
                                  value={(sel.config.groupBy as string) ?? "status"}
                                  placeholder="vd: status"
                                  onChange={(e) =>
                                    update(sel.id, {
                                      config: { ...sel.config, groupBy: e.target.value },
                                    })
                                  }
                                />
                              )}
                            </FormField>
                          )}

                          {/* ── Master-detail: section dùng chung cho
                            detail/form/chart/kanban. Mỗi kind đọc/ghi
                            config khác nhau nhưng UI chọn master giống nhau. */}

                          {/* Detail — nhận recordIdFromState từ bất kỳ source
                            scalar nào (List row, Combobox, Action output...). */}
                          {sel.kind === "detail" && (
                            <>
                              <FormField label="Nguồn record ID (Master)">
                                <MasterFieldBinder
                                  sources={stateSources}
                                  entityFields={entityFields}
                                  showFieldPicker={false}
                                  value={
                                    sel.config.recordIdFromState
                                      ? {
                                          field: "id",
                                          stateKey: sel.config.recordIdFromState as string,
                                        }
                                      : undefined
                                  }
                                  onChange={(v) =>
                                    update(sel.id, {
                                      config: {
                                        ...sel.config,
                                        recordIdFromState: v?.stateKey,
                                      },
                                    })
                                  }
                                  onPickSource={ensureMasterEmits}
                                  masterLabel="Lấy record ID từ"
                                />
                              </FormField>
                              <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                                <div className="flex flex-col leading-tight">
                                  <span className="text-sm">Chế độ chỉnh sửa</span>
                                  <span className="text-[11px] text-muted">
                                    Hiển thị dạng form, cho phép sửa trực tiếp
                                  </span>
                                </div>
                                <Switch
                                  checked={sel.config.editable === true}
                                  onChange={(v) =>
                                    update(sel.id, { config: { ...sel.config, editable: v } })
                                  }
                                />
                              </div>
                            </>
                          )}

                          {/* Form — linkedToState: tự điền field FK khi tạo
                            bản ghi mới. Master có thể là List row hay bất
                            kỳ source state nào trên page. */}
                          {sel.kind === "form" && (
                            <MasterFieldBinder
                              sources={stateSources}
                              entityFields={entityFields}
                              value={
                                sel.config.linkedToState as
                                  | { field: string; stateKey: string }
                                  | undefined
                              }
                              onChange={(v) =>
                                update(sel.id, {
                                  config: { ...sel.config, linkedToState: v },
                                })
                              }
                              onPickSource={ensureMasterEmits}
                              masterLabel="Liên kết với Master"
                              fieldLabel="Field auto-fill"
                            />
                          )}

                          {/* Chart — filterFromState: lọc data chart theo
                            bất kỳ master source nào. */}
                          {sel.kind === "chart" && (
                            <div className="space-y-1.5">
                              <MasterFieldBinder
                                sources={stateSources}
                                entityFields={entityFields}
                                value={
                                  sel.config.filterFromState as
                                    | { field: string; stateKey: string }
                                    | undefined
                                }
                                onChange={(v) =>
                                  update(sel.id, {
                                    config: { ...sel.config, filterFromState: v },
                                  })
                                }
                                onPickSource={ensureMasterEmits}
                                masterLabel="Lọc theo (Master)"
                              />
                              <details className="pt-2 border-t border-border">
                                <summary className="text-xs font-semibold text-muted uppercase tracking-wide cursor-pointer hover:text-text">
                                  Bộ lọc nâng cao (AND / OR)
                                </summary>
                                <div className="mt-2">
                                  <FilterBuilder
                                    value={sel.config.filters as FilterNode | null | undefined}
                                    onChange={(next) =>
                                      update(sel.id, {
                                        config: { ...sel.config, filters: next },
                                      })
                                    }
                                    sources={stateSources}
                                    entityFields={entityFields}
                                    onPickSource={ensureMasterEmits}
                                  />
                                </div>
                              </details>
                            </div>
                          )}

                          {/* Kanban — filterFromState: lọc thẻ kanban theo
                            bất kỳ master source nào. */}
                          {sel.kind === "kanban" && (
                            <div className="space-y-1.5">
                              <MasterFieldBinder
                                sources={stateSources}
                                entityFields={entityFields}
                                value={
                                  sel.config.filterFromState as
                                    | { field: string; stateKey: string }
                                    | undefined
                                }
                                onChange={(v) =>
                                  update(sel.id, {
                                    config: { ...sel.config, filterFromState: v },
                                  })
                                }
                                onPickSource={ensureMasterEmits}
                                masterLabel="Lọc theo (Master)"
                              />
                              <details className="pt-2 border-t border-border">
                                <summary className="text-xs font-semibold text-muted uppercase tracking-wide cursor-pointer hover:text-text">
                                  Bộ lọc nâng cao (AND / OR)
                                </summary>
                                <div className="mt-2">
                                  <FilterBuilder
                                    value={sel.config.filters as FilterNode | null | undefined}
                                    onChange={(next) =>
                                      update(sel.id, {
                                        config: { ...sel.config, filters: next },
                                      })
                                    }
                                    sources={stateSources}
                                    entityFields={entityFields}
                                    onPickSource={ensureMasterEmits}
                                  />
                                </div>
                              </details>
                            </div>
                          )}
                        </>
                      );
                    })()}

                  {/* ── Dải cột (banded header) — chỉ List ── */}
                  {inspTab === "band" &&
                    sel.kind === "list" &&
                    (() => {
                      const dsId = sel.config.dataSourceId as string | undefined;
                      const shown = sel.config.fields as string[] | null | undefined;
                      const colLabels = sel.config.columnLabels as
                        | Record<string, string>
                        | undefined;
                      // Danh sách cột (field) widget hiện — nguồn entity hoặc datasource.
                      let all: Array<{ name: string; label: string }> = [];
                      if (dsId !== undefined) {
                        const dsc = dataSourceContent[dsId];
                        if (dsc) {
                          all = [
                            ...(dsc.fields ?? []).map((f) => ({
                              name: f.key,
                              label: fieldBoth({ name: f.key, label: f.label }),
                            })),
                            ...(dsc.aggregates ?? []).map((a) => ({
                              name: a.key,
                              label: fieldBoth({ name: a.key, label: a.label }),
                            })),
                            ...(dsc.computed ?? []).map((c) => ({
                              name: c.key,
                              label: fieldBoth({ name: c.key, label: c.label }),
                            })),
                          ];
                        }
                      } else {
                        const ent = entities.find(
                          (e) => e.id === (sel.config.entity as string | undefined),
                        );
                        all = (ent?.fields ?? []).map((f) => ({
                          name: f.name,
                          label: fieldBoth(f),
                        }));
                      }
                      // Lọc theo cột đang hiển thị (null/undefined = tất cả) + áp nhãn override.
                      // BandEditor inspector luôn hiện cả nhãn lẫn tên kỹ thuật (fieldBoth).
                      const fields = (
                        shown == null ? all : all.filter((f) => shown.includes(f.name))
                      ).map((f) => ({
                        ...f,
                        // colLabels override (nhãn cột tuỳ chỉnh): giữ dạng "nhãn (name)"
                        label: colLabels?.[f.name]
                          ? fieldBoth({ name: f.name, label: colLabels[f.name] })
                          : f.label,
                      }));
                      return (
                        <BandEditor
                          value={sel.config.columnGroups as ColumnGroupNode[] | undefined}
                          availableFields={fields}
                          onChange={(next) =>
                            update(sel.id, { config: { ...sel.config, columnGroups: next } })
                          }
                        />
                      );
                    })()}

                  {/* ── Input control components ── */}
                  {inspTab === "dieukien" &&
                    (sel.kind === "search" ||
                      sel.kind === "combobox" ||
                      sel.kind === "listbox" ||
                      sel.kind === "tagbox") &&
                    (() => {
                      const cfg2 = sel.config as {
                        stateKey?: string;
                        label?: string;
                        placeholder?: string;
                        entity?: string;
                        field?: string;
                        options?: string;
                        multiSelect?: boolean;
                      };
                      const hasOptions = sel.kind !== "search";
                      const optEnt = hasOptions
                        ? entities.find((e) => e.id === cfg2.entity)
                        : undefined;
                      const upd = (patch: typeof cfg2) =>
                        update(sel.id, { config: { ...sel.config, ...patch } });
                      return (
                        <>
                          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mt-1">
                            Điều khiển
                          </div>
                          <FormField label="State key">
                            <Input
                              placeholder="vd: search_q, filter_status"
                              value={cfg2.stateKey ?? ""}
                              onChange={(e) => upd({ stateKey: e.target.value })}
                            />
                            <div className="text-[10px] text-muted/70 mt-0.5 px-0.5">
                              Widget khác đọc state key này để lọc dữ liệu
                            </div>
                          </FormField>
                          <FormField label="Nhãn hiển thị">
                            <Input
                              placeholder="Để trống = không hiện nhãn"
                              value={cfg2.label ?? ""}
                              onChange={(e) => upd({ label: e.target.value })}
                            />
                          </FormField>
                          {(sel.kind === "search" || sel.kind === "tagbox") && (
                            <FormField label="Placeholder">
                              <Input
                                placeholder="Gợi ý nhập..."
                                value={cfg2.placeholder ?? ""}
                                onChange={(e) => upd({ placeholder: e.target.value })}
                              />
                            </FormField>
                          )}
                          {sel.kind === "listbox" && (
                            <FormField label="Chọn nhiều">
                              <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={cfg2.multiSelect !== false}
                                  onChange={(e) => upd({ multiSelect: e.target.checked })}
                                  className="accent-accent"
                                />
                                Cho phép chọn nhiều giá trị
                              </label>
                            </FormField>
                          )}
                          {hasOptions && (
                            <>
                              <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mt-1">
                                Nguồn tuỳ chọn
                              </div>
                              <FormField label="Entity">
                                <Select
                                  value={cfg2.entity ?? ""}
                                  onChange={(e) => upd({ entity: e.target.value, field: "" })}
                                >
                                  <option value="">— tĩnh (nhập tay) —</option>
                                  {entities.map((e) => (
                                    <option key={e.id} value={e.id}>
                                      {e.name}
                                    </option>
                                  ))}
                                </Select>
                              </FormField>
                              {cfg2.entity && (
                                <FormField label="Field lấy giá trị">
                                  <Select
                                    value={cfg2.field ?? ""}
                                    onChange={(e) => upd({ field: e.target.value })}
                                  >
                                    <option value="">— chọn field —</option>
                                    {(optEnt?.fields ?? []).map((f) => (
                                      <option key={f.name} value={f.name}>
                                        {fieldBoth(f)}
                                      </option>
                                    ))}
                                  </Select>
                                </FormField>
                              )}
                              {!cfg2.entity && (
                                <FormField label="Tuỳ chọn tĩnh (phân cách phẩy)">
                                  <Input
                                    placeholder="Vd: Đang xử lý, Hoàn thành, Huỷ"
                                    value={cfg2.options ?? ""}
                                    onChange={(e) => upd({ options: e.target.value })}
                                  />
                                </FormField>
                              )}
                            </>
                          )}
                        </>
                      );
                    })()}

                  {/* ── Split Panel config ── */}
                  {inspTab === "bocuc" &&
                    sel.kind === "split" &&
                    (() => {
                      type PanelCfg = {
                        kind?: string;
                        entity?: string;
                        title?: string;
                        linkField?: string;
                      };
                      const splitCfg = sel.config as {
                        orientation?: "h" | "v" | "both";
                        ratio?: number;
                        ratioV?: number;
                        panelA?: PanelCfg;
                        panelB?: PanelCfg;
                        panelC?: PanelCfg;
                      };
                      const panelA = splitCfg.panelA ?? {};
                      const panelB = splitCfg.panelB ?? {};
                      const panelC = splitCfg.panelC ?? {};
                      const orientation = splitCfg.orientation ?? "h";
                      const ratio = splitCfg.ratio ?? 40;
                      const ratioV = splitCfg.ratioV ?? 50;
                      const subKinds = ["list", "detail", "form", "chart", "kanban"];
                      const updateSplit = (patch: typeof splitCfg) =>
                        update(sel.id, { config: { ...sel.config, ...patch } });
                      const entA = entities.find((e) => e.id === panelA.entity);
                      const entC = entities.find((e) => e.id === panelC.entity);

                      const PanelFields = ({
                        label,
                        panel,
                        linkedEnt,
                        defaultKind = "list",
                        onUpdate,
                      }: {
                        label: string;
                        panel: PanelCfg;
                        linkedEnt?: (typeof entities)[0];
                        defaultKind?: string;
                        onUpdate: (p: PanelCfg) => void;
                      }) => (
                        <>
                          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mt-1">
                            {label}
                          </div>
                          <FormField label="Loại">
                            <Select
                              value={panel.kind ?? defaultKind}
                              onChange={(e) => onUpdate({ ...panel, kind: e.target.value })}
                            >
                              {subKinds.map((k) => (
                                <option key={k} value={k}>
                                  {k}
                                </option>
                              ))}
                            </Select>
                          </FormField>
                          <FormField label="Entity">
                            <Select
                              value={panel.entity ?? ""}
                              onChange={(e) => onUpdate({ ...panel, entity: e.target.value })}
                            >
                              <option value="">— chọn entity —</option>
                              {entities.map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.name}
                                </option>
                              ))}
                            </Select>
                          </FormField>
                          <FormField label="Tiêu đề">
                            <Input
                              placeholder="Để trống = tên entity"
                              value={panel.title ?? ""}
                              onChange={(e) => onUpdate({ ...panel, title: e.target.value })}
                            />
                          </FormField>
                          {(panel.kind === "list" ||
                            panel.kind === "chart" ||
                            panel.kind === "kanban" ||
                            panel.kind === "form") && (
                            <FormField label="Field liên kết (→ A)">
                              {linkedEnt ? (
                                <Select
                                  value={panel.linkField ?? ""}
                                  onChange={(e) =>
                                    onUpdate({ ...panel, linkField: e.target.value })
                                  }
                                >
                                  <option value="">— chọn field —</option>
                                  {linkedEnt.fields.map((f) => (
                                    <option key={f.name} value={f.name}>
                                      {fieldBoth(f)}
                                      {f.type === "lookup" || f.type === "multi-lookup" ? " ↗" : ""}
                                    </option>
                                  ))}
                                </Select>
                              ) : (
                                <div className="text-[11px] text-muted italic px-1">
                                  Bind entity trước
                                </div>
                              )}
                            </FormField>
                          )}
                          {panel.kind === "detail" && entA && (
                            <div className="text-[11px] text-muted italic px-1">
                              Hiển thị record chọn từ Panel A ({entA.name})
                            </div>
                          )}
                        </>
                      );

                      return (
                        <>
                          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mt-1">
                            Layout
                          </div>
                          <FormField label="Hướng">
                            <Select
                              value={orientation}
                              onChange={(e) =>
                                updateSplit({ orientation: e.target.value as "h" | "v" | "both" })
                              }
                            >
                              <option value="h">Ngang (trái / phải)</option>
                              <option value="v">Dọc (trên / dưới)</option>
                              <option value="both">Cả hai (A | B trên / C dưới)</option>
                            </Select>
                          </FormField>
                          <FormField label={`Tỉ lệ ngang A: ${ratio}%`}>
                            <input
                              type="range"
                              min={20}
                              max={80}
                              value={ratio}
                              onChange={(e) => updateSplit({ ratio: Number(e.target.value) })}
                              className="w-full accent-accent"
                            />
                          </FormField>
                          {orientation === "both" && (
                            <FormField label={`Tỉ lệ dọc B/C: ${ratioV}%`}>
                              <input
                                type="range"
                                min={20}
                                max={80}
                                value={ratioV}
                                onChange={(e) => updateSplit({ ratioV: Number(e.target.value) })}
                                className="w-full accent-accent"
                              />
                            </FormField>
                          )}
                          <PanelFields
                            label="Panel A"
                            panel={panelA}
                            linkedEnt={undefined}
                            defaultKind="list"
                            onUpdate={(p) => updateSplit({ panelA: p })}
                          />
                          <PanelFields
                            label="Panel B"
                            panel={panelB}
                            linkedEnt={entities.find((e) => e.id === panelB.entity)}
                            defaultKind="detail"
                            onUpdate={(p) => updateSplit({ panelB: p })}
                          />
                          {orientation === "both" && (
                            <PanelFields
                              label="Panel C"
                              panel={panelC}
                              linkedEnt={entC}
                              defaultKind="list"
                              onUpdate={(p) => updateSplit({ panelC: p })}
                            />
                          )}
                        </>
                      );
                    })()}

                  {/* ── Wizard / Step ── */}
                  {inspTab === "buoc" &&
                    sel.kind === "step" &&
                    (() => {
                      interface StepDef {
                        id: string;
                        title: string;
                        description?: string;
                        entity?: string;
                        fields?: string[];
                        saveOutputTo?: string;
                        actions?: ActionBarItem[];
                      }
                      const steps = (sel.config.steps as StepDef[] | undefined) ?? [];
                      const submitLabel = (sel.config.submitLabel as string | undefined) ?? "";

                      const addStep = () => {
                        const newStep: StepDef = {
                          id: `s_${Math.random().toString(36).slice(2, 6)}`,
                          title: `Bước ${steps.length + 1}`,
                        };
                        update(sel.id, {
                          config: { ...sel.config, steps: [...steps, newStep] },
                        });
                        setExpandedStep(newStep.id);
                      };
                      const removeStep = (sid: string) => {
                        update(sel.id, {
                          config: { ...sel.config, steps: steps.filter((s) => s.id !== sid) },
                        });
                        if (expandedStep === sid) setExpandedStep(null);
                      };
                      const updateStep = (sid: string, patch: Partial<StepDef>) =>
                        update(sel.id, {
                          config: {
                            ...sel.config,
                            steps: steps.map((s) => (s.id === sid ? { ...s, ...patch } : s)),
                          },
                        });

                      return (
                        <>
                          <FormField label="Nhãn nút hoàn tất">
                            <Input
                              placeholder="Hoàn tất"
                              value={submitLabel}
                              onChange={(e) =>
                                update(sel.id, {
                                  config: { ...sel.config, submitLabel: e.target.value },
                                })
                              }
                            />
                          </FormField>
                          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mt-1">
                            Các bước ({steps.length})
                          </div>
                          <div className="space-y-2">
                            {steps.map((s, i) => {
                              const stepEnt = entities.find((e) => e.id === s.entity);
                              const isOpen = expandedStep === s.id;
                              const allSelected = s.fields == null;
                              const selectedFieldNames = s.fields ?? [];
                              const entFields = stepEnt?.fields ?? [];
                              return (
                                <div
                                  key={s.id}
                                  className="border border-border rounded-md overflow-hidden"
                                >
                                  <button
                                    type="button"
                                    className={cn(
                                      "w-full flex items-center gap-2 px-2 py-1.5 text-left",
                                      isOpen ? "bg-accent/10" : "hover:bg-hover/50",
                                    )}
                                    onClick={() => setExpandedStep(isOpen ? null : s.id)}
                                  >
                                    <div className="w-5 h-5 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[10px] font-semibold shrink-0">
                                      {i + 1}
                                    </div>
                                    <span className="flex-1 text-xs font-medium truncate">
                                      {s.title || `Bước ${i + 1}`}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeStep(s.id);
                                      }}
                                      className="w-5 h-5 flex items-center justify-center text-muted hover:text-danger"
                                    >
                                      <I.Trash size={11} />
                                    </button>
                                    <I.ChevronDown
                                      size={11}
                                      className={cn(
                                        "text-muted transition-transform shrink-0",
                                        isOpen && "rotate-180",
                                      )}
                                    />
                                  </button>
                                  {isOpen && (
                                    <div className="p-2 space-y-2 border-t border-border bg-bg-soft">
                                      <FormField label="Tên bước">
                                        <Input
                                          placeholder={`Bước ${i + 1}`}
                                          value={s.title}
                                          onChange={(e) =>
                                            updateStep(s.id, { title: e.target.value })
                                          }
                                        />
                                      </FormField>
                                      <FormField label="Mô tả (tuỳ chọn)">
                                        <Input
                                          placeholder="Hướng dẫn người dùng..."
                                          value={s.description ?? ""}
                                          onChange={(e) =>
                                            updateStep(s.id, {
                                              description: e.target.value || undefined,
                                            })
                                          }
                                        />
                                      </FormField>
                                      <FormField label="Entity (tạo bản ghi)">
                                        <Select
                                          value={s.entity ?? ""}
                                          onChange={(e) =>
                                            updateStep(s.id, {
                                              entity: e.target.value || undefined,
                                              fields: undefined,
                                            })
                                          }
                                        >
                                          <option value="">— chỉ hiển thị, không lưu —</option>
                                          {entities.map((en) => (
                                            <option key={en.id} value={en.id}>
                                              {en.name}
                                            </option>
                                          ))}
                                        </Select>
                                      </FormField>
                                      {stepEnt && entFields.length > 0 && (
                                        <FormField label="Trường hiển thị">
                                          <div className="border border-border rounded overflow-hidden max-h-36 overflow-y-auto">
                                            {entFields.map((f) => {
                                              const checked =
                                                allSelected || selectedFieldNames.includes(f.name);
                                              return (
                                                <label
                                                  key={f.name}
                                                  className="flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-hover/40 border-b border-border/50 last:border-0"
                                                >
                                                  <input
                                                    type="checkbox"
                                                    className="accent-accent"
                                                    checked={checked}
                                                    onChange={(ev) => {
                                                      const base = allSelected
                                                        ? entFields.map((x) => x.name)
                                                        : [...selectedFieldNames];
                                                      const next = ev.target.checked
                                                        ? base.includes(f.name)
                                                          ? base
                                                          : [...base, f.name]
                                                        : base.filter((n) => n !== f.name);
                                                      updateStep(s.id, {
                                                        fields:
                                                          next.length === entFields.length
                                                            ? undefined
                                                            : next,
                                                      });
                                                    }}
                                                  />
                                                  <span className="flex-1 truncate">
                                                    {fieldBoth(f)}
                                                  </span>
                                                </label>
                                              );
                                            })}
                                          </div>
                                        </FormField>
                                      )}
                                      {s.entity && (
                                        <FormField label="Lưu ID vào state key">
                                          <Input
                                            placeholder="vd: don_hang_id"
                                            value={s.saveOutputTo ?? ""}
                                            onChange={(e) =>
                                              updateStep(s.id, {
                                                saveOutputTo: e.target.value || undefined,
                                              })
                                            }
                                          />
                                          <div className="text-[10px] text-muted/70 mt-0.5 px-0.5">
                                            Bước sau dùng state này để liên kết
                                          </div>
                                        </FormField>
                                      )}
                                      <div className="pt-1 border-t border-border/60">
                                        <ActionBarInspector
                                          items={s.actions ?? []}
                                          align="left"
                                          embedded
                                          onChange={(items) =>
                                            updateStep(s.id, {
                                              actions: items.length ? items : undefined,
                                            })
                                          }
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            className="w-full flex items-center justify-center gap-1 py-1.5 rounded border border-dashed border-border text-xs text-muted hover:border-accent hover:text-accent transition-colors"
                            onClick={addStep}
                          >
                            <I.Plus size={12} /> Thêm bước
                          </button>
                        </>
                      );
                    })()}

                  {/* ── Action Bar ── */}
                  {inspTab === "hanhDong" && sel.kind === "actionbar" && (
                    <ActionBarInspector
                      items={(sel.config.items as ActionBarItem[] | undefined) ?? []}
                      align={(sel.config.align as "left" | "right" | "between") ?? "left"}
                      onChange={(items, align) =>
                        update(sel.id, { config: { ...sel.config, items, align } })
                      }
                    />
                  )}

                  {/* ── Cột hành động theo dòng (Xem/Sửa/Xoá + sao chép/in…) ── */}
                  {inspTab === "hanhDong" && sel.kind === "list" && (
                    <div className="space-y-2 pb-2 border-b border-border/40">
                      <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                        <div className="flex flex-col leading-tight">
                          <span className="text-sm">Cột hành động</span>
                          <span className="text-[11px] text-muted">
                            Thêm cột hành động cho từng dòng: Xem · Sửa · Xoá (+ sao chép / xuất /
                            in…). Mặc định ẩn.
                          </span>
                        </div>
                        <Switch
                          checked={sel.config.rowActionsBuiltin === true}
                          onChange={(v) =>
                            update(sel.id, { config: { ...sel.config, rowActionsBuiltin: v } })
                          }
                        />
                      </div>
                      {sel.config.rowActionsBuiltin === true && (
                        <>
                          <FormField label="Kiểu hiển thị">
                            <Select
                              value={(sel.config.rowActionsStyle as string) ?? "inline"}
                              onChange={(e) =>
                                update(sel.id, {
                                  config: { ...sel.config, rowActionsStyle: e.target.value },
                                })
                              }
                            >
                              <option value="inline">Inline (nút Xem · Sửa · Xoá)</option>
                              <option value="popover">Popover (nút ⋯ gọn)</option>
                            </Select>
                          </FormField>
                          {((sel.config.rowActionsStyle as string) ?? "inline") === "popover" && (
                            <div className="p-2.5 rounded-md border border-border bg-bg-soft">
                              <div className="text-sm mb-0.5">Nút hiện trên popover</div>
                              <div className="text-[11px] text-muted mb-2">
                                Bỏ tích để ẩn nút khỏi popover ⋯
                              </div>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                                {ROW_ACTION_OPTIONS.map((opt) => {
                                  const hidden =
                                    (sel.config.rowActionsHidden as string[] | undefined) ?? [];
                                  return (
                                    <label
                                      key={opt.key}
                                      className="flex items-center gap-1.5 text-[12px] cursor-pointer"
                                    >
                                      <input
                                        type="checkbox"
                                        className="accent-accent shrink-0"
                                        checked={!hidden.includes(opt.key)}
                                        onChange={(e) => {
                                          const h =
                                            (sel.config.rowActionsHidden as string[] | undefined) ??
                                            [];
                                          const next = e.target.checked
                                            ? h.filter((k) => k !== opt.key)
                                            : [...h, opt.key];
                                          update(sel.id, {
                                            config: { ...sel.config, rowActionsHidden: next },
                                          });
                                        }}
                                      />
                                      <span className="truncate">{opt.label}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* ── Thanh hành động nhúng — list / form / detail ── */}
                  {inspTab === "hanhDong" &&
                    (sel.kind === "list" || sel.kind === "form" || sel.kind === "detail") && (
                      <div className="space-y-2 pt-1 border-t border-border/40">
                        <ActionBarInspector
                          items={(sel.config.embeddedActions as ActionBarItem[] | undefined) ?? []}
                          align="left"
                          embedded
                          onChange={(items) =>
                            update(sel.id, { config: { ...sel.config, embeddedActions: items } })
                          }
                        />
                      </div>
                    )}

                  {/* ── Action — chuỗi step do người dùng cấu hình ── */}
                  {inspTab === "cauhinh" && sel.kind === "action" && (
                    <ActionInspector
                      config={
                        ((sel.config as unknown as ActionConfig | undefined) ?? {
                          label: "",
                          steps: [],
                        }) as ActionConfig
                      }
                      onChange={(next) =>
                        update(sel.id, {
                          config: next as unknown as Record<string, unknown>,
                        })
                      }
                    />
                  )}

                  {/* ── Bộ lọc nâng cao cho Calendar/Map/Pivot/KPI — các widget
                    consumer này chưa có MasterFieldBinder riêng nên thêm
                    standalone FilterBuilder. List/Chart/Kanban đã có khối
                    nâng cao riêng phía trên. */}
                  {(sel.kind === "calendar" ||
                    sel.kind === "map" ||
                    sel.kind === "pivot" ||
                    sel.kind === "kpi") &&
                    (() => {
                      const ent = entities.find(
                        (e) => e.id === (sel.config.entity as string | undefined),
                      );
                      return (
                        <details className="pt-2 border-t border-border">
                          <summary className="text-xs font-semibold text-muted uppercase tracking-wide cursor-pointer hover:text-text">
                            Bộ lọc nâng cao (AND / OR)
                          </summary>
                          <div className="mt-2">
                            {!ent && (
                              <div className="text-[11px] text-warning mb-2">
                                Bind entity ở "Cấu hình" trước để chọn field filter.
                              </div>
                            )}
                            <FilterBuilder
                              value={sel.config.filters as FilterNode | null | undefined}
                              onChange={(next) =>
                                update(sel.id, {
                                  config: { ...sel.config, filters: next },
                                })
                              }
                              sources={stateSources}
                              entityFields={ent?.fields ?? []}
                              onPickSource={ensureMasterEmits}
                            />
                          </div>
                        </details>
                      );
                    })()}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center px-6 text-sm text-muted">
                {t("designer.select_component")}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

// ===== tabsForKind — tabs cho inspector theo kind =====
function tabsForKind(kind: ComponentKind) {
  const dataKinds: ComponentKind[] = ["list", "detail", "form", "chart", "kanban"];
  const inputKinds: ComponentKind[] = ["search", "combobox", "listbox", "tagbox"];
  const base = [{ key: "chung", label: "Chung" }];
  if (dataKinds.includes(kind)) {
    const tabs = [...base, { key: "dulieu", label: "Dữ liệu" }];
    // Dải cột (banded header) — chỉ lưới/bảng (list).
    if (kind === "list") tabs.push({ key: "band", label: "Dải cột" });
    if (kind === "list" || kind === "form" || kind === "detail")
      tabs.push({ key: "hanhDong", label: "Hành động" });
    return tabs;
  }
  if (inputKinds.includes(kind)) return [...base, { key: "dieukien", label: "Nguồn & Điều khiển" }];
  if (kind === "filter") return [...base, { key: "dulieu", label: "Dữ liệu" }];
  if (kind === "split") return [...base, { key: "bocuc", label: "Bố cục" }];
  if (kind === "actionbar") return [...base, { key: "hanhDong", label: "Hành động" }];
  if (kind === "action") return [...base, { key: "cauhinh", label: "Cấu hình" }];
  if (kind === "step") return [...base, { key: "buoc", label: "Bước" }];
  return base;
}

// ===== ComponentCard — render từng component trên canvas =====
interface ComponentCardProps {
  comp: PageComponent;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  isDragging: boolean;
  isDragOver: boolean;
  isReorderDrag: boolean;
  isResizing: boolean;
  previewMode: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onResizeStart: (dir: "e" | "s" | "se", mouseX: number, mouseY: number) => void;
}
function ComponentCard({
  comp,
  selected,
  onSelect,
  onRemove,
  isDragging,
  isDragOver,
  isReorderDrag,
  isResizing,
  previewMode,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onResizeStart,
}: ComponentCardProps) {
  // Widget nhập chưa gắn nguồn nào (entity/options/stateKey) → badge nhắc.
  const unbound =
    INPUT_WIDGET_KINDS.has(comp.kind) &&
    !comp.config.entity &&
    !comp.config.options &&
    !comp.config.stateKey;
  return (
    <div
      draggable={!isResizing}
      onClick={onSelect}
      onDragStart={(e) => {
        if (isResizing) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", comp.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (isReorderDrag && !isDragging) {
          e.preventDefault();
          onDragOver();
        }
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
          onDragLeave();
        }
      }}
      className={cn(
        "card overflow-hidden flex flex-col cursor-pointer hover:border-accent/50 transition-opacity relative group/card",
        selected && "ring-2 ring-accent",
        isDragging && "opacity-40",
        isDragOver && "ring-2 ring-accent border-accent",
        isResizing && "select-none",
      )}
      style={{
        gridColumn: `${comp.x + 1} / span ${comp.w}`,
        gridRow: `${comp.y + 1} / span ${comp.h}`,
      }}
    >
      <div className="h-7 shrink-0 px-2 flex items-center justify-between border-b border-border bg-panel-2/50 text-[11px] text-muted">
        <div className="flex items-center gap-1.5">
          <I.Grip size={11} className="cursor-grab shrink-0 opacity-40 hover:opacity-70" />
          <span className="font-mono uppercase">{comp.kind}</span>
          {unbound && (
            <span
              title="Widget chưa gắn nguồn dữ liệu. Mở tab “Nguồn & Điều khiển” (chọn widget → inspector) để chọn Entity + Field hoặc nhập tuỳ chọn tĩnh."
              className="px-1 rounded-sm bg-warning/15 text-warning text-[9px] normal-case font-normal"
            >
              chưa gắn nguồn
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="w-5 h-5 rounded-sm hover:bg-danger/15 hover:text-danger flex items-center justify-center"
        >
          <I.X size={11} />
        </button>
      </div>
      <div className="flex-1 overflow-hidden min-h-0">
        {isScalableKind(comp.kind) ? (
          <ScaleToFit>
            <ComponentBody comp={comp} />
          </ScaleToFit>
        ) : (
          // Danh sách/tương tác: giữ nguyên kích thước, tự cuộn — không scale.
          <ComponentBody comp={comp} />
        )}
      </div>
      {!previewMode && (
        <>
          {/* Resize handle — right edge (rộng 2.5px cho dễ bắt, nhất là
              widget nhỏ như KPI) */}
          <div
            className={cn(
              "absolute right-0 top-0 bottom-2.5 w-2.5 cursor-ew-resize z-20 transition-colors",
              "opacity-0 group-hover/card:opacity-100",
              (selected || isResizing) && "opacity-100 bg-accent/20",
              "hover:bg-accent/50",
            )}
            title="Kéo để đổi chiều rộng"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onResizeStart("e", e.clientX, e.clientY);
            }}
          />
          {/* Resize handle — bottom edge */}
          <div
            className={cn(
              "absolute left-0 right-2.5 bottom-0 h-2.5 cursor-ns-resize z-20 transition-colors",
              "opacity-0 group-hover/card:opacity-100",
              (selected || isResizing) && "opacity-100 bg-accent/20",
              "hover:bg-accent/50",
            )}
            title="Kéo để đổi chiều cao"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onResizeStart("s", e.clientX, e.clientY);
            }}
          />
          {/* Resize handle — bottom-right corner */}
          <div
            className={cn(
              "absolute right-0 bottom-0 w-3.5 h-3.5 cursor-nwse-resize z-30 transition-colors",
              "opacity-0 group-hover/card:opacity-100",
              (selected || isResizing) && "opacity-100",
              "hover:bg-accent/60",
              "flex items-center justify-center",
            )}
            title="Kéo để đổi kích thước"
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onResizeStart("se", e.clientX, e.clientY);
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
                d="M1 6 L6 1 M3.5 6 L6 3.5 M6 6 L6 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

/* Ô xem trước trên canvas thiết kế — chỉ mô tả cấu trúc widget;
   dữ liệu thật render ở chế độ người dùng (ConsumerPage). */
function PreviewBox({ icon, label, hint }: { icon: IconName; label: string; hint: string }) {
  const IC = I[icon];
  return (
    <div className="p-3 h-full flex flex-col items-center justify-center text-center gap-1">
      <IC size={20} className="text-muted" />
      <div className="text-xs font-medium truncate max-w-full">{label}</div>
      <div className="text-[11px] text-muted">{hint}</div>
    </div>
  );
}

function ComponentBody({ comp }: { comp: PageComponent }) {
  const entities = useUserObjects((s) => s.entities);
  const dataSourceContent = useUserObjects((s) => s.dataSourceContent);
  const { fieldDisp } = useFieldDisplay();

  // Cột hiển thị {name,label} cho widget bind-DATASOURCE (preview canvas). Lấy
  // ĐÚNG nguồn như inspector band-editor (PageDesigner.tsx ~2004): datasource
  // fields + aggregates + computed; lọc/sắp theo cfg.fields; nhãn ưu tiên
  // columnLabels. Trả bound=false khi DS chưa chọn / chưa nạp config.
  const resolveDsCols = (
    cfg: Record<string, unknown>,
  ): { cols: Array<{ name: string; label: string }>; bound: boolean } => {
    const dsId = cfg.dataSourceId as string | undefined;
    const dsc = dsId ? dataSourceContent[dsId] : undefined;
    if (!dsc) return { cols: [], bound: false };
    const all = [
      ...(dsc.fields ?? []).map((f) => ({ name: f.key, label: f.label || f.key })),
      ...(dsc.aggregates ?? []).map((a) => ({ name: a.key, label: a.label || a.key })),
      ...(dsc.computed ?? []).map((c) => ({ name: c.key, label: c.label || c.key })),
    ];
    const want = cfg.fields as string[] | null | undefined;
    const colLabels = (cfg.columnLabels ?? {}) as Record<string, string>;
    let cols: Array<{ name: string; label: string }>;
    if (want == null) cols = all.slice(0, 8);
    else if (want.length === 0) cols = [];
    else {
      const byName = new Map(all.map((c) => [c.name, c] as const));
      cols = want.map((n) => byName.get(n) ?? { name: n, label: n });
    }
    return {
      cols: cols.map((c) => ({ name: c.name, label: colLabels[c.name] || c.label })),
      bound: true,
    };
  };

  if (comp.kind === "kpi") {
    const { label, value, trend, title } = comp.config as {
      label?: string;
      value?: string;
      trend?: string;
      title?: string;
    };
    return (
      <div className="p-3 h-full flex flex-col justify-center">
        <div className="text-xs text-muted uppercase tracking-wider">{title ?? label ?? "KPI"}</div>
        <div className="text-2xl font-bold mt-1">{value ?? "—"}</div>
        {trend && <div className="text-xs text-success mt-0.5">{trend}</div>}
      </div>
    );
  }

  if (comp.kind === "chart") {
    const {
      kind = "bar",
      title,
      entity,
      groupBy,
    } = comp.config as {
      kind?: string;
      title?: string;
      entity?: string;
      groupBy?: string;
    };
    const ent = entities.find((e) => e.id === entity);
    if (!ent)
      return <PreviewBox icon="BarChart" label={title ?? "Chart"} hint="Chưa bind entity" />;
    const groupField = ent.fields.find((f) => f.name === groupBy);
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="px-2 py-1 border-b border-border/40 shrink-0 flex items-center gap-1.5">
          <I.BarChart size={11} className="text-muted shrink-0" />
          <span className="text-[11px] font-medium truncate">{title ?? ent.name}</span>
          {groupBy && (
            <span className="text-[10px] text-muted ml-auto shrink-0">
              {kind} · {groupField ? fieldDisp(groupField) : groupBy}
            </span>
          )}
        </div>
        <div className="flex-1 flex items-end gap-1 px-3 pb-2 pt-1 min-h-0">
          {[55, 80, 40, 95, 65, 75, 50].map((h, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable skeleton bars
            <div key={i} className="flex-1 bg-accent/25 rounded-t-sm" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (comp.kind === "list") {
    const {
      entity,
      fields,
      title,
      embeddedActions: embActs,
    } = comp.config as {
      entity?: string;
      fields?: string[] | null;
      title?: string;
      embeddedActions?: ActionBarItem[];
    };
    // Widget bind DATASOURCE → preview cột theo datasource (nhãn columnLabels).
    const listDsId = comp.config.dataSourceId as string | undefined;
    if (listDsId !== undefined) {
      const { cols, bound } = resolveDsCols(comp.config);
      if (!bound)
        return <PreviewBox icon="Table" label={title ?? "List"} hint="Nguồn dữ liệu chưa tải" />;
      const embItems = embActs ?? [];
      return (
        <div className="h-full flex flex-col overflow-hidden text-[10px]">
          <div className="px-2 py-1 border-b border-border/40 shrink-0 flex items-center gap-1.5">
            <I.Table size={11} className="text-muted shrink-0" />
            <span className="font-medium truncate">{title || "Danh sách"}</span>
            <span className="text-muted ml-auto shrink-0">{cols.length} cột</span>
          </div>
          {embItems.length > 0 && <EmbeddedActionStrip items={embItems} />}
          {cols.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-muted">Chưa chọn cột</div>
          ) : (
            <div className="flex-1 overflow-hidden">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-panel-2/60">
                    {cols.map((c) => (
                      <th
                        key={c.name}
                        className="px-2 py-1 text-left font-semibold text-muted border-b border-border/40 truncate max-w-[80px]"
                      >
                        {fieldDisp(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2].map((row) => (
                    <tr key={row} className="border-b border-border/20">
                      {cols.map((c, ci) => (
                        <td key={c.name} className="px-2 py-1">
                          <div
                            className="h-2 bg-muted/15 rounded"
                            style={{ width: `${45 + ((row * 17 + ci * 13) % 45)}%` }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }

    const ent = entities.find((e) => e.id === entity);
    if (!ent) return <PreviewBox icon="Table" label={title ?? "List"} hint="Chưa bind entity" />;

    const allFields = ent.fields;
    const visibleFields =
      fields == null
        ? allFields.slice(0, 6)
        : fields.length === 0
          ? []
          : allFields.filter((f) => fields.includes(f.name));
    const embeddedActionItems = embActs ?? [];

    return (
      <div className="h-full flex flex-col overflow-hidden text-[10px]">
        <div className="px-2 py-1 border-b border-border/40 shrink-0 flex items-center gap-1.5">
          <I.Table size={11} className="text-muted shrink-0" />
          <span className="font-medium truncate">{title ?? ent.name}</span>
          <span className="text-muted ml-auto shrink-0">{visibleFields.length} cột</span>
        </div>
        {embeddedActionItems.length > 0 && <EmbeddedActionStrip items={embeddedActionItems} />}
        {visibleFields.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted">Chưa chọn trường</div>
        ) : (
          <div className="flex-1 overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-panel-2/60">
                  {visibleFields.map((f) => (
                    <th
                      key={f.name}
                      className="px-2 py-1 text-left font-semibold text-muted border-b border-border/40 truncate max-w-[80px]"
                    >
                      {fieldDisp(f)}
                      {(f.type === "lookup" || f.type === "multi-lookup") && (
                        <I.Link size={8} className="inline ml-0.5 text-accent/70 shrink-0" />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2].map((row) => (
                  <tr key={row} className="border-b border-border/20">
                    {visibleFields.map((f, ci) => (
                      <td key={f.name} className="px-2 py-1">
                        <div
                          className="h-2 bg-muted/15 rounded"
                          style={{ width: `${45 + ((row * 17 + ci * 13) % 45)}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (comp.kind === "form") {
    const {
      entity,
      fields,
      title,
      embeddedActions: embActs,
    } = comp.config as {
      entity?: string;
      fields?: string[] | null;
      title?: string;
      embeddedActions?: ActionBarItem[];
    };
    // Widget bind DATASOURCE → preview trường theo datasource.
    const formDsId = comp.config.dataSourceId as string | undefined;
    if (formDsId !== undefined) {
      const { cols, bound } = resolveDsCols(comp.config);
      if (!bound)
        return <PreviewBox icon="Edit" label={title ?? "Form"} hint="Nguồn dữ liệu chưa tải" />;
      const embItems = embActs ?? [];
      return (
        <div className="h-full flex flex-col overflow-hidden p-2 gap-1 text-[10px]">
          {embItems.length > 0 && (
            <div className="-mx-2 -mt-2 mb-1 px-2 py-1 border-b border-border/30 bg-bg-soft/50 shrink-0">
              <EmbeddedActionStrip items={embItems} />
            </div>
          )}
          {title && (
            <div className="text-[11px] font-medium text-text/80 mb-0.5 shrink-0">{title}</div>
          )}
          {cols.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-muted">Chưa chọn cột</div>
          ) : (
            <>
              {cols.slice(0, 6).map((c) => (
                <div key={c.name} className="flex items-center gap-1.5 shrink-0">
                  <div className="w-[80px] shrink-0 text-muted truncate">{fieldDisp(c)}</div>
                  <div className="flex-1 h-5 border border-border/50 rounded bg-bg-soft flex items-center px-1.5">
                    <div
                      className="h-1.5 bg-muted/20 rounded"
                      style={{ width: `${40 + ((c.name.length * 7) % 45)}%` }}
                    />
                  </div>
                </div>
              ))}
              {cols.length > 6 && (
                <div className="text-muted mt-0.5">+{cols.length - 6} trường nữa…</div>
              )}
            </>
          )}
        </div>
      );
    }

    const ent = entities.find((e) => e.id === entity);
    if (!ent) return <PreviewBox icon="Edit" label={title ?? "Form"} hint="Chưa bind entity" />;

    const allFields = ent.fields;
    const visibleFields =
      fields == null
        ? allFields
        : fields.length === 0
          ? []
          : allFields.filter((f) => fields.includes(f.name));
    const embeddedActionItems = embActs ?? [];

    return (
      <div className="h-full flex flex-col overflow-hidden p-2 gap-1 text-[10px]">
        {embeddedActionItems.length > 0 && (
          <div className="-mx-2 -mt-2 mb-1 px-2 py-1 border-b border-border/30 bg-bg-soft/50 shrink-0">
            <EmbeddedActionStrip items={embeddedActionItems} />
          </div>
        )}
        {title && (
          <div className="text-[11px] font-medium text-text/80 mb-0.5 shrink-0">{title}</div>
        )}
        {visibleFields.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted">Chưa chọn trường</div>
        ) : (
          <>
            {visibleFields.slice(0, 6).map((f) => (
              <div key={f.name} className="flex items-center gap-1.5 shrink-0">
                <div className="w-[80px] shrink-0 text-muted truncate flex items-center gap-0.5">
                  <span className="truncate">{fieldDisp(f)}</span>
                  {f.required && <span className="text-danger shrink-0">*</span>}
                  {(f.type === "lookup" || f.type === "multi-lookup") && (
                    <I.Link size={7} className="text-accent/70 shrink-0" />
                  )}
                </div>
                <div className="flex-1 h-5 border border-border/50 rounded bg-bg-soft flex items-center px-1.5">
                  <div
                    className="h-1.5 bg-muted/20 rounded"
                    style={{ width: `${40 + ((f.name.length * 7) % 45)}%` }}
                  />
                </div>
              </div>
            ))}
            {visibleFields.length > 6 && (
              <div className="text-muted mt-0.5">+{visibleFields.length - 6} trường nữa…</div>
            )}
          </>
        )}
      </div>
    );
  }

  if (comp.kind === "detail") {
    const {
      entity,
      title,
      editable,
      embeddedActions: embActs,
    } = comp.config as {
      entity?: string;
      title?: string;
      editable?: boolean;
      embeddedActions?: ActionBarItem[];
    };
    // Widget bind DATASOURCE → preview trường theo datasource.
    const detailDsId = comp.config.dataSourceId as string | undefined;
    if (detailDsId !== undefined) {
      const { cols, bound } = resolveDsCols(comp.config);
      if (!bound)
        return (
          <PreviewBox icon="PanelRight" label={title ?? "Detail"} hint="Nguồn dữ liệu chưa tải" />
        );
      const embItems = embActs ?? [];
      const shown = cols.slice(0, 6);
      return (
        <div className="h-full flex flex-col overflow-hidden">
          <div className="px-2 py-1 border-b border-border/40 shrink-0 flex items-center gap-1.5 text-[10px]">
            {editable ? (
              <I.Edit size={11} className="text-accent shrink-0" />
            ) : (
              <I.PanelRight size={11} className="text-muted shrink-0" />
            )}
            <span className="font-medium truncate">{title || "Chi tiết"}</span>
            {editable && (
              <span className="ml-auto text-[9px] text-accent bg-accent/10 px-1.5 py-0.5 rounded shrink-0">
                chỉnh sửa
              </span>
            )}
          </div>
          {embItems.length > 0 && <EmbeddedActionStrip items={embItems} />}
          <div className="flex-1 overflow-hidden p-2 space-y-1 text-[10px]">
            {shown.length === 0 ? (
              <div className="flex items-center justify-center text-muted h-full">
                Chưa chọn cột
              </div>
            ) : (
              shown.map((c) => (
                <div key={c.name} className="flex items-center gap-1.5 shrink-0">
                  <div className="w-[72px] shrink-0 text-muted truncate">{fieldDisp(c)}</div>
                  <div className="flex-1 h-5 border border-border/60 rounded bg-bg flex items-center px-1.5">
                    <div
                      className="h-1.5 bg-muted/25 rounded"
                      style={{ width: `${40 + ((c.name.length * 7) % 45)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
            {cols.length > 6 && <div className="text-muted">+{cols.length - 6} trường nữa…</div>}
          </div>
        </div>
      );
    }

    const ent = entities.find((e) => e.id === entity);
    if (!ent)
      return <PreviewBox icon="PanelRight" label={title ?? "Detail"} hint="Chưa bind entity" />;
    const embeddedActionItems = embActs ?? [];
    const fields = ent.fields.slice(0, 6);

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="px-2 py-1 border-b border-border/40 shrink-0 flex items-center gap-1.5 text-[10px]">
          {editable ? (
            <I.Edit size={11} className="text-accent shrink-0" />
          ) : (
            <I.PanelRight size={11} className="text-muted shrink-0" />
          )}
          <span className="font-medium truncate">{title ?? ent.name}</span>
          {editable && (
            <span className="ml-auto text-[9px] text-accent bg-accent/10 px-1.5 py-0.5 rounded shrink-0">
              chỉnh sửa
            </span>
          )}
        </div>
        {embeddedActionItems.length > 0 && <EmbeddedActionStrip items={embeddedActionItems} />}
        {editable ? (
          /* ── Dạng form chỉnh sửa ── */
          <div className="flex-1 overflow-hidden p-2 space-y-1 text-[10px]">
            {fields.map((f) => (
              <div key={f.name} className="flex items-center gap-1.5 shrink-0">
                <div className="w-[72px] shrink-0 text-muted truncate flex items-center gap-0.5">
                  <span className="truncate">{fieldDisp(f)}</span>
                  {f.required && <span className="text-danger shrink-0">*</span>}
                </div>
                <div className="flex-1 h-5 border border-border/60 rounded bg-bg flex items-center px-1.5 gap-1">
                  <div
                    className="h-1.5 bg-muted/25 rounded flex-1"
                    style={{ maxWidth: `${40 + ((f.name.length * 7) % 45)}%` }}
                  />
                  {(f.type === "select" || f.type === "lookup" || f.type === "multi-lookup") && (
                    <I.ChevronDown size={8} className="text-muted/50 shrink-0" />
                  )}
                </div>
              </div>
            ))}
            {ent.fields.length > 6 && (
              <div className="text-muted/60 text-[9px]">+{ent.fields.length - 6} trường nữa…</div>
            )}
          </div>
        ) : (
          /* ── Dạng xem chỉ đọc ── */
          <div className="flex-1 overflow-hidden p-2 space-y-1 text-[10px]">
            {fields.map((f) => (
              <div key={f.name} className="flex items-center gap-1.5 shrink-0">
                <div className="w-[72px] shrink-0 text-muted truncate">{fieldDisp(f)}</div>
                <div
                  className="h-1.5 bg-muted/20 rounded"
                  style={{ width: `${40 + ((f.name.length * 7) % 45)}%` }}
                />
              </div>
            ))}
            {ent.fields.length > 6 && (
              <div className="text-muted/60 text-[9px]">+{ent.fields.length - 6} trường nữa…</div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (comp.kind === "kanban") {
    const { entity, groupBy } = comp.config as { entity?: string; groupBy?: string };
    const ent = entities.find((e) => e.id === entity);
    if (!ent) return <PreviewBox icon="Kanban" label="Kanban" hint="Chưa bind entity" />;

    const groupField = ent.fields.find((f) => f.name === groupBy);
    const cols =
      groupField?.type === "select" && groupField.options?.length
        ? groupField.options.slice(0, 5)
        : groupBy
          ? [groupBy]
          : ["Cột 1", "Cột 2", "Cột 3"];

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="px-2 py-1 border-b border-border/40 shrink-0 flex items-center gap-1.5 text-[10px]">
          <I.Kanban size={11} className="text-muted shrink-0" />
          <span className="font-medium truncate">{ent.name}</span>
          {groupBy && (
            <span className="text-muted ml-auto shrink-0">
              theo {groupField ? fieldDisp(groupField) : groupBy}
            </span>
          )}
        </div>
        <div className="flex-1 flex gap-1.5 p-1.5 min-h-0 overflow-hidden">
          {cols.map((col) => (
            <div
              key={col}
              className="flex-1 min-w-0 bg-bg-soft rounded border border-border/40 flex flex-col"
            >
              <div className="text-[9px] font-semibold px-1.5 py-1 border-b border-border/30 truncate text-muted">
                {col}
              </div>
              <div className="flex-1 p-1 space-y-1">
                {[0, 1, 2].map((i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable skeleton
                  <div key={i} className="h-4 bg-panel rounded border border-border/30" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (comp.kind === "split") {
    const {
      orientation = "h",
      ratio = 40,
      ratioV = 50,
      panelA,
      panelB,
      panelC,
    } = comp.config as {
      orientation?: string;
      ratio?: number;
      ratioV?: number;
      panelA?: { kind?: string; entity?: string; title?: string };
      panelB?: { kind?: string; entity?: string; title?: string };
      panelC?: { kind?: string; entity?: string; title?: string };
    };
    const entA = entities.find((e) => e.id === panelA?.entity);
    const entB = entities.find((e) => e.id === panelB?.entity);
    const entC = entities.find((e) => e.id === panelC?.entity);
    const isBoth = orientation === "both";
    const isH = orientation !== "v";

    const PanelPreview = ({
      label,
      ent,
      title,
      kind,
      bg,
    }: {
      label: string;
      ent?: (typeof entities)[0];
      title?: string;
      kind?: string;
      bg: string;
    }) => (
      <div className={`flex flex-col overflow-hidden h-full ${bg}`}>
        <div className="px-1.5 py-0.5 border-b border-border/30 shrink-0 flex items-center gap-1">
          <span className="font-bold text-[8px] text-muted uppercase">{label}</span>
          {ent && <span className="text-muted truncate text-[9px]">{title ?? ent.name}</span>}
          {kind && <span className="ml-auto text-[8px] text-muted/50">{kind}</span>}
        </div>
        {ent ? (
          <div className="flex-1 flex flex-col gap-0.5 p-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-2.5 bg-muted/15 rounded" />
            ))}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[9px] text-muted/60">
            Chưa bind
          </div>
        )}
      </div>
    );

    if (isBoth) {
      return (
        <div className="h-full flex flex-row overflow-hidden text-[10px]">
          <div className="overflow-hidden border-r border-border/40" style={{ width: `${ratio}%` }}>
            <PanelPreview
              label="A"
              ent={entA}
              title={panelA?.title}
              kind={panelA?.kind}
              bg="bg-accent/5"
            />
          </div>
          <div className="flex-1 flex flex-col overflow-hidden">
            <div
              className="overflow-hidden border-b border-border/40"
              style={{ height: `${ratioV}%` }}
            >
              <PanelPreview
                label="B"
                ent={entB}
                title={panelB?.title}
                kind={panelB?.kind}
                bg="bg-panel-2/30"
              />
            </div>
            <div className="flex-1 overflow-hidden">
              <PanelPreview label="C" ent={entC} title={panelC?.title} kind={panelC?.kind} bg="" />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`h-full flex ${isH ? "flex-row" : "flex-col"} overflow-hidden text-[10px]`}>
        <div
          className={`overflow-hidden border-border/40 ${isH ? "border-r" : "border-b"}`}
          style={{ [isH ? "width" : "height"]: `${ratio}%` }}
        >
          <PanelPreview
            label="A"
            ent={entA}
            title={panelA?.title}
            kind={panelA?.kind}
            bg="bg-accent/5"
          />
        </div>
        <div className="flex-1 overflow-hidden">
          <PanelPreview
            label="B"
            ent={entB}
            title={panelB?.title}
            kind={panelB?.kind}
            bg="bg-panel-2/30"
          />
        </div>
      </div>
    );
  }

  if (comp.kind === "search") {
    const label = comp.config.label as string | undefined;
    const placeholder = (comp.config.placeholder as string) || "Tìm kiếm…";
    return (
      <div className="p-2 flex flex-col gap-1 h-full">
        {label && <div className="text-[10px] font-medium text-muted">{label}</div>}
        <div className="relative flex items-center h-7 border border-border/50 rounded bg-bg-soft px-2 gap-1.5">
          <I.Search size={11} className="text-muted shrink-0" />
          <span className="text-[10px] text-muted/60 truncate">{placeholder}</span>
        </div>
      </div>
    );
  }

  if (comp.kind === "combobox") {
    const label = comp.config.label as string | undefined;
    return (
      <div className="p-2 flex flex-col gap-1 h-full">
        {label && <div className="text-[10px] font-medium text-muted">{label}</div>}
        <div className="relative flex items-center h-7 border border-border/50 rounded bg-bg-soft px-2">
          <span className="text-[10px] text-muted/60 flex-1">Tất cả</span>
          <I.ChevronDown size={11} className="text-muted shrink-0" />
        </div>
      </div>
    );
  }

  if (comp.kind === "listbox") {
    const label = comp.config.label as string | undefined;
    const staticOpts = (comp.config.options as string) || "";
    const opts = staticOpts
      ? staticOpts
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 5)
      : ["Option 1", "Option 2", "Option 3"];
    return (
      <div className="h-full flex flex-col overflow-hidden text-[10px]">
        {label && (
          <div className="px-2 py-1 border-b border-border/40 shrink-0 font-medium text-muted">
            {label}
          </div>
        )}
        <div className="flex-1 overflow-hidden divide-y divide-border/30">
          {opts.map((o) => (
            <div key={o} className="flex items-center gap-1.5 px-2 py-1">
              <span className="w-3 h-3 border border-border/50 rounded shrink-0" />
              <span className="truncate">{o}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (comp.kind === "tagbox") {
    const label = comp.config.label as string | undefined;
    const staticOpts = (comp.config.options as string) || "";
    const opts = staticOpts
      ? staticOpts
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];
    return (
      <div className="p-2 flex flex-col gap-1 h-full">
        {label && <div className="text-[10px] font-medium text-muted">{label}</div>}
        <div className="flex flex-wrap gap-1 min-h-7 border border-border/50 rounded bg-bg-soft p-1.5">
          {opts.map((o) => (
            <span
              key={o}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-accent/15 text-accent text-[9px]"
            >
              {o} ×
            </span>
          ))}
          {opts.length === 0 && <span className="text-[10px] text-muted/50">Tag…</span>}
        </div>
      </div>
    );
  }

  if (comp.kind === "html") {
    const { html } = comp.config as { html?: string };
    return (
      <div
        className="p-3 text-xs"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: widget HTML do admin-designer nhập, in-app preview
        dangerouslySetInnerHTML={{ __html: html ?? "<i>HTML / Markdown note</i>" }}
      />
    );
  }

  if (comp.kind === "action") {
    const { label, icon, variant } = comp.config as {
      label?: string;
      icon?: IconName;
      variant?: string;
    };
    const IC = icon && I[icon] ? I[icon] : I.Play;
    const palette: Record<string, string> = {
      primary: "bg-accent text-white border-accent",
      danger: "bg-danger text-white border-danger",
      ghost: "bg-transparent text-text border-transparent",
      default: "bg-panel-2 text-text border-border",
    };
    const klass = palette[variant ?? "default"] ?? palette.default;
    return (
      <div className="h-full w-full flex items-center justify-center p-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium",
            klass,
          )}
        >
          <IC size={12} />
          {label || "Action"}
        </span>
      </div>
    );
  }

  if (comp.kind === "actionbar") {
    const { items = [], align = "left" } = comp.config as {
      items?: ActionBarItem[];
      align?: string;
    };
    const justify =
      align === "right" ? "justify-end" : align === "between" ? "justify-between" : "justify-start";
    const btnPalette: Record<string, string> = {
      primary: "bg-accent/20 text-accent border-accent/40",
      danger: "bg-danger/10 text-danger border-danger/30",
      ghost: "bg-transparent text-muted border-transparent",
      default: "bg-panel-2 text-text border-border/70",
    };
    return (
      <div className={cn("h-full flex items-center gap-1.5 px-2.5", justify)}>
        {items.length === 0 ? (
          <span className="text-[10px] text-muted/50 italic">Chưa có hành động…</span>
        ) : (
          items.map((item) => {
            const IC = item.icon && I[item.icon as IconName] ? I[item.icon as IconName] : null;
            const cls = btnPalette[item.variant ?? "default"] ?? btnPalette.default;
            return (
              <span
                key={item.id}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[10px] font-medium shrink-0",
                  cls,
                )}
              >
                {IC && <IC size={10} />}
                {item.label || "Action"}
              </span>
            );
          })
        )}
      </div>
    );
  }

  if (comp.kind === "step") {
    const steps = (comp.config.steps as Array<{ id: string; title?: string }> | undefined) ?? [];
    return (
      <div className="flex flex-col h-full overflow-hidden text-[10px]">
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-panel-2/30">
          {steps.length === 0 ? (
            <span className="text-muted/60 italic">Chưa có bước nào</span>
          ) : (
            steps.slice(0, 5).map((s, i) => (
              <div key={s.id} className="flex items-center gap-1 shrink-0">
                <div
                  className={cn(
                    "w-4 h-4 rounded-full flex items-center justify-center font-semibold text-[9px] shrink-0",
                    i === 0 ? "bg-accent/25 text-accent" : "bg-border text-muted",
                  )}
                >
                  {i + 1}
                </div>
                <span className="truncate max-w-[60px] text-muted">{s.title || `B${i + 1}`}</span>
                {i < steps.slice(0, 5).length - 1 && (
                  <div className="w-3 h-px bg-border shrink-0" />
                )}
              </div>
            ))
          )}
        </div>
        <div className="flex-1 p-2 space-y-1.5">
          <div className="h-2 bg-muted/15 rounded w-3/4" />
          <div className="h-6 border border-border/40 rounded bg-bg-soft" />
          <div className="h-2 bg-muted/15 rounded w-1/2" />
          <div className="h-6 border border-border/40 rounded bg-bg-soft" />
        </div>
        <div className="shrink-0 px-2 py-1.5 border-t border-border/40 flex justify-between">
          <div className="h-5 w-12 rounded border border-border/40 bg-panel-2/50" />
          <div className="h-5 w-14 rounded bg-accent/20 border border-accent/30" />
        </div>
      </div>
    );
  }

  // Bộ lọc (filter) — bind datasource, phát state cho widget khác (loadGate).
  // Preview: ô dropdown stub theo labelField + caption value/family/emit.
  if (comp.kind === "filter") {
    const cfg = comp.config as {
      title?: string;
      labelField?: string;
      valueField?: string;
      familyField?: string;
      dataSourceId?: string;
      emitStateKey?: string;
    };
    const dsc = cfg.dataSourceId ? dataSourceContent[cfg.dataSourceId] : undefined;
    const labelOf = (key?: string): string =>
      !key ? "—" : (dsc?.fields?.find((x) => x.key === key)?.label ?? key);
    return (
      <div className="h-full flex flex-col overflow-hidden p-2 gap-1 text-[10px]">
        <div className="flex items-center gap-1.5 shrink-0">
          <I.Search size={11} className="text-muted shrink-0" />
          <span className="font-medium truncate">{cfg.title || "Bộ lọc"}</span>
          {!dsc && (
            <span className="ml-auto px-1 rounded-sm bg-warning/15 text-warning text-[9px] shrink-0">
              chưa gắn nguồn
            </span>
          )}
        </div>
        <div className="h-6 border border-border/60 rounded bg-bg-soft flex items-center justify-between px-2 shrink-0">
          <span className="truncate text-muted">{labelOf(cfg.labelField)}…</span>
          <I.ChevronDown size={10} className="text-muted/60 shrink-0" />
        </div>
        <div className="text-[9px] text-muted/70 truncate shrink-0">
          Lưu: {labelOf(cfg.valueField)}
          {cfg.familyField ? ` · Nhóm: ${labelOf(cfg.familyField)}` : ""}
          {cfg.emitStateKey ? ` · → ${cfg.emitStateKey}` : ""}
        </div>
      </div>
    );
  }

  return null;
}

// ── EmbeddedActionStrip ─────────────────────────────────────────────────────
// Thanh hành động nhỏ hiển thị trong header của list / form / detail preview.
const EMBED_PALETTE: Record<string, string> = {
  primary: "bg-accent/20 text-accent border-accent/40",
  danger: "bg-danger/10 text-danger border-danger/30",
  ghost: "bg-transparent text-muted border-transparent",
  default: "bg-panel-2 text-text border-border/60",
};
function EmbeddedActionStrip({ items }: { items: ActionBarItem[] }) {
  const visible = items.slice(0, 5);
  const rest = items.length - 5;
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border/30 bg-bg-soft/50 shrink-0 flex-wrap">
      {visible.map((item) => {
        const IC = item.icon && I[item.icon as IconName] ? I[item.icon as IconName] : null;
        const cls = EMBED_PALETTE[item.variant ?? "default"] ?? EMBED_PALETTE.default;
        return (
          <span
            key={item.id}
            className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] font-medium shrink-0",
              cls,
            )}
          >
            {IC && <IC size={9} />}
            {item.label || "Action"}
          </span>
        );
      })}
      {rest > 0 && <span className="text-[9px] text-muted/60">+{rest}</span>}
    </div>
  );
}

// ── ActionBarInspector ──────────────────────────────────────────────────────
// Inspector cho component "actionbar" và phần nhúng trong list / form / detail.
interface ActionBarInspectorProps {
  items: ActionBarItem[];
  align: "left" | "right" | "between";
  embedded?: boolean;
  onChange: (items: ActionBarItem[], align: "left" | "right" | "between") => void;
}
function ActionBarInspector({ items, align, embedded = false, onChange }: ActionBarInspectorProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const setItems = (next: ActionBarItem[]) => onChange(next, align);
  const setAlign = (a: "left" | "right" | "between") => onChange(items, a);

  const addItem = () => {
    const id = `ab_${Math.random().toString(36).slice(2, 7)}`;
    const newItem: ActionBarItem = {
      id,
      label: "Hành động",
      variant: "default" as ActionVariant,
      steps: [],
    };
    const next = [...items, newItem];
    setItems(next);
    setExpandedId(id);
  };

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const updateItem = (id: string, next: ActionConfig) => {
    setItems(items.map((item) => (item.id === id ? { ...next, id } : item)));
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    const a = next[idx];
    const b = next[j];
    if (!a || !b) return;
    next[idx] = b;
    next[j] = a;
    setItems(next);
  };

  const variantDot = (v?: string) =>
    ({ primary: "bg-accent", danger: "bg-danger", ghost: "bg-muted/30", default: "bg-muted/50" })[
      v ?? "default"
    ] ?? "bg-muted/50";

  return (
    <div className="space-y-2">
      {!embedded && (
        <FormField label="Căn chỉnh">
          <Select
            value={align}
            onChange={(e) => setAlign(e.target.value as "left" | "right" | "between")}
          >
            <option value="left">Trái</option>
            <option value="right">Phải</option>
            <option value="between">Dàn đều</option>
          </Select>
        </FormField>
      )}

      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">
          {embedded ? "Hành động nhúng" : "Hành động"}
        </div>
        <button
          type="button"
          onClick={addItem}
          className="flex items-center gap-0.5 text-[10px] text-accent hover:underline"
        >
          <I.Plus size={10} /> Thêm
        </button>
      </div>

      {items.length === 0 && (
        <div className="text-[11px] text-muted/60 text-center py-2 border border-dashed border-border/50 rounded-md">
          Chưa có hành động
        </div>
      )}

      <div className="space-y-1">
        {items.map((item, idx) => (
          <div key={item.id} className="border border-border rounded-md overflow-hidden">
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-bg-soft">
              <span className={cn("w-2 h-2 rounded-sm shrink-0", variantDot(item.variant))} />
              <input
                className="flex-1 bg-transparent outline-none min-w-0 text-xs"
                value={item.label}
                placeholder="Nhãn"
                onChange={(e) => updateItem(item.id, { ...item, label: e.target.value })}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                onClick={() => moveItem(idx, -1)}
                disabled={idx === 0}
                className="text-muted hover:text-text disabled:opacity-20"
              >
                <I.ChevronUp size={10} />
              </button>
              <button
                type="button"
                onClick={() => moveItem(idx, 1)}
                disabled={idx === items.length - 1}
                className="text-muted hover:text-text disabled:opacity-20"
              >
                <I.ChevronDown size={10} />
              </button>
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                className="text-muted hover:text-text"
                title="Cấu hình bước"
              >
                {expandedId === item.id ? <I.ChevronUp size={11} /> : <I.ChevronDown size={11} />}
              </button>
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="hover:text-danger text-muted"
              >
                <I.X size={10} />
              </button>
            </div>
            {expandedId === item.id && (
              <div className="border-t border-border">
                <ActionInspector config={item} onChange={(next) => updateItem(item.id, next)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
