/* ==========================================================
   DataSourceDesigner — builder cho "Nguồn dữ liệu" (ORM-like):
   chọn entity gốc → thêm quan hệ (join qua field lookup, có thể
   lồng) → chọn/đặt cột chiếu (projection, alias + writable) →
   số dòng mặc định → xem trước bảng phẳng đã join.
   Lưu qua userObjects.setDataSourceContent (optimistic + bg save).
   ========================================================== */

import { createObjectsClient } from "@erp-framework/client";
import type {
  DataSourceConfig,
  DataSourceField,
  DataSourceRelation,
  DataSourceRow,
} from "@erp-framework/core";
import { useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, FormField, Input, SearchableSelect } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import type { EntityField } from "@/lib/object-types";
import { slugify, useUserObjects } from "@/stores/userObjects";

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
  const addRelation = (fromRid: string, field: EntityField) => {
    const rel: DataSourceRelation = {
      id: crypto.randomUUID(),
      alias: slugify(field.label || field.name),
      fromRelationId: fromRid === "base" ? null : fromRid,
      fromField: field.name,
      targetEntityId: field.ref as string,
      joinKind: "left",
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
  const baseEnt = entById(cfg.baseEntityId);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div>
        <h1 className="text-lg font-bold text-text">{dsName || "Nguồn dữ liệu"}</h1>
        <p className="text-sm text-muted">
          Gộp field từ nhiều entity (join qua lookup) thành 1 bảng phẳng, đọc + ghi, gán cho widget.
        </p>
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
                  {nodeAlias(rel.fromRelationId ?? "base")}.<b>{rel.fromField}</b> →{" "}
                  {entById(rel.targetEntityId)?.name ?? rel.targetEntityId}
                </span>
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
            {/* Thêm quan hệ: chọn node nguồn + field lookup */}
            <AddRelation
              nodes={nodes}
              nodeAlias={nodeAlias}
              lookupFieldsOf={(rid) => nodeFields(rid).filter(isLookup)}
              onAdd={addRelation}
            />
          </Card>

          {/* Cột chiếu (projection) */}
          <Card className="p-3 space-y-3">
            <div className="text-sm font-semibold text-text">
              Cột (projection) — tick để đưa field vào bảng phẳng
            </div>
            {nodes.map((rid) => {
              const fields = nodeFields(rid);
              if (fields.length === 0) return null;
              return (
                <div key={rid}>
                  <div className="mb-1 text-xs font-medium text-accent">
                    {nodeAlias(rid)}
                    {rid === "base" ? " (gốc)" : ""}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {fields.map((f) => {
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
                        >
                          {f.label || f.name}
                        </button>
                      );
                    })}
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
                          {nodeAlias(f.sourceRelationId)}.{f.sourceField}
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
                      {(projection.length > 0 ? projection.map((f) => f.key) : ["id"]).map((k) => (
                        <th key={k} className="px-2 py-1 text-left whitespace-nowrap">
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={row.id} className="border-b border-border/50 last:border-0">
                        {(projection.length > 0 ? projection.map((f) => f.key) : ["id"]).map(
                          (k) => (
                            <td key={k} className="px-2 py-1 whitespace-nowrap">
                              {String(row[k] ?? "")}
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                    {preview.length === 0 && (
                      <tr>
                        <td
                          className="px-2 py-2 text-muted italic"
                          colSpan={Math.max(1, projection.length)}
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
    </div>
  );
}

/* ── Sub: thêm quan hệ (chọn node nguồn + field lookup) ── */
function AddRelation({
  nodes,
  nodeAlias,
  lookupFieldsOf,
  onAdd,
}: {
  nodes: string[];
  nodeAlias: (rid: string) => string;
  lookupFieldsOf: (rid: string) => EntityField[];
  onAdd: (fromRid: string, field: EntityField) => void;
}) {
  const [fromRid, setFromRid] = useState("base");
  const fields = lookupFieldsOf(fromRid);

  return (
    <div className="flex flex-wrap items-end gap-2 pt-1">
      <div>
        <p className="mb-1 text-[11px] text-muted">Từ node</p>
        <SearchableSelect
          className="w-40"
          value={fromRid}
          onChange={setFromRid}
          options={nodes.map((n) => ({ value: n, label: nodeAlias(n) }))}
        />
      </div>
      <div>
        <p className="mb-1 text-[11px] text-muted">Field lookup → thêm quan hệ</p>
        {fields.length === 0 ? (
          <span className="text-xs text-muted italic">Node này không có field lookup.</span>
        ) : (
          <SearchableSelect
            className="w-52"
            value=""
            onChange={(fname) => {
              const f = fields.find((x) => x.name === fname);
              if (f) onAdd(fromRid, f);
            }}
            options={fields.map((f) => ({ value: f.name, label: `${f.label || f.name}` }))}
            placeholder="Chọn field lookup…"
            emptyOption="—"
          />
        )}
      </div>
    </div>
  );
}
