import { useEffect, useMemo, useRef, useState } from "react";
import { ActionInspector } from "@/components/designer/ActionInspector";
import { AiAssistDrawer } from "@/components/designer/AiAssistDrawer";
import { ComponentCard } from "@/components/designer/canvas/canvas-preview";
import {
  addGridCol,
  addGridRow,
  cellAt,
  mergeDown,
  mergeRight,
  migrateToGrid,
  removeGridCol,
  removeGridRow,
  type SplitGridCell,
  type SplitGridConfig,
  splitCell,
} from "@/components/designer/grid-layout";
import { BandInspector } from "@/components/designer/inspectors/BandInspector";
import { ChungInspector } from "@/components/designer/inspectors/ChungInspector";
import { DieukienInspector } from "@/components/designer/inspectors/DieukienInspector";
import { DulieuInspector } from "@/components/designer/inspectors/DulieuInspector";
import { FilterBuilder } from "@/components/designer/inspectors/FilterBuilder";
import {
  ActionBarInspector,
  tabsForKind,
} from "@/components/designer/inspectors/inspector-helpers";
import { MobileDesignerNotice } from "@/components/designer/MobileDesignerNotice";
import {
  type ActionBarItem,
  type ComponentKind,
  PALETTE,
  type PageComponent,
} from "@/components/designer/page-designer-constants";
import { FieldDisplayToggle, fieldBoth } from "@/components/FieldDisplayToggle";
import { I } from "@/components/Icons";
import { PageStatusPicker } from "@/components/PageStatusFlag";
import { ConsumerPage } from "@/components/renderer/ConsumerPage";
import { ROW_ACTION_OPTIONS } from "@/components/renderer/RowActionsCell";
import { Button, EmptyState, FormField, Input, Select, Switch } from "@/components/ui";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useMcpClient } from "@/hooks/useMcpClient";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useShortcut } from "@/hooks/useShortcut";
import { useT } from "@/hooks/useT";
import { useUndoable } from "@/hooks/useUndoable";
import type { PageDesign } from "@/lib/ai-design-prompts";
import { applyInsertAndResolve } from "@/lib/page-layout";
import { collectStateSources, type StateSource } from "@/lib/page-state-sources";
import { cn } from "@/lib/utils";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";
import type { ActionConfig, FilterNode } from "@/types/page";

interface Props {
  pageId: string;
}

