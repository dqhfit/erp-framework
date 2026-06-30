/* Canvas preview cho PageDesigner: ComponentCard (thẻ component kéo-thả trên
   canvas) + ComponentBody (render preview theo kind) + PreviewBox +
   SplitPanelDropZone + EmbeddedActionStrip. Tách từ PageDesigner.tsx (Phase B2)
   — chỉ di chuyển code, KHÔNG đổi hành vi. Chỉ ComponentCard export. */
import { useState } from "react";
import { defaultGrid, isGridConfig, type SplitGridConfig } from "@/components/designer/grid-layout";
import {
  type ActionBarItem,
  EMBED_PALETTE,
  INPUT_WIDGET_KINDS,
  type PageComponent,
} from "@/components/designer/page-designer-constants";
import { useFieldDisplay } from "@/components/FieldDisplayToggle";
import { I } from "@/components/Icons";
import { isScalableKind, ScaleToFit } from "@/components/ScaleToFit";
import type { IconName } from "@/lib/object-types";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";

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
  onSplitPanelDrop?: (panel: string, srcId: string) => void;
  onSplitCellClick?: (cellId: string) => void;
  splitCellSelId?: string | null;
}
export function ComponentCard({
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
  onSplitPanelDrop,
  onSplitCellClick,
  splitCellSelId,
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
      data-comp-id={comp.id}
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
              title="Widget chưa gắn nguồn dữ liệu. Mở tab &quot;Nguồn &amp; Điều khiển&quot; (chọn widget → inspector) để chọn Entity + Field hoặc nhập tuỳ chọn tĩnh."
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
            <ComponentBody
              comp={comp}
              onSplitPanelDrop={onSplitPanelDrop}
              onSplitCellClick={onSplitCellClick}
              splitCellSelId={splitCellSelId}
            />
          </ScaleToFit>
        ) : (
          // Danh sách/tương tác: giữ nguyên kích thước, tự cuộn — không scale.
          <ComponentBody
            comp={comp}
            onSplitPanelDrop={onSplitPanelDrop}
            onSplitCellClick={onSplitCellClick}
            splitCellSelId={splitCellSelId}
          />
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

// ===== Split Grid types + helpers =====

/** Vùng thả component vào 1 panel của Split — hiển thị highlight khi kéo vào. */
function SplitPanelDropZone({
  panelKey,
  className,
  style,
  onDrop,
  children,
}: {
  panelKey: string;
  className?: string;
  style?: React.CSSProperties;
  onDrop?: (panel: string, srcId: string) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={cn("relative", over && "ring-2 ring-inset ring-accent ring-offset-0", className)}
      style={style}
      onDragOver={(e) => {
        // Chỉ chấp nhận kéo component (text/plain = comp.id), không nhận palette.
        if (e.dataTransfer.types.includes("text/plain")) {
          e.preventDefault();
          e.stopPropagation();
          if (!over) setOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
          setOver(false);
        }
      }}
      onDrop={(e) => {
        e.stopPropagation();
        setOver(false);
        const srcId = e.dataTransfer.getData("text/plain");
        if (srcId && onDrop) onDrop(panelKey, srcId);
      }}
    >
      {children}
      {over && (
        <div className="absolute inset-0 flex items-center justify-center bg-accent/15 pointer-events-none z-10 rounded">
          <span className="text-[10px] font-semibold text-accent bg-bg/90 px-2 py-0.5 rounded shadow">
            Thả vào đây
          </span>
        </div>
      )}
    </div>
  );
}

function ComponentBody({
  comp,
  onSplitPanelDrop,
  onSplitCellClick,
  splitCellSelId,
}: {
  comp: PageComponent;
  onSplitPanelDrop?: (panel: string, srcId: string) => void;
  onSplitCellClick?: (cellId: string) => void;
  splitCellSelId?: string | null;
}) {
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
      count = 2,
      ratio = 40,
      ratioV = 50,
      panelA,
      panelB,
      panelC,
      panelD,
      tabPanels,
    } = comp.config as {
      orientation?: string;
      count?: number;
      ratio?: number;
      ratioV?: number;
      panelA?: { kind?: string; entity?: string; title?: string };
      panelB?: { kind?: string; entity?: string; title?: string };
      panelC?: { kind?: string; entity?: string; title?: string };
      panelD?: { kind?: string; entity?: string; title?: string };
      // Định dạng N-tab: mỗi tab là 1 split panelA|panelB.
      tabPanels?: Array<{
        title?: string;
        panelA?: { kind?: string; entity?: string; title?: string };
        panelB?: { kind?: string; entity?: string; title?: string };
      }>;
    };
    const entA = entities.find((e) => e.id === panelA?.entity);
    const entB = entities.find((e) => e.id === panelB?.entity);
    const entC = entities.find((e) => e.id === panelC?.entity);
    const entD = entities.find((e) => e.id === panelD?.entity);
    const isBoth = orientation === "both";
    const isBoth2 = orientation === "both2";
    const isBoth3 = orientation === "both3";
    const isBoth4 = orientation === "both4";
    const isBoth5 = orientation === "both5";
    const isTabs = orientation === "tabs";
    const isH =
      !isBoth && !isBoth2 && !isBoth3 && !isBoth4 && !isBoth5 && !isTabs && orientation !== "v";
    const splitCount =
      isBoth || isBoth2 || isBoth3 || isBoth4 || isBoth5 ? 3 : Math.max(2, Math.min(3, count));

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

    // Tabs preview
    if (isTabs) {
      // Định dạng N-tab (tabPanels[]) — hiện đủ dải tab + xem trước tab đầu (A|B).
      if (Array.isArray(tabPanels) && tabPanels.length > 0) {
        const active = tabPanels[0];
        const aEnt = entities.find((e) => e.id === active?.panelA?.entity);
        const bEnt = entities.find((e) => e.id === active?.panelB?.entity);
        return (
          <div className="h-full flex flex-col overflow-hidden text-[10px]">
            <div className="flex border-b border-border/40 shrink-0 bg-bg-soft overflow-x-auto">
              {tabPanels.map((tp, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: dải tab xem trước tĩnh
                  key={i}
                  className={cn(
                    "px-2 py-0.5 text-[8px] border-b-2 whitespace-nowrap shrink-0 transition-colors",
                    i === 0
                      ? "border-accent text-accent font-semibold"
                      : "border-transparent text-muted",
                  )}
                >
                  {tp.title ?? `Tab ${i + 1}`}
                </div>
              ))}
            </div>
            <div className="flex-1 flex flex-row overflow-hidden">
              <div className="flex-1 overflow-hidden border-r border-border/40">
                <PanelPreview
                  label="A"
                  ent={aEnt}
                  title={active?.panelA?.title}
                  kind={active?.panelA?.kind}
                  bg="bg-accent/5"
                />
              </div>
              <div className="flex-1 overflow-hidden">
                <PanelPreview
                  label="B"
                  ent={bEnt}
                  title={active?.panelB?.title}
                  kind={active?.panelB?.kind}
                  bg="bg-panel-2/30"
                />
              </div>
            </div>
          </div>
        );
      }
      const tabPanelDefs = [
        { key: "A", panel: panelA, ent: entA, bg: "bg-accent/5" },
        { key: "B", panel: panelB, ent: entB, bg: "bg-panel-2/30" },
        ...(splitCount >= 3 ? [{ key: "C", panel: panelC, ent: entC, bg: "" }] : []),
      ];
      return (
        <div className="h-full flex flex-col overflow-hidden text-[10px]">
          <div className="flex border-b border-border/40 shrink-0 bg-bg-soft">
            {tabPanelDefs.map((p) => (
              <div
                key={p.key}
                className={cn(
                  "px-2 py-0.5 text-[8px] border-b-2 transition-colors",
                  p.key === "A"
                    ? "border-accent text-accent font-semibold"
                    : "border-transparent text-muted",
                )}
              >
                {p.panel?.title ?? p.ent?.name ?? p.key}
              </div>
            ))}
          </div>
          <SplitPanelDropZone
            panelKey="A"
            className="flex-1 overflow-hidden"
            onDrop={onSplitPanelDrop}
          >
            <PanelPreview
              label="A"
              ent={entA}
              title={panelA?.title}
              kind={panelA?.kind}
              bg="bg-accent/5"
            />
          </SplitPanelDropZone>
        </div>
      );
    }

    // Both layout
    if (isBoth) {
      return (
        <div className="h-full flex flex-row overflow-hidden text-[10px]">
          <SplitPanelDropZone
            panelKey="A"
            className="overflow-hidden border-r border-border/40"
            style={{ width: `${ratio}%` }}
            onDrop={onSplitPanelDrop}
          >
            <PanelPreview
              label="A"
              ent={entA}
              title={panelA?.title}
              kind={panelA?.kind}
              bg="bg-accent/5"
            />
          </SplitPanelDropZone>
          <div className="flex-1 flex flex-col overflow-hidden">
            <SplitPanelDropZone
              panelKey="B"
              className="overflow-hidden border-b border-border/40"
              style={{ height: `${ratioV}%` }}
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview
                label="B"
                ent={entB}
                title={panelB?.title}
                kind={panelB?.kind}
                bg="bg-panel-2/30"
              />
            </SplitPanelDropZone>
            <SplitPanelDropZone
              panelKey="C"
              className="flex-1 overflow-hidden"
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview label="C" ent={entC} title={panelC?.title} kind={panelC?.kind} bg="" />
            </SplitPanelDropZone>
          </div>
        </div>
      );
    }

    if (isBoth2) {
      return (
        <div className="h-full flex flex-row overflow-hidden text-[10px]">
          <div
            className="flex flex-col overflow-hidden border-r border-border/40"
            style={{ width: `${ratio}%` }}
          >
            <SplitPanelDropZone
              panelKey="A"
              className="overflow-hidden border-b border-border/40"
              style={{ height: `${ratioV}%` }}
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview
                label="A"
                ent={entA}
                title={panelA?.title}
                kind={panelA?.kind}
                bg="bg-accent/5"
              />
            </SplitPanelDropZone>
            <SplitPanelDropZone
              panelKey="B"
              className="flex-1 overflow-hidden"
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview
                label="B"
                ent={entB}
                title={panelB?.title}
                kind={panelB?.kind}
                bg="bg-panel-2/30"
              />
            </SplitPanelDropZone>
          </div>
          <SplitPanelDropZone
            panelKey="C"
            className="flex-1 overflow-hidden"
            onDrop={onSplitPanelDrop}
          >
            <PanelPreview label="C" ent={entC} title={panelC?.title} kind={panelC?.kind} bg="" />
          </SplitPanelDropZone>
        </div>
      );
    }

    if (isBoth3) {
      const ratioV2 =
        ((comp.config as Record<string, unknown>).ratioV2 as number | undefined) ?? 50;
      return (
        <div className="h-full flex flex-row overflow-hidden text-[10px]">
          <div
            className="flex flex-col overflow-hidden border-r border-border/40"
            style={{ width: `${ratio}%` }}
          >
            <SplitPanelDropZone
              panelKey="A"
              className="overflow-hidden border-b border-border/40"
              style={{ height: `${ratioV}%` }}
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview
                label="A"
                ent={entA}
                title={panelA?.title}
                kind={panelA?.kind}
                bg="bg-accent/5"
              />
            </SplitPanelDropZone>
            <SplitPanelDropZone
              panelKey="B"
              className="flex-1 overflow-hidden"
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview
                label="B"
                ent={entB}
                title={panelB?.title}
                kind={panelB?.kind}
                bg="bg-panel-2/30"
              />
            </SplitPanelDropZone>
          </div>
          <div className="flex flex-col flex-1 overflow-hidden">
            <SplitPanelDropZone
              panelKey="C"
              className="overflow-hidden border-b border-border/40"
              style={{ height: `${ratioV2}%` }}
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview label="C" ent={entC} title={panelC?.title} kind={panelC?.kind} bg="" />
            </SplitPanelDropZone>
            <SplitPanelDropZone
              panelKey="D"
              className="flex-1 overflow-hidden"
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview
                label="D"
                ent={entD}
                title={panelD?.title}
                kind={panelD?.kind}
                bg="bg-panel-2/20"
              />
            </SplitPanelDropZone>
          </div>
        </div>
      );
    }

    // Both4 — A trên / (B trái, C phải) dưới
    if (isBoth4) {
      return (
        <div className="h-full flex flex-col overflow-hidden text-[10px]">
          <SplitPanelDropZone
            panelKey="A"
            className="overflow-hidden border-b border-border/40"
            style={{ height: `${ratio}%` }}
            onDrop={onSplitPanelDrop}
          >
            <PanelPreview
              label="A"
              ent={entA}
              title={panelA?.title}
              kind={panelA?.kind}
              bg="bg-accent/5"
            />
          </SplitPanelDropZone>
          <div className="flex-1 flex flex-row overflow-hidden">
            <SplitPanelDropZone
              panelKey="B"
              className="overflow-hidden border-r border-border/40"
              style={{ width: `${ratioV}%` }}
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview
                label="B"
                ent={entB}
                title={panelB?.title}
                kind={panelB?.kind}
                bg="bg-panel-2/30"
              />
            </SplitPanelDropZone>
            <SplitPanelDropZone
              panelKey="C"
              className="flex-1 overflow-hidden"
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview label="C" ent={entC} title={panelC?.title} kind={panelC?.kind} bg="" />
            </SplitPanelDropZone>
          </div>
        </div>
      );
    }

    // Both5 — (A trái, B phải) trên / C dưới
    if (isBoth5) {
      return (
        <div className="h-full flex flex-col overflow-hidden text-[10px]">
          <div
            className="flex flex-row overflow-hidden border-b border-border/40"
            style={{ height: `${ratio}%` }}
          >
            <SplitPanelDropZone
              panelKey="A"
              className="overflow-hidden border-r border-border/40"
              style={{ width: `${ratioV}%` }}
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview
                label="A"
                ent={entA}
                title={panelA?.title}
                kind={panelA?.kind}
                bg="bg-accent/5"
              />
            </SplitPanelDropZone>
            <SplitPanelDropZone
              panelKey="B"
              className="flex-1 overflow-hidden"
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview
                label="B"
                ent={entB}
                title={panelB?.title}
                kind={panelB?.kind}
                bg="bg-panel-2/30"
              />
            </SplitPanelDropZone>
          </div>
          <SplitPanelDropZone
            panelKey="C"
            className="flex-1 overflow-hidden"
            onDrop={onSplitPanelDrop}
          >
            <PanelPreview label="C" ent={entC} title={panelC?.title} kind={panelC?.kind} bg="" />
          </SplitPanelDropZone>
        </div>
      );
    }

    // H / V — 2 or 3 panels
    const panelDefs = [
      { key: "A", panel: panelA, ent: entA, bg: "bg-accent/5" },
      { key: "B", panel: panelB, ent: entB, bg: "bg-panel-2/30" },
      ...(splitCount >= 3 ? [{ key: "C", panel: panelC, ent: entC, bg: "" }] : []),
    ];
    const szKey = isH ? "width" : "height";
    const borderEdge = isH ? "border-r" : "border-b";
    const eqPct = `${Math.round(100 / panelDefs.length)}%`;
    return (
      <div className={`h-full flex ${isH ? "flex-row" : "flex-col"} overflow-hidden text-[10px]`}>
        {panelDefs.map((p, idx) => {
          const isLast = idx === panelDefs.length - 1;
          return (
            <SplitPanelDropZone
              key={p.key}
              panelKey={p.key}
              className={cn("overflow-hidden border-border/40", !isLast && borderEdge)}
              style={isLast ? { flex: 1 } : { [szKey]: eqPct }}
              onDrop={onSplitPanelDrop}
            >
              <PanelPreview
                label={p.key}
                ent={p.ent}
                title={p.panel?.title}
                kind={p.panel?.kind}
                bg={p.bg}
              />
            </SplitPanelDropZone>
          );
        })}
      </div>
    );
  }

  if (comp.kind === "grid") {
    const rawCfg = comp.config as Record<string, unknown>;
    const gridCfg: SplitGridConfig = isGridConfig(rawCfg) ? rawCfg : defaultGrid(2, 1);
    const { cols, rows, cells } = gridCfg;
    const colFr = gridCfg.colFr ?? Array(cols).fill(1);
    const rowFr = gridCfg.rowFr ?? Array(rows).fill(1);
    const gridLabel = comp.config.label as string | undefined;

    return (
      <div className="h-full flex flex-col overflow-hidden">
        {gridLabel && (
          <div className="px-2 py-1 border-b border-border/40 shrink-0 flex items-center gap-1.5 text-[10px]">
            <I.LayoutGrid size={11} className="text-muted shrink-0" />
            <span className="font-medium truncate">{gridLabel}</span>
          </div>
        )}
        <div
          className="flex-1 overflow-hidden"
          style={{
            display: "grid",
            gridTemplateColumns: colFr.map((f) => `${f}fr`).join(" "),
            gridTemplateRows: rowFr.map((f) => `${f}fr`).join(" "),
          }}
        >
          {cells.map((cell) => {
            const ent = entities.find((e) => e.id === cell.entity);
            const isSelected = splitCellSelId === cell.id;
            return (
              <SplitPanelDropZone
                key={cell.id}
                panelKey={cell.id}
                style={{
                  gridColumn: `${cell.col} / span ${cell.colSpan}`,
                  gridRow: `${cell.row} / span ${cell.rowSpan}`,
                  border: "1px solid hsl(var(--border) / 0.4)",
                }}
                onDrop={onSplitPanelDrop}
                className={cn(isSelected && "ring-2 ring-inset ring-accent")}
              >
                <div
                  className="h-full flex flex-col overflow-hidden text-[10px] cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSplitCellClick?.(cell.id);
                  }}
                >
                  <div className="px-1.5 py-0.5 border-b border-border/30 shrink-0 flex items-center gap-1 bg-panel/50">
                    {ent ? (
                      <>
                        <span className="truncate text-[9px] text-muted">
                          {cell.title ?? ent.name}
                        </span>
                        <span className="ml-auto text-[8px] text-muted/50 shrink-0">
                          {cell.kind ?? "list"}
                        </span>
                      </>
                    ) : cell.dataSourceId ? (
                      <>
                        <span className="truncate text-[9px] text-muted">
                          {cell.title ?? "Datasource"}
                        </span>
                        <span className="ml-auto text-[8px] text-muted/50 shrink-0">
                          {cell.kind ?? "list"}
                        </span>
                      </>
                    ) : (
                      <span className="text-[9px] text-muted/50 italic">Chưa bind</span>
                    )}
                  </div>
                  {ent || cell.dataSourceId ? (
                    <div className="flex-1 flex flex-col gap-0.5 p-1">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-2 bg-muted/15 rounded" />
                      ))}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-[9px] text-muted/40">
                      {cell.row},{cell.col}
                    </div>
                  )}
                </div>
              </SplitPanelDropZone>
            );
          })}
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
          <span className="text-[10px] text-muted/60 flex-1">— tất cả —</span>
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
  if (comp.kind === "subpage") {
    const targetPageId = comp.config.targetPageId as string | undefined;
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 border border-dashed border-border/80 bg-panel/30 rounded-md text-xs gap-1.5 text-center overflow-hidden">
        <I.Layout size={20} className="text-accent/80 shrink-0" />
        <div className="font-semibold text-text truncate max-w-full shrink-0">
          Subpage / Trang nhúng
        </div>
        {targetPageId ? (
          <span className="text-[10px] font-mono text-muted/80 select-all truncate max-w-full px-2 shrink-0">
            ID: {targetPageId}
          </span>
        ) : (
          <span className="text-[10px] text-warning/90 font-medium shrink-0">
            Chưa cấu hình ID trang con
          </span>
        )}
      </div>
    );
  }

  return null;
}

// ── EmbeddedActionStrip ─────────────────────────────────────────────────────
// Thanh hành động nhỏ hiển thị trong header của list / form / detail preview.
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
