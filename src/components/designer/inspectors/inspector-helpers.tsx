/* Inspector helper cho PageDesigner (dùng trong các tab inspector inline ở main):
   BindingSourceConfig (chọn entity/datasource) + DataLoadConfig (số dòng/điều
   kiện/cổng) + FilterItemsInspector (cấu hình item bộ lọc) + tabsForKind (tab theo
   kind) + ActionBarInspector (sửa thanh hành động). Tách từ PageDesigner.tsx
   (Phase B3) — chỉ di chuyển code, KHÔNG đổi hành vi. */
import { useState } from "react";
import { ActionInspector } from "@/components/designer/ActionInspector";
import {
  type ActionBarItem,
  type ComponentKind,
  LOAD_OPS,
} from "@/components/designer/page-designer-constants";
import { fieldBoth, useFieldDisplay } from "@/components/FieldDisplayToggle";
import { I } from "@/components/Icons";
import { FormField, Input, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ActionConfig, ActionVariant } from "@/types/page";

/* ── Cấu hình tải dữ liệu (số dòng + điều kiện + cổng) ─────────────────────
   Dùng chung cho mọi widget đọc record-list. Ghi vào config keys: rowLimit
   (trần tải server-side), pageSize (số dòng/trang khi render), loadFilters
   (map field→{op,value}), loadGate (stateKey). Renderer đọc các key này qua
   useDataOpts + DataGrid (ConsumerPage). */
type LoadCond = { op: string; value: unknown };

/* Bộ chọn nguồn dữ liệu: Entity ↔ Nguồn dữ liệu (datasource). Ghi cfg.entity
   hoặc cfg.dataSourceId. dataSourceId === undefined = mode entity; định nghĩa
   (kể cả "") = mode datasource. */