export function PageDesigner({ pageId }: Props) {
  const t = useT();
  const isMobile = useIsMobile();
  const inspectorVisible = useUI((s) => s.inspectorVisible);
  const setInspectorVisible = useUI((s) => s.setInspectorVisible);

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
  const [pageMeta, setPageMeta] = useState<{ screenFit?: boolean }>({});
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
  const [splitCellSel, setSplitCellSel] = useState<string | null>(null);
  const [splitPanelTab, setSplitPanelTab] = useState("A");
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
    if (Array.isArray(stored)) {
      setComponents(stored as PageComponent[]);
      // Trang cũ (mảng thuần) chưa có meta → bật screenFit mặc định.
      setPageMeta({ screenFit: true });
    } else if (stored && typeof stored === "object" && "components" in stored) {
      // Format mới: { meta, components }
      const s = stored as { meta?: { screenFit?: boolean }; components?: PageComponent[] };
      setComponents(s.components ?? []);
      // Nếu meta.screenFit chưa khai báo tường minh → mặc định true.
      setPageMeta({ screenFit: true, ...(s.meta ?? {}) });
    }
    // Trang mới / chưa có nội dung (content = {} hoặc undefined) → canvas
    // TRẮNG, screenFit bật mặc định cho trang mới.
    else {
      setComponents([]);
      setPageMeta({ screenFit: true });
    }
  }, [pageId, ready]);

  // Reset selection khi chuyển page
  // biome-ignore lint/correctness/useExhaustiveDependencies: chủ ý chỉ reset khi pageId đổi, setSelected setter ổn định
  useEffect(() => {
    setSelected(null);
  }, [pageId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: splitCellSel intentionally not in deps
  useEffect(() => {
    setSplitCellSel(null);
  }, [selected]);

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
    setPageContent(pageId, { meta: pageMeta, components });
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
    setPageContent(pageId, { meta: pageMeta, components });
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
          title="AI Assist"
        />
        <Button
          variant="ghost"
          size="sm"
          icon={<I.Undo size={13} />}
          onClick={undo}
          disabled={!canUndo}
          title={`${t("designer.undo")} (Ctrl+Z)`}
        />
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
            if (!previewMode) setPageContent(pageId, { meta: pageMeta, components });
            setPreviewMode((v) => !v);
          }}
          title={previewMode ? t("designer.exit_preview") : t("designer.preview")}
        />
        <Button
          variant="primary"
          size="sm"
          icon={<I.Save size={13} />}
          onClick={save}
          title={t("designer.save_with_shortcut")}
        />
        {saved && (
          <span className="text-xs text-success flex items-center gap-1">
            <I.Check size={11} /> {t("designer.saved")}
          </span>
        )}
        {/* Cờ trạng thái — gắn/đổi/gỡ + quản lý cờ tùy chỉnh */}
        <PageStatusPicker pageId={pageId} status={page?.status} align="right" />
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
        <FieldDisplayToggle />
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
          onClick={(e) => {
            // Click khoảng trống (không phải lên widget) → bỏ chọn + mở thuộc tính trang.
            const hit = (e.target as HTMLElement).closest("[data-comp-id]");
            if (!hit) setSelected(null);
          }}
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
                  onSplitPanelDrop={
                    c.kind === "split"
                      ? (panelKey, srcId) => {
                          const src = components.find((cc) => cc.id === srcId);
                          if (!src) return;
                          const pKey = `panel${panelKey}` as "panelA" | "panelB" | "panelC";
                          const existing = (c.config[pKey] ?? {}) as Record<string, unknown>;
                          update(c.id, {
                            config: {
                              ...c.config,
                              [pKey]: {
                                ...src.config,
                                linkField: existing.linkField,
                                kind: src.kind,
                              },
                            },
                          });
                          setSelected(c.id);
                        }
                      : c.kind === "grid"
                        ? (cellId, srcId) => {
                            const src = components.find((cc) => cc.id === srcId);
                            if (!src) return;
                            const gridCfg = migrateToGrid(c.config as Record<string, unknown>);
                            const updatedCells = gridCfg.cells.map((cell) =>
                              cell.id === cellId
                                ? {
                                    ...cell,
                                    kind: src.kind,
                                    entity: src.config.entity as string | undefined,
                                    dataSourceId: src.config.dataSourceId as string | undefined,
                                    title: src.config.title as string | undefined,
                                    fields: src.config.fields as string[] | undefined,
                                    columnLabels: src.config.columnLabels as
                                      | Record<string, string>
                                      | undefined,
                                    columnGroups: src.config.columnGroups as unknown[],
                                    serverPaging: src.config.serverPaging as boolean | undefined,
                                    editable: src.config.editable as boolean | undefined,
                                    batchEdit: src.config.batchEdit as boolean | undefined,
                                    excelMode: src.config.excelMode as boolean | undefined,
                                    multiSelect: src.config.multiSelect as boolean | undefined,
                                    loadGate: src.config.loadGate as string | undefined,
                                    rowLimit: src.config.rowLimit as number | undefined,
                                    pageSize: src.config.pageSize as number | undefined,
                                    defaultSort: src.config.defaultSort as
                                      | { field: string; dir: "asc" | "desc" }
                                      | undefined,
                                    embeddedActions: src.config.embeddedActions as
                                      | ActionBarItem[]
                                      | undefined,
                                    rowActionsBuiltin: src.config.rowActionsBuiltin as
                                      | boolean
                                      | undefined,
                                    rowActionsHidden: src.config.rowActionsHidden as
                                      | string[]
                                      | undefined,
                                    rowActionsStyle: src.config.rowActionsStyle as
                                      | "inline"
                                      | "popover"
                                      | undefined,
                                  }
                                : cell,
                            );
                            update(c.id, { config: { ...gridCfg, cells: updatedCells } });
                            setSelected(c.id);
                          }
                        : undefined
                  }
                  onSplitCellClick={
                    c.kind === "grid"
                      ? (cellId) => {
                          setSplitCellSel(cellId);
                          setSelected(c.id);
                        }
                      : undefined
                  }
                  splitCellSelId={c.kind === "grid" && selected === c.id ? splitCellSel : null}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Inspector */}
        {inspectorVisible && (
          <aside className="w-[280px] shrink-0 border-l border-border bg-panel flex flex-col">
            <div className="h-8 shrink-0 px-2 flex items-center justify-between border-b border-border text-xs font-semibold text-muted">
              {t("designer.inspector")}
              {sel && (
                <button
                  type="button"
                  onClick={() => remove(sel.id)}
                  title={t("designer.delete_component")}
                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-danger/15 hover:text-danger transition-colors"
                >
                  <I.Trash size={12} />
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
                    <ChungInspector sel={sel} update={update} setInspTab={setInspTab} />
                  )}
                  {/* Tải dữ liệu — số dòng + điều kiện + cổng (mọi widget record-list) */}
                  {/* Chọn nguồn bind: Entity hoặc Nguồn dữ liệu (datasource) */}
                  {inspTab === "dulieu" && (
                    <DulieuInspector
                      sel={sel}
                      update={update}
                      stateSources={stateSources}
                      ensureMasterEmits={ensureMasterEmits}
                    />
                  )}

                  {/* ── Dải cột (banded header) — chỉ List ── */}
                  {inspTab === "band" && sel.kind === "list" && (
                    <BandInspector sel={sel} update={update} />
                  )}

                  {/* ── Input control components ── */}
                  {inspTab === "dieukien" &&
                    (sel.kind === "search" ||
                      sel.kind === "combobox" ||
                      sel.kind === "listbox" ||
                      sel.kind === "tagbox") && <DieukienInspector sel={sel} update={update} />}

                  {/* ── Split Grid config (N×M) ── */}
                  {/* ── Split Panel cũ (2–3 panel, drag-resize) ── */}
                  {inspTab === "bocuc" &&
                    sel.kind === "split" &&
                    (() => {
                      type PanelCfg = {
                        kind?: string;
                        entity?: string;
                        title?: string;
                        linkField?: string;
                        sourceField?: string;
                        sourceFields?: string[];
                        filterFromPanel?: string; // "a"|"b"|"c"|"d"
                        linkConditions?: Array<{
                          fromPanel?: string;
                          fromField?: string;
                          toField: string;
                        }>;
                        // list
                        editable?: boolean;
                        selectable?: boolean;
                        batchEdit?: boolean;
                        excelMode?: boolean;
                        serverPaging?: boolean;
                        multiSelect?: boolean;
                        rowLimit?: number;
                        addRowAtEnd?: boolean;
                        addRowPos?: string;
                        embeddedActions?: ActionBarItem[];
                        rowActionsBuiltin?: boolean;
                        rowActionsHidden?: string[];
                        rowActionsStyle?: "inline" | "popover";
                        loadFilters?: Record<
                          string,
                          { op: string; value: string | number | boolean }
                        >;
                        // chart
                        chartKind?: string;
                        groupBy?: string;
                        valueField?: string;
                      };
                      const splitCfg = sel.config as {
                        orientation?:
                          | "h"
                          | "v"
                          | "both"
                          | "both2"
                          | "both3"
                          | "both4"
                          | "both5"
                          | "tabs";
                        count?: number;
                        ratio?: number;
                        ratioV?: number;
                        ratioV2?: number;
                        panelA?: PanelCfg;
                        panelB?: PanelCfg;
                        panelC?: PanelCfg;
                        panelD?: PanelCfg;
                      };
                      const panelA = splitCfg.panelA ?? {};
                      const panelB = splitCfg.panelB ?? {};
                      const panelC = splitCfg.panelC ?? {};
                      const panelD = splitCfg.panelD ?? {};
                      const orientation = splitCfg.orientation ?? "h";
                      const count = splitCfg.count ?? 2;
                      const ratio = splitCfg.ratio ?? 40;
                      const ratioV = splitCfg.ratioV ?? 50;
                      const isCombo = orientation === "both" || orientation === "both2";
                      const isBoth3 = orientation === "both3";
                      const isBoth4 = orientation === "both4";
                      const isBoth5 = orientation === "both5";
                      const showPanelC = isCombo || isBoth3 || isBoth4 || isBoth5 || count >= 3;
                      const showPanelD = isBoth3;
                      const subKinds = ["list", "detail", "form", "chart", "kanban"];
                      const updateSplit = (patch: typeof splitCfg) =>
                        update(sel.id, { config: { ...sel.config, ...patch } });
                      const entC = entities.find((e) => e.id === panelC.entity);
                      // existingPanelKeys + sourcesFor: tính danh sách panel có thể lọc từ
                      const existingPanelKeys = ["A", "B"];
                      if (showPanelC) existingPanelKeys.push("C");
                      if (showPanelD) existingPanelKeys.push("D");
                      const panelByKey: Record<string, typeof panelA> = {
                        a: panelA,
                        b: panelB,
                        c: panelC,
                        d: panelD,
                      };
                      const sourcesFor = (panelKey: string) =>
                        existingPanelKeys
                          .filter((k) => k !== panelKey)
                          .map((k) => ({
                            key: k.toLowerCase(),
                            label: panelLabel(k),
                            entityId: panelByKey[k.toLowerCase()]?.entity,
                          }));

                      const PanelFields = ({
                        panel,
                        availableSources,
                        linkedEnt,
                        defaultKind = "list",
                        onUpdate,
                      }: {
                        panel: PanelCfg;
                        availableSources: Array<{ key: string; label: string; entityId?: string }>;
                        linkedEnt?: (typeof entities)[0];
                        defaultKind?: string;
                        onUpdate: (p: PanelCfg) => void;
                      }) => {
                        const srcKey = panel.filterFromPanel ?? availableSources[0]?.key ?? "a";
                        const srcLabel =
                          availableSources.find((s) => s.key === srcKey)?.label ??
                          `Panel ${srcKey.toUpperCase()}`;
                        return (
                          <>
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
                              <div className="flex gap-1 items-center">
                                <SearchableSelect
                                  value={panel.entity ?? ""}
                                  onChange={(v) => onUpdate({ ...panel, entity: v })}
                                  emptyOption="— chọn entity —"
                                  options={[...entities]
                                    .sort((a, b) => a.name.localeCompare(b.name, "vi"))
                                    .map((e) => ({ value: e.id, label: e.name }))}
                                  className="flex-1 min-w-0"
                                />
                                <button
                                  type="button"
                                  title="Mở entity"
                                  disabled={!panel.entity}
                                  onClick={() =>
                                    window.open(
                                      `/entities/${panel.entity}`,
                                      "_blank",
                                      "noopener,noreferrer",
                                    )
                                  }
                                  className="shrink-0 w-7 h-7 rounded border border-border flex items-center justify-center hover:bg-hover disabled:opacity-40 text-muted"
                                >
                                  <I.ExternalLink size={12} />
                                </button>
                              </div>
                            </FormField>
                            <FormField label="Tiêu đề">
                              <Input
                                placeholder="Để trống = tên entity"
                                value={panel.title ?? ""}
                                onChange={(e) => onUpdate({ ...panel, title: e.target.value })}
                              />
                            </FormField>
                            {availableSources.length > 0 && (
                              <FormField label="Lọc từ">
                                <Select
                                  value={srcKey}
                                  onChange={(e) =>
                                    onUpdate({ ...panel, filterFromPanel: e.target.value })
                                  }
                                >
                                  {availableSources.map((s) => (
                                    <option key={s.key} value={s.key}>
                                      {s.label}
                                    </option>
                                  ))}
                                </Select>
                              </FormField>
                            )}
                            {/* Trường lọc đơn — nhanh cho master-detail 1 field */}
                            {availableSources.length > 0 &&
                              (panel.kind === "list" ||
                                panel.kind === "chart" ||
                                panel.kind === "kanban" ||
                                panel.kind === "form" ||
                                (!panel.kind &&
                                  (defaultKind === "list" ||
                                    defaultKind === "chart" ||
                                    defaultKind === "kanban"))) && (
                                <FormField label="Trường lọc">
                                  <Select
                                    value={panel.linkField ?? ""}
                                    onChange={(e) =>
                                      onUpdate({ ...panel, linkField: e.target.value || undefined })
                                    }
                                  >
                                    <option value="">— không dùng —</option>
                                    {(linkedEnt?.fields ?? []).map((f) => (
                                      <option key={f.name} value={f.name}>
                                        {fieldBoth(f)}
                                      </option>
                                    ))}
                                  </Select>
                                </FormField>
                              )}
                            {/* ── Cột phát (nhiều) — list panel phát nhiều field vào state ── */}
                            {(panel.kind === "list" || (!panel.kind && defaultKind === "list")) && (
                              <div className="flex flex-col gap-1">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted/60 mt-1">
                                  Cột phát khi chọn dòng
                                </div>
                                {(panel.sourceFields ?? []).map((sf, i) => (
                                  <div
                                    key={sf}
                                    className="flex items-center gap-1 text-xs bg-panel-2 px-2 py-0.5 rounded"
                                  >
                                    <span className="flex-1 font-mono">{sf}</span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onUpdate({
                                          ...panel,
                                          sourceFields: (panel.sourceFields ?? []).filter(
                                            (_, j) => j !== i,
                                          ),
                                        })
                                      }
                                      className="text-muted hover:text-danger"
                                    >
                                      <I.X size={10} />
                                    </button>
                                  </div>
                                ))}
                                {linkedEnt ? (
                                  <Select
                                    value=""
                                    onChange={(e) => {
                                      if (!e.target.value) return;
                                      const cur = panel.sourceFields ?? [];
                                      if (!cur.includes(e.target.value))
                                        onUpdate({
                                          ...panel,
                                          sourceFields: [...cur, e.target.value],
                                        });
                                    }}
                                  >
                                    <option value="">+ Thêm cột phát…</option>
                                    {linkedEnt.fields
                                      .filter((f) => !(panel.sourceFields ?? []).includes(f.name))
                                      .map((f) => (
                                        <option key={f.name} value={f.name}>
                                          {fieldBoth(f)}
                                        </option>
                                      ))}
                                  </Select>
                                ) : (
                                  <div className="text-[11px] text-muted italic">
                                    Bind entity để chọn cột phát
                                  </div>
                                )}
                              </div>
                            )}
                            {/* ── Điều kiện lọc (nhiều) — AND của các cột phát từ panel khác ── */}
                            {availableSources.length > 0 &&
                              (panel.kind === "list" ||
                                panel.kind === "chart" ||
                                panel.kind === "kanban" ||
                                panel.kind === "form") && (
                                <div className="flex flex-col gap-1">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted/60 mt-1">
                                    Điều kiện lọc (AND)
                                  </div>
                                  {(panel.linkConditions ?? []).map((cond, i) => {
                                    const fp = cond.fromPanel ?? availableSources[0]?.key ?? "a";
                                    const srcEnt = entities.find(
                                      (e) => e.id === panelByKey[fp]?.entity,
                                    );
                                    const srcEmitFields = panelByKey[fp]?.sourceFields ?? [];
                                    const condKey = `${fp}:${cond.fromField ?? "main"}:${cond.toField}`;
                                    return (
                                      <div
                                        key={condKey}
                                        className="flex flex-col gap-1 border border-border rounded p-1.5 text-xs"
                                      >
                                        <div className="flex items-center gap-1">
                                          <Select
                                            value={fp}
                                            onChange={(e) =>
                                              onUpdate({
                                                ...panel,
                                                linkConditions: (panel.linkConditions ?? []).map(
                                                  (c, j) =>
                                                    j === i
                                                      ? {
                                                          ...c,
                                                          fromPanel: e.target.value,
                                                          fromField: undefined,
                                                        }
                                                      : c,
                                                ),
                                              })
                                            }
                                          >
                                            {availableSources.map((s) => (
                                              <option key={s.key} value={s.key}>
                                                {s.label}
                                              </option>
                                            ))}
                                          </Select>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              onUpdate({
                                                ...panel,
                                                linkConditions: (panel.linkConditions ?? []).filter(
                                                  (_, j) => j !== i,
                                                ),
                                              })
                                            }
                                            className="shrink-0 text-muted hover:text-danger"
                                          >
                                            <I.X size={10} />
                                          </button>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <span className="text-muted/60 shrink-0 text-[10px]">
                                            cột phát:
                                          </span>
                                          <Select
                                            value={cond.fromField ?? ""}
                                            onChange={(e) =>
                                              onUpdate({
                                                ...panel,
                                                linkConditions: (panel.linkConditions ?? []).map(
                                                  (c, j) =>
                                                    j === i
                                                      ? {
                                                          ...c,
                                                          fromField: e.target.value || undefined,
                                                        }
                                                      : c,
                                                ),
                                              })
                                            }
                                          >
                                            <option value="">(chọn dòng chính)</option>
                                            {srcEmitFields.map((f) => {
                                              const ef = srcEnt?.fields.find((x) => x.name === f);
                                              return (
                                                <option key={f} value={f}>
                                                  {ef ? fieldBoth(ef) : f}
                                                </option>
                                              );
                                            })}
                                          </Select>
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <span className="text-muted/60 shrink-0 text-[10px]">
                                            → cột lọc:
                                          </span>
                                          {linkedEnt ? (
                                            <Select
                                              value={cond.toField}
                                              onChange={(e) =>
                                                onUpdate({
                                                  ...panel,
                                                  linkConditions: (panel.linkConditions ?? []).map(
                                                    (c, j) =>
                                                      j === i
                                                        ? { ...c, toField: e.target.value }
                                                        : c,
                                                  ),
                                                })
                                              }
                                            >
                                              <option value="">— chọn field —</option>
                                              {linkedEnt.fields.map((f) => (
                                                <option key={f.name} value={f.name}>
                                                  {fieldBoth(f)}
                                                  {f.type === "lookup" || f.type === "multi-lookup"
                                                    ? " ↗"
                                                    : ""}
                                                </option>
                                              ))}
                                            </Select>
                                          ) : (
                                            <span className="text-muted italic">
                                              Bind entity trước
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onUpdate({
                                        ...panel,
                                        linkConditions: [
                                          ...(panel.linkConditions ?? []),
                                          {
                                            fromPanel: availableSources[0]?.key,
                                            toField: "",
                                          },
                                        ],
                                      })
                                    }
                                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-text border border-dashed border-border rounded px-2 py-0.5 mt-0.5"
                                  >
                                    <I.Plus size={10} /> Thêm điều kiện
                                  </button>
                                </div>
                              )}
                            {panel.kind === "detail" && availableSources.length > 0 && (
                              <div className="text-[11px] text-muted italic px-1">
                                Hiển thị record chọn từ {srcLabel}
                              </div>
                            )}

                            {/* ── Tuỳ chọn theo loại ─────────────────── */}
                            {(panel.kind === "list" || (!panel.kind && defaultKind === "list")) && (
                              <div className="flex flex-col gap-1.5">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted/60 mt-1">
                                  Tuỳ chọn bảng
                                </div>
                                {(
                                  [
                                    ["editable", "Có thể sửa", null],
                                    ["selectable", "Chọn dòng (checkbox)", null],
                                    ["multiSelect", "Chọn nhiều dòng", null],
                                    ["excelMode", "Chế độ Excel", null],
                                    ["serverPaging", "Phân trang server", null],
                                  ] as [keyof PanelCfg, string, string | null][]
                                ).map(([key, label]) => (
                                  <div key={key} className="flex items-center justify-between">
                                    <span className="text-xs">{label}</span>
                                    <Switch
                                      checked={panel[key] === true}
                                      onChange={(v) => {
                                        const extra: Partial<PanelCfg> =
                                          key === "excelMode" && v
                                            ? { serverPaging: false }
                                            : key === "serverPaging" && v
                                              ? { excelMode: false }
                                              : {};
                                        onUpdate({ ...panel, [key]: v, ...extra });
                                      }}
                                    />
                                  </div>
                                ))}
                                {panel.editable === true && (
                                  <div className="flex items-center justify-between ml-3">
                                    <span className="text-xs">Batch edit</span>
                                    <Switch
                                      checked={panel.batchEdit === true}
                                      onChange={(v) => onUpdate({ ...panel, batchEdit: v })}
                                    />
                                  </div>
                                )}
                                {panel.editable === true && panel.batchEdit === true && (
                                  <div className="flex items-center justify-between ml-3">
                                    <span className="text-xs">Thêm dòng mới</span>
                                    <Switch
                                      checked={panel.addRowAtEnd === true}
                                      onChange={(v) => onUpdate({ ...panel, addRowAtEnd: v })}
                                    />
                                  </div>
                                )}
                                <FormField label="Giới hạn dòng">
                                  <Input
                                    type="number"
                                    placeholder="Mặc định 500"
                                    value={panel.rowLimit ?? ""}
                                    onChange={(e) =>
                                      onUpdate({
                                        ...panel,
                                        rowLimit: e.target.value
                                          ? Number(e.target.value)
                                          : undefined,
                                      })
                                    }
                                  />
                                </FormField>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs">Cột hành động</span>
                                  <Switch
                                    checked={panel.rowActionsBuiltin === true}
                                    onChange={(v) => onUpdate({ ...panel, rowActionsBuiltin: v })}
                                  />
                                </div>
                                {panel.rowActionsBuiltin === true && (
                                  <>
                                    <FormField label="Kiểu hiển thị">
                                      <Select
                                        value={panel.rowActionsStyle ?? "inline"}
                                        onChange={(e) =>
                                          onUpdate({
                                            ...panel,
                                            rowActionsStyle: e.target.value as "inline" | "popover",
                                          })
                                        }
                                      >
                                        <option value="inline">Inline (nút Xem · Sửa · Xoá)</option>
                                        <option value="popover">Popover (nút ⋯ gọn)</option>
                                      </Select>
                                    </FormField>
                                    {(panel.rowActionsStyle ?? "inline") === "popover" && (
                                      <div className="p-2.5 rounded-md border border-border bg-bg-soft">
                                        <div className="text-sm mb-0.5">Nút hiện trên popover</div>
                                        <div className="text-[11px] text-muted mb-2">
                                          Bỏ tích để ẩn nút khỏi popover ⋯
                                        </div>
                                        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                                          {ROW_ACTION_OPTIONS.map((opt) => {
                                            const hidden = panel.rowActionsHidden ?? [];
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
                                                    const next = e.target.checked
                                                      ? hidden.filter((key) => key !== opt.key)
                                                      : [...hidden, opt.key];
                                                    onUpdate({
                                                      ...panel,
                                                      rowActionsHidden: next,
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

                            {(panel.kind === "list" ||
                              panel.kind === "form" ||
                              panel.kind === "detail" ||
                              (!panel.kind && defaultKind === "list")) && (
                              <div className="pt-2 border-t border-border/40">
                                <ActionBarInspector
                                  items={panel.embeddedActions ?? []}
                                  align="left"
                                  embedded
                                  onChange={(items) =>
                                    onUpdate({ ...panel, embeddedActions: items })
                                  }
                                />
                              </div>
                            )}

                            {panel.kind === "chart" && (
                              <div className="flex flex-col gap-1.5">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted/60 mt-1">
                                  Cấu hình biểu đồ
                                </div>
                                <FormField label="Loại">
                                  <Select
                                    value={panel.chartKind ?? "bar"}
                                    onChange={(e) =>
                                      onUpdate({ ...panel, chartKind: e.target.value })
                                    }
                                  >
                                    <option value="bar">Bar</option>
                                    <option value="line">Line</option>
                                    <option value="area">Area</option>
                                    <option value="pie">Pie</option>
                                    <option value="doughnut">Doughnut</option>
                                  </Select>
                                </FormField>
                                <FormField label="Field nhóm">
                                  <Select
                                    value={panel.groupBy ?? ""}
                                    onChange={(e) =>
                                      onUpdate({
                                        ...panel,
                                        groupBy: e.target.value || undefined,
                                      })
                                    }
                                  >
                                    <option value="">— chọn field —</option>
                                    {(linkedEnt?.fields ?? []).map((f) => (
                                      <option key={f.name} value={f.name}>
                                        {fieldBoth(f)}
                                      </option>
                                    ))}
                                  </Select>
                                </FormField>
                                <FormField label="Field giá trị">
                                  <Select
                                    value={panel.valueField ?? ""}
                                    onChange={(e) =>
                                      onUpdate({
                                        ...panel,
                                        valueField: e.target.value || undefined,
                                      })
                                    }
                                  >
                                    <option value="">Đếm số bản ghi</option>
                                    {(linkedEnt?.fields ?? [])
                                      .filter((f) => ["number", "currency"].includes(f.type))
                                      .map((f) => (
                                        <option key={f.name} value={f.name}>
                                          {fieldBoth(f)}
                                        </option>
                                      ))}
                                  </Select>
                                </FormField>
                              </div>
                            )}

                            {panel.kind === "kanban" && (
                              <div className="flex flex-col gap-1.5">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted/60 mt-1">
                                  Cấu hình Kanban
                                </div>
                                <FormField label="Field nhóm cột">
                                  <Select
                                    value={panel.groupBy ?? ""}
                                    onChange={(e) =>
                                      onUpdate({
                                        ...panel,
                                        groupBy: e.target.value || undefined,
                                      })
                                    }
                                  >
                                    <option value="">— chọn field —</option>
                                    {(linkedEnt?.fields ?? []).map((f) => (
                                      <option key={f.name} value={f.name}>
                                        {fieldBoth(f)}
                                      </option>
                                    ))}
                                  </Select>
                                </FormField>
                              </div>
                            )}
                          </>
                        );
                      };

                      const panelLabel = (key: string) =>
                        orientation === "tabs" ? `Tab ${key}` : `Panel ${key}`;

                      return (
                        <>
                          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mt-1">
                            Layout
                          </div>
                          <FormField label="Hướng">
                            <Select
                              value={orientation}
                              onChange={(e) =>
                                updateSplit({
                                  orientation: e.target.value as
                                    | "h"
                                    | "v"
                                    | "both"
                                    | "both2"
                                    | "both3"
                                    | "both4"
                                    | "both5"
                                    | "tabs",
                                })
                              }
                            >
                              <option value="h">Ngang (trái | phải)</option>
                              <option value="v">Dọc (trên / dưới)</option>
                              <option value="both">A | (B trên / C dưới)</option>
                              <option value="both2">(A trên / B dưới) | C</option>
                              <option value="both3">(A/B) | (C/D)</option>
                              <option value="both4">A trên / (B trái | C phải)</option>
                              <option value="both5">(A trái | B phải) / C dưới</option>
                              <option value="tabs">Dạng Tab</option>
                            </Select>
                          </FormField>
                          {!isCombo && !isBoth3 && !isBoth4 && !isBoth5 && (
                            <FormField label="Số panel">
                              <Select
                                value={count}
                                onChange={(e) =>
                                  updateSplit({ count: Number(e.target.value) as 2 | 3 })
                                }
                              >
                                <option value={2}>2</option>
                                <option value={3}>3</option>
                              </Select>
                            </FormField>
                          )}
                          {(orientation === "h" || orientation === "v") && count === 2 && (
                            <FormField label={`Tỉ lệ A: ${ratio}%`}>
                              <input
                                type="range"
                                min={20}
                                max={80}
                                value={ratio}
                                onChange={(e) => updateSplit({ ratio: Number(e.target.value) })}
                                className="w-full accent-accent"
                              />
                            </FormField>
                          )}
                          {(isCombo || isBoth3) && (
                            <>
                              <FormField label={`Tỉ lệ ngang: ${ratio}%`}>
                                <input
                                  type="range"
                                  min={20}
                                  max={80}
                                  value={ratio}
                                  onChange={(e) => updateSplit({ ratio: Number(e.target.value) })}
                                  className="w-full accent-accent"
                                />
                              </FormField>
                              <FormField label={`Tỉ lệ dọc A/B: ${ratioV}%`}>
                                <input
                                  type="range"
                                  min={20}
                                  max={80}
                                  value={ratioV}
                                  onChange={(e) => updateSplit({ ratioV: Number(e.target.value) })}
                                  className="w-full accent-accent"
                                />
                              </FormField>
                              {isBoth3 && (
                                <FormField label={`Tỉ lệ dọc C/D: ${splitCfg.ratioV2 ?? 50}%`}>
                                  <input
                                    type="range"
                                    min={20}
                                    max={80}
                                    value={splitCfg.ratioV2 ?? 50}
                                    onChange={(e) =>
                                      updateSplit({
                                        ratioV2: Number(e.target.value),
                                      } as typeof splitCfg)
                                    }
                                    className="w-full accent-accent"
                                  />
                                </FormField>
                              )}
                            </>
                          )}
                          {isBoth4 && (
                            <>
                              <FormField label={`Tỉ lệ dọc A/(B+C): ${ratio}%`}>
                                <input
                                  type="range"
                                  min={20}
                                  max={80}
                                  value={ratio}
                                  onChange={(e) => updateSplit({ ratio: Number(e.target.value) })}
                                  className="w-full accent-accent"
                                />
                              </FormField>
                              <FormField label={`Tỉ lệ ngang B/C: ${ratioV}%`}>
                                <input
                                  type="range"
                                  min={20}
                                  max={80}
                                  value={ratioV}
                                  onChange={(e) => updateSplit({ ratioV: Number(e.target.value) })}
                                  className="w-full accent-accent"
                                />
                              </FormField>
                            </>
                          )}
                          {isBoth5 && (
                            <>
                              <FormField label={`Tỉ lệ dọc (A+B)/C: ${ratio}%`}>
                                <input
                                  type="range"
                                  min={20}
                                  max={80}
                                  value={ratio}
                                  onChange={(e) => updateSplit({ ratio: Number(e.target.value) })}
                                  className="w-full accent-accent"
                                />
                              </FormField>
                              <FormField label={`Tỉ lệ ngang A/B: ${ratioV}%`}>
                                <input
                                  type="range"
                                  min={20}
                                  max={80}
                                  value={ratioV}
                                  onChange={(e) => updateSplit({ ratioV: Number(e.target.value) })}
                                  className="w-full accent-accent"
                                />
                              </FormField>
                            </>
                          )}
                          {/* Tab bar cho các panel */}
                          {(() => {
                            const activeTab = existingPanelKeys.includes(splitPanelTab)
                              ? splitPanelTab
                              : "A";
                            return (
                              <>
                                <div className="flex border border-border rounded-md overflow-hidden mt-2">
                                  {existingPanelKeys.map((k) => (
                                    <button
                                      key={k}
                                      type="button"
                                      onClick={() => setSplitPanelTab(k)}
                                      className={cn(
                                        "flex-1 py-1 text-xs font-medium transition-colors border-r border-border last:border-r-0",
                                        activeTab === k
                                          ? "bg-accent text-white"
                                          : "text-muted hover:bg-hover/60",
                                      )}
                                    >
                                      {panelLabel(k)}
                                    </button>
                                  ))}
                                </div>
                                {activeTab === "A" && (
                                  <PanelFields
                                    panel={panelA}
                                    availableSources={[]}
                                    linkedEnt={entities.find((e) => e.id === panelA.entity)}
                                    defaultKind="list"
                                    onUpdate={(p) => updateSplit({ panelA: p })}
                                  />
                                )}
                                {activeTab === "B" && (
                                  <PanelFields
                                    panel={panelB}
                                    availableSources={sourcesFor("B")}
                                    linkedEnt={entities.find((e) => e.id === panelB.entity)}
                                    defaultKind="detail"
                                    onUpdate={(p) => updateSplit({ panelB: p })}
                                  />
                                )}
                                {activeTab === "C" && showPanelC && (
                                  <PanelFields
                                    panel={panelC}
                                    availableSources={sourcesFor("C")}
                                    linkedEnt={entC}
                                    defaultKind="list"
                                    onUpdate={(p) => updateSplit({ panelC: p })}
                                  />
                                )}
                                {activeTab === "D" && showPanelD && (
                                  <PanelFields
                                    panel={panelD}
                                    availableSources={sourcesFor("D")}
                                    linkedEnt={entities.find((e) => e.id === panelD.entity)}
                                    defaultKind="list"
                                    onUpdate={(p) => updateSplit({ panelD: p } as typeof splitCfg)}
                                  />
                                )}
                              </>
                            );
                          })()}
                        </>
                      );
                    })()}

                  {/* ── Grid Layout N×M (gộp ô, per-cell config) ── */}
                  {inspTab === "bocuc" &&
                    sel.kind === "grid" &&
                    (() => {
                      const rawCfg = sel.config as Record<string, unknown>;
                      const gridCfg: SplitGridConfig = migrateToGrid(rawCfg);
                      const { cols, rows, cells } = gridCfg;
                      const selCell = splitCellSel
                        ? cells.find((c) => c.id === splitCellSel)
                        : null;

                      const updateGrid = (next: SplitGridConfig) =>
                        update(sel.id, { config: next });

                      const updateCell = (patch: Partial<SplitGridCell>) => {
                        if (!selCell) return;
                        updateGrid({
                          ...gridCfg,
                          cells: cells.map((c) => (c.id === selCell.id ? { ...c, ...patch } : c)),
                        });
                      };

                      const subKinds = ["list", "detail", "form", "chart", "kanban"];
                      const selEnt = selCell?.entity
                        ? entities.find((e) => e.id === selCell.entity)
                        : undefined;

                      // Build grid visual rows
                      const gridRows: Array<Array<SplitGridCell | null>> = [];
                      const rendered = new Set<string>();
                      for (let r = 1; r <= rows; r++) {
                        const rowCells: Array<SplitGridCell | null> = [];
                        for (let c = 1; c <= cols; c++) {
                          const cell = cellAt(cells, c, r);
                          if (cell && !rendered.has(cell.id) && cell.col === c && cell.row === r) {
                            rowCells.push(cell);
                            rendered.add(cell.id);
                          } else if (cell && rendered.has(cell.id)) {
                            // covered by spanning cell — skip (don't push)
                          } else {
                            rowCells.push(null);
                          }
                        }
                        gridRows.push(rowCells);
                      }

                      const gridLabel = (sel.config.label as string | undefined) ?? "";

                      return (
                        <div className="space-y-3 p-1">
                          <FormField label="Nhãn">
                            <Input
                              placeholder="Tiêu đề hiển thị (để trống = ẩn)"
                              value={gridLabel}
                              onChange={(e) =>
                                update(sel.id, {
                                  config: { ...sel.config, label: e.target.value || undefined },
                                })
                              }
                            />
                          </FormField>
                          {/* Grid size controls */}
                          <FormField label="Cột">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => updateGrid(removeGridCol(gridCfg))}
                                disabled={cols <= 1}
                                className="w-7 h-7 rounded border border-border flex items-center justify-center hover:bg-hover disabled:opacity-40"
                              >
                                <I.Minus size={12} />
                              </button>
                              <span className="text-sm font-medium w-6 text-center">{cols}</span>
                              <button
                                type="button"
                                onClick={() => updateGrid(addGridCol(gridCfg))}
                                disabled={cols >= 6}
                                className="w-7 h-7 rounded border border-border flex items-center justify-center hover:bg-hover disabled:opacity-40"
                              >
                                <I.Plus size={12} />
                              </button>
                              <span className="text-muted text-xs ml-2">Hàng:</span>
                              <button
                                type="button"
                                onClick={() => updateGrid(removeGridRow(gridCfg))}
                                disabled={rows <= 1}
                                className="w-7 h-7 rounded border border-border flex items-center justify-center hover:bg-hover disabled:opacity-40"
                              >
                                <I.Minus size={12} />
                              </button>
                              <span className="text-sm font-medium w-6 text-center">{rows}</span>
                              <button
                                type="button"
                                onClick={() => updateGrid(addGridRow(gridCfg))}
                                disabled={rows >= 6}
                                className="w-7 h-7 rounded border border-border flex items-center justify-center hover:bg-hover disabled:opacity-40"
                              >
                                <I.Plus size={12} />
                              </button>
                            </div>
                          </FormField>

                          {/* Grid visual */}
                          <div className="border border-border rounded overflow-hidden">
                            <table className="w-full border-collapse table-fixed">
                              <tbody>
                                {gridRows.map((row, ri) => (
                                  // biome-ignore lint/suspicious/noArrayIndexKey: row index stable
                                  <tr key={ri}>
                                    {row.map((cell, ci) =>
                                      cell ? (
                                        <td
                                          // biome-ignore lint/suspicious/noArrayIndexKey: ci stable within row
                                          key={ci}
                                          colSpan={cell.colSpan}
                                          rowSpan={cell.rowSpan}
                                          onClick={() => setSplitCellSel(cell.id)}
                                          className={cn(
                                            "border border-border/40 px-1.5 py-1 text-[10px] cursor-pointer select-none truncate transition-colors",
                                            splitCellSel === cell.id
                                              ? "bg-accent/20 text-accent font-medium"
                                              : "hover:bg-hover/50 text-muted",
                                          )}
                                        >
                                          {cell.entity
                                            ? (entities.find((e) => e.id === cell.entity)?.name ??
                                              "?")
                                            : cell.dataSourceId
                                              ? "DS"
                                              : `${cell.row},${cell.col}`}
                                        </td>
                                      ) : null,
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Merge / split tools */}
                          {selCell && (
                            <div className="flex gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => updateGrid(mergeRight(gridCfg, selCell.id))}
                                disabled={selCell.col + selCell.colSpan - 1 >= cols}
                                className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-hover disabled:opacity-40"
                              >
                                <I.ArrowRight size={11} /> Gộp phải
                              </button>
                              <button
                                type="button"
                                onClick={() => updateGrid(mergeDown(gridCfg, selCell.id))}
                                disabled={selCell.row + selCell.rowSpan - 1 >= rows}
                                className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-hover disabled:opacity-40"
                              >
                                <I.ArrowDown size={11} /> Gộp xuống
                              </button>
                              {(selCell.colSpan > 1 || selCell.rowSpan > 1) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateGrid(splitCell(gridCfg, selCell.id));
                                    setSplitCellSel(null);
                                  }}
                                  className="flex items-center gap-1 px-2 py-1 text-xs border border-border rounded hover:bg-hover text-warning border-warning/30"
                                >
                                  <I.X size={11} /> Tách ô
                                </button>
                              )}
                            </div>
                          )}

                          {/* Per-cell config */}
                          {selCell && (
                            <div className="border-t border-border pt-3 space-y-3">
                              <div className="text-xs font-semibold text-muted">
                                Ô {selCell.row},{selCell.col}
                                {(selCell.colSpan > 1 || selCell.rowSpan > 1) &&
                                  ` (span ${selCell.colSpan}×${selCell.rowSpan})`}
                              </div>
                              <FormField label="Loại">
                                <Select
                                  value={selCell.kind ?? "list"}
                                  onChange={(e) => updateCell({ kind: e.target.value })}
                                >
                                  {subKinds.map((k) => (
                                    <option key={k} value={k}>
                                      {k}
                                    </option>
                                  ))}
                                </Select>
                              </FormField>
                              <FormField label="Entity">
                                <div className="flex gap-1 items-center">
                                  <SearchableSelect
                                    value={selCell.entity ?? ""}
                                    onChange={(v) => updateCell({ entity: v || undefined })}
                                    emptyOption="— chọn entity —"
                                    options={[...entities]
                                      .sort((a, b) => a.name.localeCompare(b.name, "vi"))
                                      .map((e) => ({ value: e.id, label: e.name }))}
                                    className="flex-1 min-w-0"
                                  />
                                  <button
                                    type="button"
                                    title="Mở entity"
                                    disabled={!selCell.entity}
                                    onClick={() =>
                                      window.open(
                                        `/entities/${selCell.entity}`,
                                        "_blank",
                                        "noopener,noreferrer",
                                      )
                                    }
                                    className="shrink-0 w-7 h-7 rounded border border-border flex items-center justify-center hover:bg-hover disabled:opacity-40 text-muted"
                                  >
                                    <I.ExternalLink size={12} />
                                  </button>
                                </div>
                              </FormField>
                              <FormField label="Tiêu đề">
                                <Input
                                  value={selCell.title ?? ""}
                                  placeholder={selEnt?.name ?? ""}
                                  onChange={(e) =>
                                    updateCell({ title: e.target.value || undefined })
                                  }
                                />
                              </FormField>
                              {selCell.kind &&
                                ["detail", "form", "chart", "kanban"].includes(selCell.kind) &&
                                selEnt && (
                                  <FormField label="Field liên kết">
                                    <Select
                                      value={selCell.linkField ?? ""}
                                      onChange={(e) =>
                                        updateCell({ linkField: e.target.value || undefined })
                                      }
                                    >
                                      <option value="">— chọn field —</option>
                                      {selEnt.fields.map((f) => (
                                        <option key={f.name} value={f.name}>
                                          {fieldBoth(f)}
                                        </option>
                                      ))}
                                    </Select>
                                  </FormField>
                                )}

                              {/* ── Tuỳ chọn theo loại ─────────────── */}
                              {(selCell.kind === "list" || !selCell.kind) && (
                                <div className="flex flex-col gap-1.5 pt-1">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted/60">
                                    Tuỳ chọn bảng
                                  </div>
                                  {(
                                    [
                                      ["editable", "Có thể sửa"],
                                      ["selectable", "Chọn dòng (checkbox)"],
                                      ["multiSelect", "Chọn nhiều dòng"],
                                      ["excelMode", "Chế độ Excel"],
                                      ["serverPaging", "Phân trang server"],
                                    ] as [keyof SplitGridCell, string][]
                                  ).map(([key, label]) => (
                                    <div key={key} className="flex items-center justify-between">
                                      <span className="text-xs">{label}</span>
                                      <Switch
                                        checked={selCell[key] === true}
                                        onChange={(v) => {
                                          const extra: Partial<SplitGridCell> =
                                            key === "excelMode" && v
                                              ? { serverPaging: false }
                                              : key === "serverPaging" && v
                                                ? { excelMode: false }
                                                : {};
                                          updateCell({ [key]: v, ...extra });
                                        }}
                                      />
                                    </div>
                                  ))}
                                  {selCell.editable === true && (
                                    <div className="flex items-center justify-between ml-3">
                                      <span className="text-xs">Batch edit</span>
                                      <Switch
                                        checked={selCell.batchEdit === true}
                                        onChange={(v) => updateCell({ batchEdit: v })}
                                      />
                                    </div>
                                  )}
                                  {selCell.editable === true && selCell.batchEdit === true && (
                                    <div className="flex items-center justify-between ml-3">
                                      <span className="text-xs">Thêm dòng mới</span>
                                      <Switch
                                        checked={selCell.addRowAtEnd === true}
                                        onChange={(v) => updateCell({ addRowAtEnd: v })}
                                      />
                                    </div>
                                  )}
                                  <FormField label="Giới hạn dòng">
                                    <Input
                                      type="number"
                                      placeholder="Mặc định 500"
                                      value={selCell.rowLimit ?? ""}
                                      onChange={(e) =>
                                        updateCell({
                                          rowLimit: e.target.value
                                            ? Number(e.target.value)
                                            : undefined,
                                        })
                                      }
                                    />
                                  </FormField>
                                </div>
                              )}

                              {selCell.kind === "chart" && (
                                <div className="flex flex-col gap-1.5 pt-1">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted/60">
                                    Cấu hình biểu đồ
                                  </div>
                                  <FormField label="Loại">
                                    <Select
                                      value={selCell.chartKind ?? "bar"}
                                      onChange={(e) => updateCell({ chartKind: e.target.value })}
                                    >
                                      <option value="bar">Bar</option>
                                      <option value="line">Line</option>
                                      <option value="area">Area</option>
                                      <option value="pie">Pie</option>
                                      <option value="doughnut">Doughnut</option>
                                    </Select>
                                  </FormField>
                                  <FormField label="Field nhóm">
                                    <Select
                                      value={selCell.groupBy ?? ""}
                                      onChange={(e) =>
                                        updateCell({ groupBy: e.target.value || undefined })
                                      }
                                    >
                                      <option value="">— chọn field —</option>
                                      {(selEnt?.fields ?? []).map((f) => (
                                        <option key={f.name} value={f.name}>
                                          {fieldBoth(f)}
                                        </option>
                                      ))}
                                    </Select>
                                  </FormField>
                                  <FormField label="Field giá trị">
                                    <Select
                                      value={selCell.valueField ?? ""}
                                      onChange={(e) =>
                                        updateCell({ valueField: e.target.value || undefined })
                                      }
                                    >
                                      <option value="">Đếm số bản ghi</option>
                                      {(selEnt?.fields ?? [])
                                        .filter((f) => ["number", "currency"].includes(f.type))
                                        .map((f) => (
                                          <option key={f.name} value={f.name}>
                                            {fieldBoth(f)}
                                          </option>
                                        ))}
                                    </Select>
                                  </FormField>
                                </div>
                              )}

                              {selCell.kind === "kanban" && (
                                <div className="flex flex-col gap-1.5 pt-1">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted/60">
                                    Cấu hình Kanban
                                  </div>
                                  <FormField label="Field nhóm cột">
                                    <Select
                                      value={selCell.groupBy ?? ""}
                                      onChange={(e) =>
                                        updateCell({ groupBy: e.target.value || undefined })
                                      }
                                    >
                                      <option value="">— chọn field —</option>
                                      {(selEnt?.fields ?? []).map((f) => (
                                        <option key={f.name} value={f.name}>
                                          {fieldBoth(f)}
                                        </option>
                                      ))}
                                    </Select>
                                  </FormField>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
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
                      compact={sel.config.compact === true}
                      onChange={(items, align) =>
                        update(sel.id, { config: { ...sel.config, items, align } })
                      }
                      onCompactChange={(v) =>
                        update(sel.id, { config: { ...sel.config, compact: v || undefined } })
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
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="text-xs font-semibold text-muted uppercase tracking-wide">
                  Cài đặt trang
                </div>
                <FormField
                  label="Vừa 1 màn hình"
                  hint="Toàn bộ widget co giãn vừa chiều cao viewport. Mỗi widget chiếm tỷ lệ theo h. Bật khi trang có nhiều list theo chiều dọc."
                >
                  <Switch
                    checked={!!pageMeta.screenFit}
                    onChange={(v) => setPageMeta((m) => ({ ...m, screenFit: v }))}
                  />
                </FormField>
                <div className="border-t border-border pt-3 text-[11px] text-muted leading-relaxed space-y-1.5">
                  <p>Chọn 1 widget trên canvas để chỉnh cấu hình chi tiết.</p>
                  <p>
                    Widget cuộn được (list / chart / kanban…) cũng có thể bật{" "}
                    <span className="text-text font-medium">Tràn chiều cao màn hình</span> riêng ở
                    tab Chung.
                  </p>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
