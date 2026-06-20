/* Tab "Dữ liệu" của inspector PageDesigner: chọn nguồn (BindingSourceConfig),
   cấu hình bộ lọc filter (items), tải dữ liệu (DataLoadConfig) + cấu hình nâng
   cao theo loại widget (master-field binder, filter builder, nhãn cột…). Tách từ
   PageDesigner.tsx (Phase B4) — chỉ di chuyển code, KHÔNG đổi hành vi. */

import { FilterBuilder } from "@/components/designer/inspectors/FilterBuilder";
import {
  BindingSourceConfig,
  DataLoadConfig,
  type FItemInspType,
  FilterItemsInspector,
} from "@/components/designer/inspectors/inspector-helpers";
import { MasterFieldBinder } from "@/components/designer/inspectors/MasterFieldBinder";
import {
  BINDING_KINDS,
  type PageComponent,
  RECORD_DATA_KINDS,
} from "@/components/designer/page-designer-constants";
import { fieldBoth, useFieldDisplay } from "@/components/FieldDisplayToggle";
import { I } from "@/components/Icons";
import { FormField, Input, Select, Switch } from "@/components/ui";
import { useT } from "@/hooks/useT";
import type { StateSource } from "@/lib/page-state-sources";
import { useUserObjects } from "@/stores/userObjects";
import type { FilterNode } from "@/types/page";