export function BindingSourceConfig({
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
        <div className="flex gap-1 items-center">
          <div className="flex-1 min-w-0">
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
          </div>
          <button
            type="button"
            title="Mở nguồn dữ liệu"
            disabled={!dsId}
            onClick={() => window.open(`/datasources/${dsId}`, "_blank", "noopener,noreferrer")}
            className="shrink-0 w-7 h-7 rounded border border-border flex items-center justify-center hover:bg-hover disabled:opacity-40 text-muted"
          >
            <I.ExternalLink size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

export function DataLoadConfig({
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

export type FItemInspType = {
  id: string;
  kind: "combobox" | "tagbox" | "search";
  label?: string;
  entity?: string;
  field?: string;
  labelField?: string;
  stateKey?: string;
  placeholder?: string;
  width?: number;
  /** Lọc liên kết: options của item này thu hẹp theo các filter cha (cross-filter). */
  dependsOn?: { fromState: string; field: string }[];
};

export function FilterItemsInspector({
  items,
  updItems,
  entities,
  dataSources,
  refreshDataSourceId,
  onRefreshDsChange,
}: {
  items: FItemInspType[];
  updItems: (next: FItemInspType[]) => void;
  entities: { id: string; name: string; fields?: { name: string; label?: string }[] }[];
  dataSources: { id: string; name: string }[];
  refreshDataSourceId?: string;
  onRefreshDsChange: (v: string | undefined) => void;
}) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");
  const activeIdx = items.findIndex((it) => it.id === activeId);
  const active = activeIdx >= 0 ? items[activeIdx] : items[0];

  const addItem = () => {
    const id = `fi_${Math.random().toString(36).slice(2, 8)}`;
    const next = [...items, { id, kind: "combobox" as const, label: "", stateKey: "" }];
    updItems(next);
    setActiveId(id);
  };

  const updIt = (patch: Partial<FItemInspType>) => {
    if (!active) return;
    updItems(items.map((it) => (it.id === active.id ? { ...it, ...patch } : it)));
  };

  const deleteActive = () => {
    const remaining = items.filter((it) => it.id !== active?.id);
    updItems(remaining);
    setActiveId(remaining[0]?.id ?? "");
  };

  const itEnt = entities.find((e) => e.id === active?.entity);

  // Lọc liên kết (cross-filter): các filter KHÁC (có state key) để item này lọc theo.
  const otherItems = items.filter((it) => it.id !== active?.id && it.stateKey);
  const deps = active?.dependsOn ?? [];
  const setDeps = (next: { fromState: string; field: string }[]) =>
    updIt({ dependsOn: next.length ? next : undefined });

  return (
    <>
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b border-border -mx-3 px-3 pb-0 overflow-x-auto">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => setActiveId(it.id)}
            className={cn(
              "shrink-0 px-2.5 h-7 text-xs border-b-2 -mb-px whitespace-nowrap transition-colors",
              it.id === (active?.id ?? "")
                ? "border-accent text-text"
                : "border-transparent text-muted hover:text-text",
            )}
          >
            {it.label || it.kind || it.id}
          </button>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="shrink-0 ml-auto flex items-center gap-0.5 px-1.5 h-7 text-[11px] text-accent hover:underline"
        >
          <I.Plus size={11} /> Thêm
        </button>
      </div>

      {items.length === 0 && (
        <div className="text-[11px] text-muted/60 italic px-0.5 pt-1">
          Chưa có thành phần. Bấm "Thêm" để thêm.
        </div>
      )}

      {/* Panel item đang chọn */}
      {active && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-1">
            <Select
              value={active.kind}
              onChange={(e) => updIt({ kind: e.target.value as FItemInspType["kind"] })}
              className="flex-1 text-xs h-7"
            >
              <option value="combobox">Combobox</option>
              <option value="tagbox">Tagbox</option>
              <option value="search">Tìm kiếm</option>
            </Select>
            <button
              type="button"
              title="Xoá thành phần này"
              onClick={deleteActive}
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-muted hover:text-danger hover:bg-danger/10 transition-colors"
            >
              <I.X size={12} />
            </button>
          </div>
          <FormField label="Nhãn">
            <Input
              placeholder="vd: Sản phẩm"
              value={active.label ?? ""}
              onChange={(e) => updIt({ label: e.target.value })}
            />
          </FormField>
          <FormField label="Độ rộng (px)">
            <Input
              type="number"
              placeholder="để trống = tự co giãn"
              value={active.width ?? ""}
              onChange={(e) =>
                updIt({ width: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </FormField>
          <FormField label="State key">
            <Input
              placeholder="vd: selMasp"
              value={active.stateKey ?? ""}
              onChange={(e) => updIt({ stateKey: e.target.value })}
            />
          </FormField>
          {active.kind !== "search" && (
            <>
              <FormField label="Entity">
                <Select
                  value={active.entity ?? ""}
                  onChange={(e) => updIt({ entity: e.target.value, field: "" })}
                >
                  <option value="">— tĩnh (options) —</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              {itEnt && (
                <>
                  <FormField label="Field giá trị">
                    <Select
                      value={active.field ?? ""}
                      onChange={(e) => updIt({ field: e.target.value })}
                    >
                      <option value="">— chọn —</option>
                      {(itEnt.fields ?? []).map((f) => (
                        <option key={f.name} value={f.name}>
                          {fieldBoth(f)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  {active.kind === "combobox" && (
                    <FormField label="Field nhãn (vd: tên)">
                      <Select
                        value={active.labelField ?? ""}
                        onChange={(e) => updIt({ labelField: e.target.value || undefined })}
                      >
                        <option value="">— không —</option>
                        {(itEnt.fields ?? []).map((f) => (
                          <option key={f.name} value={f.name}>
                            {fieldBoth(f)}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  )}
                </>
              )}
            </>
          )}
          {(active.kind === "search" || active.kind === "tagbox") && (
            <FormField label="Placeholder">
              <Input
                placeholder="Gợi ý nhập…"
                value={active.placeholder ?? ""}
                onChange={(e) => updIt({ placeholder: e.target.value || undefined })}
              />
            </FormField>
          )}
          {active.entity && (
            <div className="pt-1">
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                Lọc liên kết (cascade)
              </div>
              <p className="text-[10px] text-muted/70 px-0.5 mb-1">
                Thu hẹp lựa chọn theo filter khác. Vd: Sản phẩm lọc theo Đơn hàng.
              </p>
              {deps.map((dep, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: hàng phụ thuộc không có id riêng
                <div key={i} className="flex items-center gap-1 mb-1">
                  <Select
                    value={dep.fromState}
                    onChange={(e) =>
                      setDeps(
                        deps.map((d, j) => (j === i ? { ...d, fromState: e.target.value } : d)),
                      )
                    }
                    className="flex-1 text-xs h-7"
                  >
                    <option value="">— Lọc theo —</option>
                    {otherItems.map((o) => (
                      <option key={o.id} value={o.stateKey}>
                        {o.label || o.stateKey}
                      </option>
                    ))}
                  </Select>
                  <span className="shrink-0 text-[10px] text-muted">↦</span>
                  <Select
                    value={dep.field}
                    onChange={(e) =>
                      setDeps(deps.map((d, j) => (j === i ? { ...d, field: e.target.value } : d)))
                    }
                    className="flex-1 text-xs h-7"
                  >
                    <option value="">— field khớp —</option>
                    {(itEnt?.fields ?? []).map((f) => (
                      <option key={f.name} value={f.name}>
                        {fieldBoth(f)}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    title="Bỏ liên kết"
                    onClick={() => setDeps(deps.filter((_, j) => j !== i))}
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-muted hover:text-danger hover:bg-danger/10"
                  >
                    <I.X size={11} />
                  </button>
                </div>
              ))}
              {otherItems.length === 0 ? (
                <p className="text-[10px] text-muted/60 italic px-0.5">
                  Cần ≥2 thành phần (có state key) để liên kết.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeps([...deps, { fromState: "", field: "" }])}
                  className="flex items-center gap-0.5 text-[11px] text-accent hover:underline"
                >
                  <I.Plus size={10} /> Thêm liên kết
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <FormField label="Nạp lại nguồn (tuỳ chọn)">
        <Select
          value={refreshDataSourceId ?? ""}
          onChange={(e) => onRefreshDsChange(e.target.value || undefined)}
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
}

// ===== tabsForKind — tabs cho inspector theo kind =====
export function tabsForKind(kind: ComponentKind) {
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
  if (kind === "grid") return [...base, { key: "bocuc", label: "Bố cục" }];
  if (kind === "actionbar") return [...base, { key: "hanhDong", label: "Hành động" }];
  if (kind === "action") return [...base, { key: "cauhinh", label: "Cấu hình" }];
  if (kind === "step") return [...base, { key: "buoc", label: "Bước" }];
  return base;
}

// ── ActionBarInspector ──────────────────────────────────────────────────────
// Inspector cho component "actionbar" và phần nhúng trong list / form / detail.
interface ActionBarInspectorProps {
  items: ActionBarItem[];
  align: "left" | "right" | "between";
  compact?: boolean;
  embedded?: boolean;
  onChange: (items: ActionBarItem[], align: "left" | "right" | "between") => void;
  onCompactChange?: (v: boolean) => void;
}
export function ActionBarInspector({
  items,
  align,
  compact = false,
  embedded = false,
  onChange,
  onCompactChange,
}: ActionBarInspectorProps) {
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
        <>
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
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={compact}
              onChange={(e) => onCompactChange?.(e.target.checked)}
            />
            <span className="font-medium">Nút nhỏ gọn (size sm)</span>
          </label>
        </>
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
