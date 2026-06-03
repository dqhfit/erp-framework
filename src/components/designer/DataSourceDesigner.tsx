/* ==========================================================
   DataSourceDesigner — builder cho "Nguồn dữ liệu" (ORM-like):
   chọn entity gốc → thêm quan hệ (join qua field lookup, có thể
   lồng) → chọn/đặt cột chiếu (projection, alias + writable) →
   số dòng mặc định → xem trước bảng phẳng đã join.
   Lưu qua userObjects.setDataSourceContent (optimistic + bg save).
   ========================================================== */

import { createObjectsClient } from "@erp-framework/client";
import type {
  AggFn,
  DataSourceAggregate,
  DataSourceComputed,
  DataSourceConfig,
  DataSourceField,
  DataSourceRelation,
  DataSourceRow,
} from "@erp-framework/core";
import { useEffect, useState } from "react";
import { FormulaEditor } from "@/components/designer/FormulaEditor";
import { FieldDisplayToggle, useFieldDisplay } from "@/components/FieldDisplayToggle";
import { I } from "@/components/Icons";
import { Button, Card, FormField, Input, SearchableSelect } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { getFieldTypes } from "@/lib/field-types";
import type { EntityField } from "@/lib/object-types";
import { slugify, useUserObjects } from "@/stores/userObjects";

/** Cột phẳng khả dụng cho FormulaEditor (key/label/type). */
export interface FlatCol {
  key: string;
  label: string;
  type?: string;
}

const dsApi = createObjectsClient("");
const EMPTY: DataSourceConfig = { baseEntityId: "", relations: [], fields: [] };

function isLookup(f: EntityField): boolean {
  return (f.type === "lookup" || f.type === "multi-lookup") && !!f.ref;
}

