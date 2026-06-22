/* Tab "Bố cục" của inspector PageDesigner: cấu hình Split Panel (2–3 panel,
   drag-resize, nguồn từng panel) và Grid Layout N×M (thêm/bớt cột-hàng,
   merge/split cell). Tách từ PageDesigner.tsx (Phase B4) — chỉ di chuyển code,
   KHÔNG đổi hành vi. */
import type { Dispatch, SetStateAction } from "react";
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
import { ActionBarInspector } from "@/components/designer/inspectors/inspector-helpers";
import type { ActionBarItem, PageComponent } from "@/components/designer/page-designer-constants";
import { fieldBoth } from "@/components/FieldDisplayToggle";
import { I } from "@/components/Icons";
import { ROW_ACTION_OPTIONS } from "@/components/renderer/RowActionsCell";
import { FormField, Input, Select, Switch } from "@/components/ui";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { useUserObjects } from "@/stores/userObjects";

export function BocucInspector({
  sel,
  update,
  splitPanelTab,
  setSplitPanelTab,
  splitCellSel,
  setSplitCellSel,
}: {
  sel: PageComponent;
  update: (id: string, patch: Partial<PageComponent>) => void;
  splitPanelTab: string;
  setSplitPanelTab: Dispatch<SetStateAction<string>>;
  splitCellSel: string | null;
  setSplitCellSel: Dispatch<SetStateAction<string | null>>;
}) {
  const entities = useUserObjects((s) => s.entities);
  return (
    <>
      {sel.kind === "split" &&
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
            loadFilters?: Record<string, { op: string; value: string | number | boolean }>;
            // chart
            chartKind?: string;
            groupBy?: string;
            valueField?: string;
          };
          const splitCfg = sel.config as {
            orientation?: "h" | "v" | "both" | "both2" | "both3" | "both4" | "both5" | "tabs";
            count?: number;
            ratio?: number;
            ratioV?: number;
            ratioV2?: number;
            panelA?: PanelCfg;
            panelB?: PanelCfg;
            panelC?: PanelCfg;
            panelD?: PanelCfg;
            // Định dạng N-tab: mỗi tab là 1 split panelA|panelB.
            tabPanels?: Array<{
              title?: string;
              kind?: string;
              orientation?: string;
              ratio?: number;
              panelA?: PanelCfg;
              panelB?: PanelCfg;
            }>;
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
                        window.open(`/entities/${panel.entity}`, "_blank", "noopener,noreferrer")
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
                      onChange={(e) => onUpdate({ ...panel, filterFromPanel: e.target.value })}
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
                              sourceFields: (panel.sourceFields ?? []).filter((_, j) => j !== i),
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
                        const srcEnt = entities.find((e) => e.id === panelByKey[fp]?.entity);
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
                                    linkConditions: (panel.linkConditions ?? []).map((c, j) =>
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
                              <span className="text-muted/60 shrink-0 text-[10px]">cột phát:</span>
                              <Select
                                value={cond.fromField ?? ""}
                                onChange={(e) =>
                                  onUpdate({
                                    ...panel,
                                    linkConditions: (panel.linkConditions ?? []).map((c, j) =>
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
                              <span className="text-muted/60 shrink-0 text-[10px]">→ cột lọc:</span>
                              {linkedEnt ? (
                                <Select
                                  value={cond.toField}
                                  onChange={(e) =>
                                    onUpdate({
                                      ...panel,
                                      linkConditions: (panel.linkConditions ?? []).map((c, j) =>
                                        j === i ? { ...c, toField: e.target.value } : c,
                                      ),
                                    })
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
                                <span className="text-muted italic">Bind entity trước</span>
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
                            rowLimit: e.target.value ? Number(e.target.value) : undefined,
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
                      onChange={(items) => onUpdate({ ...panel, embeddedActions: items })}
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
                        onChange={(e) => onUpdate({ ...panel, chartKind: e.target.value })}
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

          // ── Editor cho định dạng N-tab (tabPanels[]) — mỗi tab là split A|B ──
          type TabPanelCfg = NonNullable<typeof splitCfg.tabPanels>[number];
          const tabPanels = splitCfg.tabPanels;
          if (Array.isArray(tabPanels) && tabPanels.length > 0) {
            const tIdx = Math.min(
              Math.max(0, Number.parseInt(splitPanelTab, 10) || 0),
              tabPanels.length - 1,
            );
            const sub = splitPanelTab.endsWith(":b") ? "b" : "a";
            const tab = tabPanels[tIdx] ?? {};
            const tabA = tab.panelA ?? {};
            const tabB = tab.panelB ?? {};
            const setTabs = (next: TabPanelCfg[]) => updateSplit({ tabPanels: next });
            const updTab = (patch: Partial<TabPanelCfg>) =>
              setTabs(tabPanels.map((t, i) => (i === tIdx ? { ...t, ...patch } : t)));
            const moveTab = (dir: -1 | 1) => {
              const j = tIdx + dir;
              if (j < 0 || j >= tabPanels.length) return;
              const next = [...tabPanels];
              const a = next[tIdx];
              const c = next[j];
              if (!a || !c) return;
              next[tIdx] = c;
              next[j] = a;
              setTabs(next);
              setSplitPanelTab(String(j));
            };
            return (
              <>
                <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mt-1">
                  Tab ({tabPanels.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {tabPanels.map((t, i) => (
                    <button
                      // biome-ignore lint/suspicious/noArrayIndexKey: tab theo vị trí trong mảng
                      key={i}
                      type="button"
                      onClick={() => setSplitPanelTab(String(i))}
                      className={cn(
                        "px-2 py-1 text-xs rounded border transition-colors",
                        i === tIdx
                          ? "bg-accent text-white border-accent"
                          : "border-border text-muted hover:bg-hover/60",
                      )}
                    >
                      {t.title || `Tab ${i + 1}`}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const ni = tabPanels.length;
                      setTabs([
                        ...tabPanels,
                        {
                          kind: "split",
                          orientation: "h",
                          ratio: 40,
                          title: `Tab ${ni + 1}`,
                          panelA: { kind: "list" },
                          panelB: { kind: "detail" },
                        },
                      ]);
                      setSplitPanelTab(String(ni));
                    }}
                    className="px-2 py-1 text-xs rounded border border-dashed border-border text-accent hover:bg-hover/60 inline-flex items-center gap-0.5"
                  >
                    <I.Plus size={11} /> Tab
                  </button>
                </div>
                <FormField label="Tiêu đề tab">
                  <Input
                    value={tab.title ?? ""}
                    placeholder={`Tab ${tIdx + 1}`}
                    onChange={(e) => updTab({ title: e.target.value })}
                  />
                </FormField>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveTab(-1)}
                    disabled={tIdx === 0}
                    className="flex-1 py-1 text-xs border border-border rounded hover:bg-hover disabled:opacity-40 inline-flex items-center justify-center gap-0.5"
                  >
                    <I.ChevronLeft size={11} /> Trái
                  </button>
                  <button
                    type="button"
                    onClick={() => moveTab(1)}
                    disabled={tIdx === tabPanels.length - 1}
                    className="flex-1 py-1 text-xs border border-border rounded hover:bg-hover disabled:opacity-40 inline-flex items-center justify-center gap-0.5"
                  >
                    Phải <I.ChevronRight size={11} />
                  </button>
                  <button
                    type="button"
                    disabled={tabPanels.length <= 1}
                    onClick={() => {
                      setTabs(tabPanels.filter((_, i) => i !== tIdx));
                      setSplitPanelTab(String(Math.max(0, tIdx - 1)));
                    }}
                    className="flex-1 py-1 text-xs border border-danger/40 text-danger rounded hover:bg-danger/10 disabled:opacity-40 inline-flex items-center justify-center gap-0.5"
                  >
                    <I.X size={11} /> Xoá
                  </button>
                </div>
                <FormField label="Hướng panel trong tab">
                  <Select
                    value={tab.orientation ?? "h"}
                    onChange={(e) => updTab({ orientation: e.target.value })}
                  >
                    <option value="h">Ngang (A | B)</option>
                    <option value="v">Dọc (A / B)</option>
                  </Select>
                </FormField>
                <FormField label={`Tỉ lệ A: ${tab.ratio ?? 40}%`}>
                  <input
                    type="range"
                    min={20}
                    max={80}
                    value={tab.ratio ?? 40}
                    onChange={(e) => updTab({ ratio: Number(e.target.value) })}
                    className="w-full accent-accent"
                  />
                </FormField>
                <div className="flex border border-border rounded-md overflow-hidden mt-1">
                  {(["a", "b"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setSplitPanelTab(k === "b" ? `${tIdx}:b` : String(tIdx))}
                      className={cn(
                        "flex-1 py-1 text-xs font-medium border-r border-border last:border-r-0",
                        sub === k ? "bg-accent text-white" : "text-muted hover:bg-hover/60",
                      )}
                    >
                      Panel {k.toUpperCase()}
                    </button>
                  ))}
                </div>
                {sub === "a" ? (
                  <PanelFields
                    panel={tabA}
                    availableSources={[]}
                    linkedEnt={entities.find((e) => e.id === tabA.entity)}
                    defaultKind="list"
                    onUpdate={(panel) => updTab({ panelA: panel })}
                  />
                ) : (
                  <PanelFields
                    panel={tabB}
                    availableSources={[
                      { key: "a", label: "Panel A (trong tab)", entityId: tabA.entity },
                    ]}
                    linkedEnt={entities.find((e) => e.id === tabB.entity)}
                    defaultKind="detail"
                    onUpdate={(panel) => updTab({ panelB: panel })}
                  />
                )}
              </>
            );
          }

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
                    onChange={(e) => updateSplit({ count: Number(e.target.value) as 2 | 3 })}
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
                const activeTab = existingPanelKeys.includes(splitPanelTab) ? splitPanelTab : "A";
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
      {sel.kind === "grid" &&
        (() => {
          const rawCfg = sel.config as Record<string, unknown>;
          const gridCfg: SplitGridConfig = migrateToGrid(rawCfg);
          const { cols, rows, cells } = gridCfg;
          const selCell = splitCellSel ? cells.find((c) => c.id === splitCellSel) : null;

          const updateGrid = (next: SplitGridConfig) => update(sel.id, { config: next });

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
                                ? (entities.find((e) => e.id === cell.entity)?.name ?? "?")
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
                      onChange={(e) => updateCell({ title: e.target.value || undefined })}
                    />
                  </FormField>
                  {selCell.kind &&
                    ["detail", "form", "chart", "kanban"].includes(selCell.kind) &&
                    selEnt && (
                      <FormField label="Field liên kết">
                        <Select
                          value={selCell.linkField ?? ""}
                          onChange={(e) => updateCell({ linkField: e.target.value || undefined })}
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
                              rowLimit: e.target.value ? Number(e.target.value) : undefined,
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
                          onChange={(e) => updateCell({ groupBy: e.target.value || undefined })}
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
                          onChange={(e) => updateCell({ valueField: e.target.value || undefined })}
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
                          onChange={(e) => updateCell({ groupBy: e.target.value || undefined })}
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
    </>
  );
}