export function DulieuInspector({
  sel,
  update,
  stateSources,
  ensureMasterEmits,
}: {
  sel: PageComponent;
  update: (id: string, patch: Partial<PageComponent>) => void;
  stateSources: StateSource[];
  ensureMasterEmits: (source: StateSource | null) => void;
}) {
  const t = useT();
  const { fieldDisp } = useFieldDisplay();
  const entities = useUserObjects((s) => s.entities);
  const dataSources = useUserObjects((s) => s.dataSources);
  const dataSourceContent = useUserObjects((s) => s.dataSourceContent);
  return (
    <>
      {BINDING_KINDS.has(sel.kind) && (
        <BindingSourceConfig
          key={sel.id}
          cfg={sel.config}
          dataSources={dataSources}
          onChange={(patch) => update(sel.id, { config: { ...sel.config, ...patch } })}
        />
      )}
      {/* Filter — items[] (mới) hoặc cascade legacy. */}
      {sel.kind === "filter" &&
        (() => {
          type FItemInsp = FItemInspType;
          const fcfg = sel.config as {
            items?: FItemInsp[];
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

          // ── FORMAT MỚI: items[] ──────────────────────────────
          if (Array.isArray(fcfg.items)) {
            return (
              <FilterItemsInspector
                items={fcfg.items as FItemInsp[]}
                updItems={(next) => upd({ items: next })}
                entities={entities}
                dataSources={dataSources}
                refreshDataSourceId={fcfg.refreshDataSourceId}
                onRefreshDsChange={(v) => upd({ refreshDataSourceId: v })}
              />
            );
          }

          // ── FORMAT CŨ: cascade legacy ────────────────────────
          const dsc = fcfg.dataSourceId ? dataSourceContent[fcfg.dataSourceId] : undefined;
          const dsCols = (dsc?.fields ?? []).map((f) => ({
            name: f.key,
            label: f.label || f.key,
          }));
          return (
            <>
              <button
                type="button"
                onClick={() => upd({ items: [] })}
                className="w-full text-left text-[11px] text-accent border border-accent/30 rounded px-2 py-1 hover:bg-accent/5 transition-colors"
              >
                Nâng cấp sang format items[] →
              </button>
              <FormField label="Tiêu đề">
                <Input
                  placeholder="vd: Lọc theo sản phẩm"
                  value={fcfg.title ?? ""}
                  onChange={(e) => upd({ title: e.target.value })}
                />
              </FormField>
              <div className="rounded-md border border-border p-2 space-y-2 bg-bg-soft/40">
                <div className="text-xs font-semibold text-muted">Nguồn tuỳ chọn (datasource)</div>
                <div className="flex gap-1 items-center">
                  <div className="flex-1 min-w-0">
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
                  <button
                    type="button"
                    title="Mở nguồn dữ liệu"
                    disabled={!fcfg.dataSourceId}
                    onClick={() =>
                      window.open(
                        `/datasources/${fcfg.dataSourceId}`,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                    className="shrink-0 w-7 h-7 rounded border border-border flex items-center justify-center hover:bg-hover disabled:opacity-40 text-muted"
                  >
                    <I.ExternalLink size={12} />
                  </button>
                </div>
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
                      onChange={(e) => upd({ familyField: e.target.value || undefined })}
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
                  Widget khác (vd List) đặt "Chỉ tải khi state có giá trị" = key này để cascade.
                </div>
              </FormField>
              <FormField label="Nạp lại nguồn khi chọn (tuỳ chọn)">
                <Select
                  value={fcfg.refreshDataSourceId ?? ""}
                  onChange={(e) => upd({ refreshDataSourceId: e.target.value || undefined })}
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
      {RECORD_DATA_KINDS.has(sel.kind) && sel.config.dataSourceId === undefined && (
        <DataLoadConfig
          cfg={sel.config}
          fields={
            (entities.find((e) => e.id === (sel.config.entity as string | undefined))?.fields ??
              []) as Array<{ name: string; label?: string }>
          }
          onChange={(patch) => update(sel.id, { config: { ...sel.config, ...patch } })}
        />
      )}
      {/* Cài đặt chung + (entity-mode) bộ chọn Entity. Cài đặt list
                     (chọn nhiều/sửa/cột hành động/chọn dòng…) hiện cho CẢ entity
                     lẫn datasource; riêng bộ chọn Entity + checklist field ẩn khi
                     bind datasource (đã có bộ chọn "Nguồn bind" riêng ở trên). */}
      {(sel.kind === "list" ||
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
                    <div className="flex gap-1 items-center">
                      <div className="flex-1 min-w-0">
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
                      </div>
                      <button
                        type="button"
                        title="Mở entity"
                        disabled={!(sel.config.entity as string | undefined)}
                        onClick={() =>
                          window.open(
                            `/entities/${sel.config.entity}`,
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

                  {/* Field checklist — list / form / detail khi đã bind entity */}
                  {(sel.kind === "list" || sel.kind === "form" || sel.kind === "detail") &&
                    entityFields.length > 0 && (
                      <FormField label={t("designer.fields_to_show")}>
                        <div className="border border-border rounded-md overflow-hidden">
                          <div className="max-h-44 overflow-y-auto bg-bg-soft">
                            {entityFields.map((f) => {
                              const checked = allSelected || selectedFieldNames.includes(f.name);
                              const isLookup = f.type === "lookup" || f.type === "multi-lookup";
                              const refEnt =
                                isLookup && f.ref ? entities.find((e) => e.id === f.ref) : null;
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
                                          fields: next.length === entityFields.length ? null : next,
                                        },
                                      });
                                    }}
                                  />
                                  <span className="flex-1 truncate">{fieldDisp(f)}</span>
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
                      sel.config.filterFromState as { field: string; stateKey: string } | undefined
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
                      Khi "Lọc theo" chưa chọn gì (vd Combobox để "— tất cả —") thì hiện toàn bộ
                      thay vì ẩn hết. Tắt = master-detail (ẩn khi chưa chọn).
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
                    onChange={(v) => update(sel.id, { config: { ...sel.config, multiSelect: v } })}
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
                    onChange={(v) => update(sel.id, { config: { ...sel.config, editable: v } })}
                  />
                </div>
              )}

              {sel.kind === "list" && (
                <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm">Chọn dòng (checkbox)</span>
                    <span className="text-[11px] text-muted">
                      Cho phép tích chọn dòng · chọn tất cả đã lọc / mọi trang (mặc định ẩn)
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
                    onChange={(v) => update(sel.id, { config: { ...sel.config, batchEdit: v } })}
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
                          Hiện dòng "＋ Thêm dòng mới"; bấm để thêm dòng nháp
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
                    onChange={(v) => update(sel.id, { config: { ...sel.config, batchEdit: v } })}
                  />
                </div>
              )}

              {sel.kind === "list" && (
                <div className="flex items-center justify-between p-2.5 rounded-md border border-border bg-bg-soft">
                  <div className="flex flex-col leading-tight">
                    <span className="text-sm">Phân trang server (bảng lớn)</span>
                    <span className="text-[11px] text-muted">
                      Sắp/lọc/phân trang trên server — duyệt được TOÀN bảng (&gt;10k dòng), sửa ô
                      inline vẫn dùng được. Dùng "Tải dữ liệu → điều kiện" cho lọc cố định.
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
                      onChange={(v) => update(sel.id, { config: { ...sel.config, editable: v } })}
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
                    sel.config.linkedToState as { field: string; stateKey: string } | undefined
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
                      sel.config.filterFromState as { field: string; stateKey: string } | undefined
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
                      sel.config.filterFromState as { field: string; stateKey: string } | undefined
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
    </>
  );
}