export function DataSourceDesigner({ id }: { id: string }) {
  const entities = useUserObjects((s) => s.entities);
  const cfg = useUserObjects((s) => s.dataSourceContent[id]) ?? EMPTY;
  const setContent = useUserObjects((s) => s.setDataSourceContent);
  const dsName = useUserObjects((s) => s.dataSources.find((d) => d.id === id)?.name) ?? "";

  const [preview, setPreview] = useState<DataSourceRow[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [addFieldEntityId, setAddFieldEntityId] = useState<string | null>(null);

  // Chế độ hiển thị trường (TOÀN CỤC) — đồng bộ Nguồn dữ liệu / Trang / Workflow.
  const { mode: fieldMode, fieldDisp } = useFieldDisplay();
  // Hiển thị tên cột (string) trong ngữ cảnh 1 entity — tra field để lấy nhãn nếu cần.
  const colDisp = (entityId: string | undefined, fname?: string) => {
    if (!fname || fname === "id") return fname || "id";
    const f = entById(entityId)?.fields.find((x) => x.name === fname);
    return f ? fieldDisp(f) : fname;
  };

  const update = (patch: Partial<DataSourceConfig>) => setContent(id, { ...cfg, ...patch });

  /* ── Truy node (base | relation) ── */
  const entById = (eid?: string) => entities.find((e) => e.id === eid);
  const nodeEntityId = (rid: string): string | undefined =>
    rid === "base" ? cfg.baseEntityId : cfg.relations.find((r) => r.id === rid)?.targetEntityId;
  const nodeAlias = (rid: string): string =>
    rid === "base"
      ? entById(cfg.baseEntityId)?.name || "Gốc"
      : cfg.relations.find((r) => r.id === rid)?.alias || rid;
  const nodeFields = (rid: string): EntityField[] => entById(nodeEntityId(rid))?.fields ?? [];

  const nodes: string[] = ["base", ...cfg.relations.map((r) => r.id)];

  /* ── Base entity ── */
  const setBase = (entityId: string) => {
    if (entityId === cfg.baseEntityId) return;
    // Đổi gốc → xoá hết relation + field (tham chiếu cũ vô nghĩa).
    update({ baseEntityId: entityId, relations: [], fields: [] });
    setPreview(null);
  };

  /* ── Relations ── */
  const addRelation = (spec: {
    fromRid: string;
    fromField: string;
    targetEntityId: string;
    toField: string; // "id" = khớp record id; khác = join cột↔cột
    joinKind: "left" | "inner";
    alias: string;
  }) => {
    const rel: DataSourceRelation = {
      id: crypto.randomUUID(),
      alias: spec.alias.trim() || slugify(entById(spec.targetEntityId)?.name || ""),
      fromRelationId: spec.fromRid === "base" ? null : spec.fromRid,
      fromField: spec.fromField,
      toField: spec.toField === "id" ? undefined : spec.toField,
      targetEntityId: spec.targetEntityId,
      joinKind: spec.joinKind,
    };
    update({ relations: [...cfg.relations, rel] });
  };
  const removeRelation = (rid: string) => {
    // Xoá đệ quy cả relation con + field tham chiếu các node bị xoá.
    const dead = new Set([rid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of cfg.relations) {
        if (r.fromRelationId && dead.has(r.fromRelationId) && !dead.has(r.id)) {
          dead.add(r.id);
          changed = true;
        }
      }
    }
    update({
      relations: cfg.relations.filter((r) => !dead.has(r.id)),
      fields: cfg.fields.filter(
        (f) => f.sourceRelationId === "base" || !dead.has(f.sourceRelationId),
      ),
    });
  };
  const setRelAlias = (rid: string, alias: string) =>
    update({ relations: cfg.relations.map((r) => (r.id === rid ? { ...r, alias } : r)) });
  const setRelJoin = (rid: string, joinKind: "left" | "inner") =>
    update({ relations: cfg.relations.map((r) => (r.id === rid ? { ...r, joinKind } : r)) });
  const setRelToField = (rid: string, toField: string) =>
    update({
      relations: cfg.relations.map((r) =>
        r.id === rid ? { ...r, toField: toField === "id" ? undefined : toField } : r,
      ),
    });

  /* ── Projection (fields) ── */
  const mkKey = (rid: string, fname: string) =>
    rid === "base" ? fname : `${nodeAlias(rid)}_${fname}`;
  const hasField = (rid: string, fname: string) =>
    cfg.fields.some((f) => f.sourceRelationId === rid && f.sourceField === fname);
  const toggleField = (rid: string, field: EntityField) => {
    if (hasField(rid, field.name)) {
      update({
        fields: cfg.fields.filter(
          (f) => !(f.sourceRelationId === rid && f.sourceField === field.name),
        ),
      });
    } else {
      const nf: DataSourceField = {
        key: mkKey(rid, field.name),
        sourceRelationId: rid,
        sourceField: field.name,
        label: field.label || field.name,
        type: field.type,
        writable: rid === "base",
      };
      update({ fields: [...cfg.fields, nf] });
    }
  };
  const patchField = (key: string, patch: Partial<DataSourceField>) =>
    update({ fields: cfg.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) });

  /* ── Aggregate (1-N / N-N) ── */
  const aggregates = cfg.aggregates ?? [];
  const addAggregate = (agg: DataSourceAggregate) => update({ aggregates: [...aggregates, agg] });
  const patchAggregate = (key: string, patch: Partial<DataSourceAggregate>) =>
    update({ aggregates: aggregates.map((a) => (a.key === key ? { ...a, ...patch } : a)) });
  const removeAggregate = (key: string) =>
    update({ aggregates: aggregates.filter((a) => a.key !== key) });

  /* ── Cột tính toán (computed) ── */
  const computed = cfg.computed ?? [];
  const addComputed = (c: DataSourceComputed) => update({ computed: [...computed, c] });
  const patchComputed = (key: string, patch: Partial<DataSourceComputed>) =>
    update({ computed: computed.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const removeComputed = (key: string) =>
    update({ computed: computed.filter((c) => c.key !== key) });
  // Cột phẳng khả dụng cho formula = projection + aggregate + computed.
  const flatCols: FlatCol[] = [
    ...cfg.fields.map((f) => ({ key: f.key, label: f.label, type: f.type })),
    ...aggregates.map((a) => ({ key: a.key, label: a.label, type: "number" })),
    ...computed.map((c) => ({ key: c.key, label: c.label, type: c.type })),
  ];

  /* ── Preview ── */
  const loadPreview = async () => {
    if (!cfg.baseEntityId) {
      dialog.alert("Hãy chọn entity gốc trước.");
      return;
    }
    setPreviewing(true);
    try {
      const res = await dsApi.dataSources.listRecords(id, { limit: 20 });
      setPreview(res.rows as DataSourceRow[]);
    } catch (e) {
      dialog.alert(`Lỗi xem trước: ${(e as Error).message}`);
    } finally {
      setPreviewing(false);
    }
  };

  const projection = cfg.fields;
  const previewKeys =
    projection.length > 0 || aggregates.length > 0 || computed.length > 0
      ? [
          ...projection.map((f) => f.key),
          ...aggregates.map((a) => a.key),
          ...computed.map((c) => c.key),
        ]
      : ["id"];
  const baseEnt = entById(cfg.baseEntityId);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-text">{dsName || "Nguồn dữ liệu"}</h1>
          <p className="text-sm text-muted">
            Gộp field từ nhiều entity (join qua lookup) thành 1 bảng phẳng, đọc + ghi, gán cho
            widget.
          </p>
        </div>
        {cfg.baseEntityId && <FieldDisplayToggle className="shrink-0" />}
      </div>

      {/* Entity gốc */}
      <Card className="p-3">
        <FormField label="Entity gốc (gốc ghi — aggregate root)">
          <SearchableSelect
            value={cfg.baseEntityId}
            onChange={setBase}
            options={entities.map((e) => ({ value: e.id, label: e.name }))}
            placeholder="Chọn entity gốc"
            searchPlaceholder="Tìm entity…"
            className="w-72"
          />
        </FormField>
      </Card>

      {!cfg.baseEntityId ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
          <I.Database size={36} className="opacity-30" />
          <p className="text-sm">Chọn entity gốc để bắt đầu xây nguồn dữ liệu.</p>
        </div>
      ) : (
        <>
          {/* Quan hệ (join) */}
          <Card className="p-3 space-y-2">
            <div className="text-sm font-semibold text-text">Quan hệ (join qua lookup)</div>
            {cfg.relations.length === 0 && (
              <p className="text-xs text-muted italic">
                Chưa có quan hệ — chỉ dùng field của entity gốc.
              </p>
            )}
            {cfg.relations.map((rel) => (
              <div
                key={rel.id}
                className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-xs"
              >
                <span className="text-muted">
                  {nodeAlias(rel.fromRelationId ?? "base")}.
                  <b>{colDisp(nodeEntityId(rel.fromRelationId ?? "base"), rel.fromField)}</b> ={" "}
                  {entById(rel.targetEntityId)?.name ?? rel.targetEntityId}.
                </span>
                {/* Cột đích khớp (id = lookup cổ điển; khác = join cột↔cột) */}
                <SearchableSelect
                  className="w-36"
                  value={rel.toField || "id"}
                  onChange={(v) => setRelToField(rel.id, v)}
                  options={[
                    { value: "id", label: "id (record id)" },
                    ...nodeFields(rel.id).map((f) => ({
                      value: f.name,
                      label: fieldDisp(f),
                    })),
                  ]}
                />
                <span className="text-muted">alias:</span>
                <Input
                  className="h-7 w-32"
                  value={rel.alias}
                  onChange={(e) => setRelAlias(rel.id, e.target.value)}
                />
                <SearchableSelect
                  className="w-28"
                  value={rel.joinKind}
                  onChange={(v) => setRelJoin(rel.id, v as "left" | "inner")}
                  options={[
                    { value: "left", label: "left (giữ)" },
                    { value: "inner", label: "inner (lọc)" },
                  ]}
                />
                <button
                  type="button"
                  onClick={() => removeRelation(rel.id)}
                  className="ml-auto text-muted hover:text-danger"
                  title="Xoá quan hệ"
                >
                  <I.X size={13} />
                </button>
              </div>
            ))}
            {/* Thêm quan hệ: chọn node nguồn + cột nguồn + entity đích + cột đích */}
            <AddRelation
              nodes={nodes}
              nodeAlias={nodeAlias}
              nodeFields={nodeFields}
              entities={entities}
              entById={entById}
              onAdd={addRelation}
              fieldDisp={fieldDisp}
            />
          </Card>

          {/* Cột chiếu (projection) */}
          <Card className="p-3 space-y-3">
            <div className="text-sm font-semibold text-text">
              Cột (projection) — tick để đưa field vào bảng phẳng
            </div>
            {nodes.map((rid) => {
              const fields = nodeFields(rid);
              const eid = nodeEntityId(rid);
              return (
                <div key={rid}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-medium text-accent">
                      {nodeAlias(rid)}
                      {rid === "base" ? " (gốc)" : ""}
                    </span>
                    {eid && (
                      <button
                        type="button"
                        onClick={() => setAddFieldEntityId(eid)}
                        className="text-[10px] text-muted hover:text-accent flex items-center gap-0.5"
                        title="Thêm trường mới vào entity"
                      >
                        <I.Plus size={10} /> trường
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {fields.length === 0 ? (
                      <span className="text-[11px] text-muted italic">Chưa có field</span>
                    ) : (
                      fields.map((f) => {
                        const on = hasField(rid, f.name);
                        return (
                          <button
                            key={f.name}
                            type="button"
                            onClick={() => toggleField(rid, f)}
                            className={`rounded border px-2 py-0.5 text-xs ${
                              on
                                ? "border-accent bg-accent/10 text-accent"
                                : "border-border text-muted hover:border-accent/50"
                            }`}
                            title={fieldMode === "label" ? f.name : f.label || f.name}
                          >
                            {fieldDisp(f)}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}

            {/* Bảng cấu hình cột đã chọn (alias key + label + writable) */}
            {projection.length > 0 && (
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-bg-soft border-b border-border text-muted">
                      <th className="px-2 py-1 text-left">Nguồn</th>
                      <th className="px-2 py-1 text-left">Khóa (key)</th>
                      <th className="px-2 py-1 text-left">Nhãn</th>
                      <th className="px-2 py-1 text-center">Cho ghi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projection.map((f) => (
                      <tr key={f.key} className="border-b border-border/50 last:border-0">
                        <td className="px-2 py-1 text-muted">
                          {nodeAlias(f.sourceRelationId)}.
                          {colDisp(nodeEntityId(f.sourceRelationId), f.sourceField)}
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            className="h-6 w-32"
                            value={f.key}
                            onChange={(e) => patchField(f.key, { key: slugify(e.target.value) })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            className="h-6 w-36"
                            value={f.label}
                            onChange={(e) => patchField(f.key, { label: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            className="accent-accent"
                            checked={f.writable === true}
                            onChange={(e) => patchField(f.key, { writable: e.target.checked })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-muted">
              Field gốc cho ghi → tạo/sửa record gốc. Field join chỉ cho ghi khi tick "Cho ghi" (ghi
              về record liên quan). Lọc/sắp xếp trên field join là gần đúng trong trang đã tải.
            </p>
          </Card>

          {/* Aggregate (1-N / N-N) */}
          <Card className="p-3 space-y-2">
            <div className="text-sm font-semibold text-text">Aggregate (gom quan hệ 1-N / N-N)</div>
            {aggregates.length === 0 && (
              <p className="text-xs text-muted italic">
                Chưa có cột gom — vd đếm số dòng đơn, tổng tiền các dòng con…
              </p>
            )}
            {aggregates.map((a) => (
              <div
                key={a.key}
                className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-xs"
              >
                <span className="font-mono text-accent">{a.key}</span>
                <span className="text-muted">
                  = {a.agg.toUpperCase()}
                  {a.agg !== "count" && a.valueField
                    ? `(${colDisp(a.via?.farEntityId ?? a.targetEntityId, a.valueField)})`
                    : "(*)"}{" "}
                  của {entById(a.targetEntityId)?.name ?? a.targetEntityId}.
                  {colDisp(a.targetEntityId, a.targetField)}
                  {a.via
                    ? ` → ${entById(a.via.farEntityId)?.name ?? a.via.farEntityId} (N-N)`
                    : " (1-N)"}
                </span>
                <span className="text-muted">nhãn:</span>
                <Input
                  className="h-7 w-36"
                  value={a.label}
                  onChange={(e) => patchAggregate(a.key, { label: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removeAggregate(a.key)}
                  className="ml-auto text-muted hover:text-danger"
                  title="Xoá aggregate"
                >
                  <I.X size={13} />
                </button>
              </div>
            ))}
            <AddAggregate
              nodes={nodes}
              nodeAlias={nodeAlias}
              nodeFields={nodeFields}
              entities={entities}
              entById={entById}
              existingKeys={aggregates.map((a) => a.key)}
              onAdd={addAggregate}
              fieldDisp={fieldDisp}
            />
            <p className="text-[11px] text-muted">
              1-N: gom record con trỏ ngược (vd ChiTietDon.don_id = id đơn). N-N: qua bảng nối +
              entity far. Cột aggregate chỉ đọc, kiểu số.
            </p>
          </Card>

          {/* Cột tính toán (computed) */}
          <Card className="p-3 space-y-2">
            <div className="text-sm font-semibold text-text">Cột tính toán (formula)</div>
            <ComputedColumns
              computed={computed}
              availableCols={flatCols}
              onAdd={addComputed}
              onPatch={patchComputed}
              onRemove={removeComputed}
            />
            <p className="text-[11px] text-muted">
              Biểu thức trên CỘT PHẲNG khác (tham chiếu <code>{"{key}"}</code>) + hàm
              IF/CONCAT/ROUND… Cột chỉ đọc, eval sau projection + aggregate.
            </p>
          </Card>

          {/* Số dòng + xem trước */}
          <Card className="p-3 space-y-2">
            <div className="flex items-end gap-3">
              <FormField label="Số dòng mặc định">
                <Input
                  type="number"
                  min="1"
                  className="w-28"
                  value={cfg.defaultLimit ?? ""}
                  placeholder="100"
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    update({ defaultLimit: Number.isFinite(n) && n > 0 ? n : undefined });
                  }}
                />
              </FormField>
              <Button
                onClick={loadPreview}
                disabled={previewing}
                className="flex items-center gap-1.5"
              >
                {previewing ? <I.Loader size={14} className="animate-spin" /> : <I.Eye size={14} />}
                Xem trước
              </Button>
              {baseEnt && (
                <span className="text-xs text-muted">
                  {projection.length} cột · {cfg.relations.length} quan hệ
                </span>
              )}
            </div>

            {preview && (
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-bg-soft border-b border-border text-muted">
                      {previewKeys.map((k) => (
                        <th key={k} className="px-2 py-1 text-left whitespace-nowrap">
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={row.id} className="border-b border-border/50 last:border-0">
                        {previewKeys.map((k) => (
                          <td key={k} className="px-2 py-1 whitespace-nowrap">
                            {String(row[k] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {preview.length === 0 && (
                      <tr>
                        <td
                          className="px-2 py-2 text-muted italic"
                          colSpan={Math.max(1, previewKeys.length)}
                        >
                          Không có dữ liệu.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <AddEntityFieldModal entityId={addFieldEntityId} onClose={() => setAddFieldEntityId(null)} />
    </div>
  );
}

/* ── Sub: thêm quan hệ (node nguồn + cột nguồn + entity đích + cột đích) ──
   Hỗ trợ cả lookup (khớp record id) lẫn join cột↔cột (khớp cột bất kỳ). Khi
   chọn entity đích, nếu node cha có field lookup trỏ tới nó → tự điền cột
   nguồn = lookup đó + cột đích = id (lối tắt cho quan hệ lookup cổ điển). */
function AddRelation({
  nodes,
  nodeAlias,
  nodeFields,
  entities,
  entById,
  onAdd,
  fieldDisp = (f) => f.name,
}: {
  nodes: string[];
  nodeAlias: (rid: string) => string;
  nodeFields: (rid: string) => EntityField[];
  entities: ReturnType<typeof useUserObjects.getState>["entities"];
  entById: (eid?: string) => (typeof entities)[number] | undefined;
  onAdd: (spec: {
    fromRid: string;
    fromField: string;
    targetEntityId: string;
    toField: string;
    joinKind: "left" | "inner";
    alias: string;
  }) => void;
  /** Cách hiển thị tên trường (nhãn ↔ tên cột); mặc định tên cột. */
  fieldDisp?: (f: { name: string; label?: string }) => string;
}) {
  const [fromRid, setFromRid] = useState("base");
  const [targetEntityId, setTargetEntityId] = useState("");
  const [fromField, setFromField] = useState("");
  const [toField, setToField] = useState("id");
  const [joinKind, setJoinKind] = useState<"left" | "inner">("left");
  const [alias, setAlias] = useState("");

  const parentFields = nodeFields(fromRid);
  const targetEnt = entById(targetEntityId);

  const pickTarget = (eid: string) => {
    setTargetEntityId(eid);
    const tgt = entById(eid);
    setAlias(slugify(tgt?.name || ""));
    // Gợi ý lookup→id nếu node cha có lookup trỏ tới target.
    const lookup = parentFields.find((f) => isLookup(f) && f.ref === eid);
    if (lookup) {
      setFromField(lookup.name);
      setToField("id");
    } else {
      const pkName = tgt?.primaryKey
        ? (tgt.fields.find((f) => f.id === tgt.primaryKey)?.name ?? "id")
        : "id";
      setToField(pkName);
    }
  };

  const submit = () => {
    if (!targetEntityId || !fromField) return;
    onAdd({ fromRid, fromField, targetEntityId, toField, joinKind, alias });
    // reset (giữ fromRid để thêm tiếp nhiều quan hệ cùng node).
    setTargetEntityId("");
    setFromField("");
    setToField("id");
    setAlias("");
  };

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
      <div>
        <p className="mb-1 text-[11px] text-muted">Từ node</p>
        <SearchableSelect
          className="w-36"
          value={fromRid}
          onChange={(v) => {
            setFromRid(v);
            setFromField("");
          }}
          options={nodes.map((n) => ({ value: n, label: nodeAlias(n) }))}
        />
      </div>
      <div>
        <p className="mb-1 text-[11px] text-muted">Cột nguồn</p>
        <SearchableSelect
          className="w-40"
          value={fromField}
          onChange={setFromField}
          options={parentFields.map((f) => ({ value: f.name, label: fieldDisp(f) }))}
          placeholder="Chọn cột…"
        />
      </div>
      <div>
        <p className="mb-1 text-[11px] text-muted">Đối tượng đích</p>
        <SearchableSelect
          className="w-40"
          value={targetEntityId}
          onChange={pickTarget}
          options={entities.map((e) => ({ value: e.id, label: e.name }))}
          placeholder="Chọn entity…"
          searchPlaceholder="Tìm entity…"
        />
      </div>
      <div>
        <p className="mb-1 text-[11px] text-muted">Cột đích (khớp)</p>
        <SearchableSelect
          className="w-40"
          value={toField}
          onChange={setToField}
          options={[
            { value: "id", label: "id (record id)" },
            ...(targetEnt?.fields.map((f) => ({ value: f.name, label: fieldDisp(f) })) ?? []),
          ]}
        />
      </div>
      <div>
        <p className="mb-1 text-[11px] text-muted">Alias</p>
        <Input className="h-9 w-32" value={alias} onChange={(e) => setAlias(e.target.value)} />
      </div>
      <div>
        <p className="mb-1 text-[11px] text-muted">Join</p>
        <SearchableSelect
          className="w-24"
          value={joinKind}
          onChange={(v) => setJoinKind(v as "left" | "inner")}
          options={[
            { value: "left", label: "left" },
            { value: "inner", label: "inner" },
          ]}
        />
      </div>
      <Button onClick={submit} disabled={!targetEntityId || !fromField} className="h-9">
        Thêm quan hệ
      </Button>
    </div>
  );
}

/* ── Sub: thêm aggregate (1-N reverse FK / N-N qua bảng nối) ──
   Export để Canvas tái dùng cùng form. */
export function AddAggregate({
  nodes,
  nodeAlias,
  nodeFields,
  entities,
  entById,
  existingKeys,
  onAdd,
  fixedFromRid,
  fieldDisp = (f) => f.name,
}: {
  nodes: string[];
  nodeAlias: (rid: string) => string;
  nodeFields: (rid: string) => EntityField[];
  entities: ReturnType<typeof useUserObjects.getState>["entities"];
  entById: (eid?: string) => (typeof entities)[number] | undefined;
  existingKeys: string[];
  onAdd: (agg: DataSourceAggregate) => void;
  /** Khi set: khoá node nguồn = node này, ẩn selector "Node nguồn". */
  fixedFromRid?: string;
  /** Cách hiển thị tên trường (nhãn ↔ tên cột); mặc định tên cột. */
  fieldDisp?: (f: { name: string; label?: string }) => string;
}) {
  const [key, setKey] = useState("");
  const [fn, setFn] = useState<AggFn>("count");
  const [fromRid, setFromRid] = useState(fixedFromRid ?? "base");
  const [matchField, setMatchField] = useState("id");
  const [ofEntityId, setOfEntityId] = useState("");
  const [targetField, setTargetField] = useState("");
  const [valueField, setValueField] = useState("");
  const [viaOn, setViaOn] = useState(false);
  const [farEntityId, setFarEntityId] = useState("");
  const [farField, setFarField] = useState("");

  const sourceFields = nodeFields(fromRid);
  const ofEnt = entById(ofEntityId);
  const farEnt = entById(farEntityId);
  const valueHostFields = viaOn ? (farEnt?.fields ?? []) : (ofEnt?.fields ?? []);
  const needValue = fn !== "count";

  const reset = () => {
    setKey("");
    setTargetField("");
    setValueField("");
    setViaOn(false);
    setFarEntityId("");
    setFarField("");
  };

  const submit = () => {
    const k = slugify(key);
    if (!k || !ofEntityId || !targetField) {
      dialog.alert("Cần: key, đối tượng nhiều, và cột FK khớp.");
      return;
    }
    if (existingKeys.includes(k)) {
      dialog.alert(`Key "${k}" đã tồn tại.`);
      return;
    }
    if (needValue && !valueField) {
      dialog.alert(`${fn.toUpperCase()} cần chọn cột giá trị.`);
      return;
    }
    if (viaOn && (!farEntityId || !farField)) {
      dialog.alert("N-N cần chọn entity far + cột nối tới far.");
      return;
    }
    const agg: DataSourceAggregate = {
      key: k,
      label: k,
      agg: fn,
      ...(fromRid !== "base" ? { sourceRelationId: fromRid } : {}),
      ...(matchField && matchField !== "id" ? { matchField } : {}),
      targetEntityId: ofEntityId,
      targetField,
      ...(needValue && valueField ? { valueField } : {}),
      ...(viaOn && farEntityId && farField ? { via: { farEntityId, farField } } : {}),
    };
    onAdd(agg);
    reset();
  };

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
      <div>
        <p className="mb-1 text-[11px] text-muted">Key cột</p>
        <Input
          className="h-9 w-28"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="so_dong"
        />
      </div>
      <div>
        <p className="mb-1 text-[11px] text-muted">Hàm</p>
        <SearchableSelect
          className="w-24"
          value={fn}
          onChange={(v) => setFn(v as AggFn)}
          options={(["count", "sum", "avg", "min", "max"] as const).map((f) => ({
            value: f,
            label: f,
          }))}
        />
      </div>
      {!fixedFromRid && (
        <div>
          <p className="mb-1 text-[11px] text-muted">Node nguồn</p>
          <SearchableSelect
            className="w-32"
            value={fromRid}
            onChange={(v) => {
              setFromRid(v);
              setMatchField("id");
            }}
            options={nodes.map((n) => ({ value: n, label: nodeAlias(n) }))}
          />
        </div>
      )}
      <div>
        <p className="mb-1 text-[11px] text-muted">Khớp theo</p>
        <SearchableSelect
          className="w-32"
          value={matchField}
          onChange={setMatchField}
          options={[
            { value: "id", label: "id (record id)" },
            ...sourceFields.map((f) => ({ value: f.name, label: fieldDisp(f) })),
          ]}
        />
      </div>
      <div>
        <p className="mb-1 text-[11px] text-muted">Đối tượng nhiều</p>
        <SearchableSelect
          className="w-36"
          value={ofEntityId}
          onChange={(v) => {
            setOfEntityId(v);
            setTargetField("");
            setValueField("");
          }}
          options={entities.map((e) => ({ value: e.id, label: e.name }))}
          placeholder="bảng con/nối…"
          searchPlaceholder="Tìm…"
        />
      </div>
      <div>
        <p className="mb-1 text-[11px] text-muted">Cột FK (khớp)</p>
        <SearchableSelect
          className="w-36"
          value={targetField}
          onChange={setTargetField}
          options={(ofEnt?.fields ?? []).map((f) => ({ value: f.name, label: fieldDisp(f) }))}
          placeholder="FK → nguồn"
        />
      </div>
      {/* N-N toggle */}
      <label className="flex items-center gap-1 text-[11px] text-muted h-9">
        <input
          type="checkbox"
          className="accent-accent"
          checked={viaOn}
          onChange={(e) => setViaOn(e.target.checked)}
        />
        N-N (bảng nối)
      </label>
      {viaOn && (
        <>
          <div>
            <p className="mb-1 text-[11px] text-muted">Entity far</p>
            <SearchableSelect
              className="w-36"
              value={farEntityId}
              onChange={(v) => {
                setFarEntityId(v);
                setValueField("");
              }}
              options={entities.map((e) => ({ value: e.id, label: e.name }))}
              placeholder="entity thật…"
            />
          </div>
          <div>
            <p className="mb-1 text-[11px] text-muted">Cột nối → far</p>
            <SearchableSelect
              className="w-32"
              value={farField}
              onChange={setFarField}
              options={(ofEnt?.fields ?? []).map((f) => ({ value: f.name, label: fieldDisp(f) }))}
              placeholder="FK → far"
            />
          </div>
        </>
      )}
      {needValue && (
        <div>
          <p className="mb-1 text-[11px] text-muted">Cột giá trị</p>
          <SearchableSelect
            className="w-32"
            value={valueField}
            onChange={setValueField}
            options={valueHostFields.map((f) => ({ value: f.name, label: fieldDisp(f) }))}
            placeholder="số để gom"
          />
        </div>
      )}
      <Button
        onClick={submit}
        disabled={!key.trim() || !ofEntityId || !targetField}
        className="h-9"
      >
        Thêm aggregate
      </Button>
    </div>
  );
}

/* ── Sub: cột tính toán (formula). Dùng chung Config tab + Canvas. ── */
export function ComputedColumns({
  computed,
  availableCols,
  onAdd,
  onPatch,
  onRemove,
}: {
  computed: DataSourceComputed[];
  availableCols: FlatCol[];
  onAdd: (c: DataSourceComputed) => void;
  onPatch: (key: string, patch: Partial<DataSourceComputed>) => void;
  onRemove: (key: string) => void;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftExpr, setDraftExpr] = useState("");

  const taken = new Set([...computed.map((c) => c.key), ...availableCols.map((c) => c.key)]);
  const addDraft = () => {
    const k = slugify(draftKey);
    if (!k) {
      dialog.alert("Cần key cho cột.");
      return;
    }
    if (taken.has(k)) {
      dialog.alert(`Key "${k}" đã tồn tại.`);
      return;
    }
    if (!draftExpr.trim()) {
      dialog.alert("Cần biểu thức.");
      return;
    }
    onAdd({ key: k, label: draftLabel.trim() || k, expr: draftExpr });
    setDraftKey("");
    setDraftLabel("");
    setDraftExpr("");
  };

  return (
    <div className="space-y-2">
      {computed.length === 0 && (
        <p className="text-[11px] text-muted italic">Chưa có cột tính toán.</p>
      )}
      {computed.map((c) => (
        <div key={c.key} className="rounded border border-border p-2 text-xs space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-accent flex-1 truncate">{c.key}</span>
            <button
              type="button"
              onClick={() => setEditingKey(editingKey === c.key ? null : c.key)}
              className="text-muted hover:text-accent"
              title="Sửa biểu thức"
            >
              <I.Edit size={13} />
            </button>
            <button
              type="button"
              onClick={() => onRemove(c.key)}
              className="text-muted hover:text-danger"
              title="Xoá cột"
            >
              <I.X size={13} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted shrink-0">nhãn</span>
            <Input
              className="h-6 flex-1"
              value={c.label}
              onChange={(e) => onPatch(c.key, { label: e.target.value })}
            />
          </div>
          {editingKey === c.key ? (
            <FormulaEditor
              value={c.expr}
              onChange={(v) => onPatch(c.key, { expr: v })}
              availableFields={availableCols.filter((x) => x.key !== c.key)}
            />
          ) : (
            <code className="block text-[11px] text-muted truncate">{c.expr || "—"}</code>
          )}
        </div>
      ))}

      <div className="rounded border border-dashed border-border p-2 space-y-2">
        <div className="flex items-center gap-2">
          <Input
            className="h-7 w-36"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder="key (thanh_tien)"
          />
          <Input
            className="h-7 flex-1"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="Nhãn"
          />
        </div>
        <FormulaEditor value={draftExpr} onChange={setDraftExpr} availableFields={availableCols} />
        <Button onClick={addDraft} disabled={!draftKey.trim() || !draftExpr.trim()} className="h-8">
          Thêm cột tính toán
        </Button>
      </div>
    </div>
  );
}

/* ── Modal: thêm TRƯỜNG mới vào entity (base hoặc target relation) ngay từ
   datasource. Entity low-code → chỉ cập nhật metadata fields (KHÔNG migration);
   updateEntity tự lưu server (RBAC edit entity). Dùng chung Config tab + Canvas. */
/* Form thêm trường vào entity — dùng chung cho modal (popup) lẫn tab
   trong side panel của DataSourceCanvas. Sau khi thêm, reset field để
   nhập tiếp; node trên canvas tự cập nhật (đọc entities từ store). */
export function AddEntityFieldForm({
  entityId,
  onDone,
  showCancel,
}: {
  entityId: string | null;
  onDone?: () => void;
  showCancel?: boolean;
}) {
  const entities = useUserObjects((s) => s.entities);
  const updateEntity = useUserObjects((s) => s.updateEntity);
  const ent = entities.find((e) => e.id === entityId);
  const fieldTypes = getFieldTypes();

  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState("text");
  const [required, setRequired] = useState(false);
  const [ref, setRef] = useState("");
  const [optionsText, setOptionsText] = useState("");

  const resetFields = () => {
    setName("");
    setLabel("");
    setType("text");
    setRequired(false);
    setRef("");
    setOptionsText("");
  };

  // Reset khi đổi entity (mở cho entity mới).
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ reset khi đổi entityId
  useEffect(() => {
    if (entityId) resetFields();
  }, [entityId]);

  if (!entityId || !ent) return null;
  const isRef = type === "lookup" || type === "multi-lookup";
  const isOpt = type === "select" || type === "multiselect";

  const submit = () => {
    const fname = slugify(name || label);
    if (!fname) {
      dialog.alert("Cần tên trường.");
      return;
    }
    if (ent.fields.some((f) => f.name === fname)) {
      dialog.alert(`Trường "${fname}" đã tồn tại trên ${ent.name}.`);
      return;
    }
    if (isRef && !ref) {
      dialog.alert("Lookup cần chọn entity tham chiếu.");
      return;
    }
    const nf: EntityField = {
      id: `nf_${crypto.randomUUID().slice(0, 8)}`,
      name: fname,
      label: label.trim() || fname,
      type,
      ...(required ? { required: true } : {}),
      ...(isRef ? { ref } : {}),
      ...(isOpt
        ? {
            options: optionsText
              .split(/[\n,]/)
              .map((s) => s.trim())
              .filter(Boolean),
          }
        : {}),
    };
    updateEntity(entityId, { fields: [...ent.fields, nf] });
    resetFields();
    onDone?.();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <FormField label="Tên trường (snake_case)">
          <Input
            className="h-8"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="vd: ghi_chu"
          />
        </FormField>
        <FormField label="Nhãn">
          <Input
            className="h-8"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ghi chú"
          />
        </FormField>
      </div>

      <FormField label="Kiểu">
        <SearchableSelect
          className="w-full"
          value={type}
          onChange={setType}
          options={fieldTypes.map((ft) => ({ value: ft.id, label: `${ft.name} — ${ft.desc}` }))}
          searchPlaceholder="Tìm kiểu…"
        />
      </FormField>

      {isRef && (
        <FormField label="Entity tham chiếu (lookup)">
          <SearchableSelect
            className="w-full"
            value={ref}
            onChange={setRef}
            options={entities.map((e) => ({ value: e.id, label: e.name }))}
            placeholder="Chọn entity…"
            searchPlaceholder="Tìm entity…"
          />
        </FormField>
      )}
      {isOpt && (
        <FormField label="Tuỳ chọn (mỗi dòng / phẩy 1 giá trị)">
          <textarea
            className="input font-mono text-xs w-full"
            rows={3}
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            placeholder={"A\nB\nC"}
          />
        </FormField>
      )}

      <label className="flex items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          className="accent-accent"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
        />
        Bắt buộc
      </label>

      <p className="text-[11px] text-muted">
        Entity low-code: thêm trường chỉ cập nhật metadata, không cần migration. Record cũ để trống
        trường mới.
      </p>

      <div className="flex gap-2 justify-end pt-1">
        {showCancel && (
          <button
            type="button"
            onClick={onDone}
            className="h-8 px-3 text-sm rounded-lg border border-border hover:bg-hover/50"
          >
            Huỷ
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!(name.trim() || label.trim())}
          className="h-8 px-4 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-40"
        >
          Thêm trường
        </button>
      </div>
    </div>
  );
}

export function AddEntityFieldModal({
  entityId,
  onClose,
}: {
  entityId: string | null;
  onClose: () => void;
}) {
  const ent = useUserObjects((s) => s.entities).find((e) => e.id === entityId);
  if (!entityId || !ent) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[420px] max-w-full bg-panel border border-border rounded-xl shadow-2xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm">
            Thêm trường vào <span className="text-accent font-mono">{ent.name}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded hover:bg-hover/60 flex items-center justify-center text-muted"
          >
            <I.X size={13} />
          </button>
        </div>
        <AddEntityFieldForm entityId={entityId} onDone={onClose} showCancel />
      </div>
    </div>
  );
}
