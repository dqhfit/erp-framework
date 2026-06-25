import { useEffect, useMemo, useRef, useState } from "react";
import { ActionInspector } from "@/components/designer/ActionInspector";
import { AiAssistDrawer } from "@/components/designer/AiAssistDrawer";
import { ComponentCard } from "@/components/designer/canvas/canvas-preview";
import { migrateToGrid } from "@/components/designer/grid-layout";
import { AdvancedFilterInspector } from "@/components/designer/inspectors/AdvancedFilterInspector";
import { BandInspector } from "@/components/designer/inspectors/BandInspector";
import { BocucInspector } from "@/components/designer/inspectors/BocucInspector";
import { BuocInspector } from "@/components/designer/inspectors/BuocInspector";
import { ChungInspector } from "@/components/designer/inspectors/ChungInspector";
import { DieukienInspector } from "@/components/designer/inspectors/DieukienInspector";
import { DulieuInspector } from "@/components/designer/inspectors/DulieuInspector";
import { HanhDongInspector } from "@/components/designer/inspectors/HanhDongInspector";
import { tabsForKind } from "@/components/designer/inspectors/inspector-helpers";
import { MobileDesignerNotice } from "@/components/designer/MobileDesignerNotice";
import {
  type ActionBarItem,
  type ComponentKind,
  PALETTE,
  type PageComponent,
} from "@/components/designer/page-designer-constants";
import { FieldDisplayToggle } from "@/components/FieldDisplayToggle";
import { I } from "@/components/Icons";
import { PageStatusPicker } from "@/components/PageStatusFlag";
import { ConsumerPage } from "@/components/renderer/ConsumerPage";
import { Button, EmptyState, FormField, Switch } from "@/components/ui";
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
import type { ActionConfig } from "@/types/page";

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
          <div className="mx-auto p-4 w-full max-w-none px-4">
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
                  {inspTab === "bocuc" && (
                    <BocucInspector
                      sel={sel}
                      update={update}
                      splitPanelTab={splitPanelTab}
                      setSplitPanelTab={setSplitPanelTab}
                      splitCellSel={splitCellSel}
                      setSplitCellSel={setSplitCellSel}
                    />
                  )}

                  {/* ── Wizard / Step ── */}
                  {inspTab === "buoc" && sel.kind === "step" && (
                    <BuocInspector
                      sel={sel}
                      update={update}
                      expandedStep={expandedStep}
                      setExpandedStep={setExpandedStep}
                    />
                  )}

                  {/* ── Action Bar ── */}
                  {inspTab === "hanhDong" && <HanhDongInspector sel={sel} update={update} />}

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
                    sel.kind === "kpi") && (
                    <AdvancedFilterInspector
                      sel={sel}
                      update={update}
                      stateSources={stateSources}
                      ensureMasterEmits={ensureMasterEmits}
                    />
                  )}
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
