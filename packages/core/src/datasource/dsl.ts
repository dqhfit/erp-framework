/* ==========================================================
   dsl.ts — "Code" cho Nguồn dữ liệu: một DSL gọn dùng TÊN đối
   tượng + alias (thay vì id nội bộ + UUID relation) để con người
   đọc/viết được và để LLM sinh ra. compile/decompile chuyển qua
   lại với DataSourceConfig (id-based) mà resolver dùng.

   - compileDataSourceDsl(dsl, entities) → DataSourceConfig + lỗi/cảnh báo.
   - decompileToDsl(config, entities) → DSL để hiển thị/sửa.

   Pure, không I/O — tái dùng được ở client (editor + AI), server,
   và migration tooling. Relation id sinh DETERMINISTIC từ alias
   (`rel_<slug(alias)>`) nên compile lại không churn id, sourceRelationId
   tham chiếu ổn định.
   ========================================================== */

import type {
  AggFn,
  DataSourceAggregate,
  DataSourceConfig,
  DataSourceField,
  DataSourceRelation,
  JoinKind,
} from "./config";

/* ─── DSL shape (TÊN-based, cho người + LLM) ──────────────── */

export interface DataSourceDslJoin {
  /** Alias duy nhất của quan hệ (đặt tên node con). */
  as: string;
  /** Node cha: TÊN đối tượng gốc HOẶC alias của một join trước (lồng). */
  from: string;
  /** Cột trên node cha chứa giá trị nối. */
  fromField: string;
  /** TÊN đối tượng đích. */
  to: string;
  /** Cột đích để khớp; bỏ trống/"id" = khớp record id (lookup cổ điển). */
  toField?: string;
  /** "left" (mặc định, giữ row gốc) | "inner" (lọc row thiếu). */
  kind?: JoinKind;
}

export interface DataSourceDslColumn {
  /** Node nguồn: TÊN đối tượng gốc HOẶC alias join. */
  from: string;
  /** Tên field trên node nguồn. */
  field: string;
  /** Khoá phẳng (key) — bỏ trống thì tự suy ra. */
  as?: string;
  label?: string;
  writable?: boolean;
}

/** Aggregate 1-N / N-N (tên-based). */
export interface DataSourceDslAgg {
  /** Khoá phẳng (key). */
  as: string;
  label?: string;
  /** count | sum | avg | min | max. */
  fn: AggFn;
  /** TÊN entity "nhiều": bảng con (1-N) hoặc bảng nối (N-N). */
  of: string;
  /** Field FK trên `of` khớp node nguồn. */
  byField: string;
  /** Node nguồn: TÊN gốc HOẶC alias join. Mặc định base. */
  from?: string;
  /** Field trên node nguồn để khớp. Mặc định "id". */
  matchField?: string;
  /** Field giá trị để gom (sum/avg/min/max). */
  valueField?: string;
  /** N-N qua bảng nối: entity far + field nối. */
  via?: { entity: string; field: string; keyField?: string };
}

export interface DataSourceDsl {
  /** TÊN đối tượng gốc (aggregate root). */
  base: string;
  joins?: DataSourceDslJoin[];
  columns?: DataSourceDslColumn[];
  /** Cột aggregate quan hệ 1-N / N-N. */
  aggregates?: DataSourceDslAgg[];
  /** Số dòng mặc định. */
  limit?: number;
}

/** Catalog đối tượng tối thiểu compiler cần (id ↔ tên ↔ field). */
export interface DslEntity {
  id: string;
  name: string;
  fields: Array<{ name: string; type: string; ref?: string }>;
  primaryKey?: string;
}

export interface CompileResult {
  config: DataSourceConfig;
  /** Lỗi chặn (vd thiếu đối tượng gốc/đích) — không nên apply. */
  errors: string[];
  /** Cảnh báo (vd field không tồn tại) — vẫn apply được. */
  warnings: string[];
}

/* ─── Helpers ─────────────────────────────────────────────── */

function slug(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // bỏ dấu tổ hợp Unicode (à→a, ế→e…)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const ridOf = (alias: string): string => `rel_${slug(alias)}`;

/* ─── Compile: DSL (tên) → DataSourceConfig (id) ──────────── */

export function compileDataSourceDsl(dsl: DataSourceDsl, entities: DslEntity[]): CompileResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const empty: DataSourceConfig = { baseEntityId: "", relations: [], fields: [] };

  const byName = new Map(entities.map((e) => [e.name.toLowerCase(), e]));
  const baseEnt = byName.get((dsl.base || "").toLowerCase());
  if (!baseEnt) {
    errors.push(`Không tìm thấy đối tượng gốc "${dsl.base}".`);
    return { config: empty, errors, warnings };
  }

  const joins = dsl.joins ?? [];

  // alias (lowercase) → relation id. Sinh trước để join/column tham chiếu
  // được bất kể thứ tự khai báo (nested không cần đứng sau cha).
  const aliasToRid = new Map<string, string>();
  for (const j of joins) {
    if (!j.as) {
      errors.push("Một join thiếu 'as' (alias).");
      continue;
    }
    const low = j.as.toLowerCase();
    if (aliasToRid.has(low)) warnings.push(`Alias join trùng: "${j.as}".`);
    aliasToRid.set(low, ridOf(j.as));
  }

  const resolveNode = (ref: string): string | null => {
    const low = (ref || "").toLowerCase();
    if (!low) return null;
    if (low === "base" || low === baseEnt.name.toLowerCase()) return "base";
    return aliasToRid.get(low) ?? null;
  };
  const entityOfNode = (rid: string): DslEntity | undefined => {
    if (rid === "base") return baseEnt;
    const j = joins.find((jj) => jj.as && ridOf(jj.as) === rid);
    return j ? byName.get((j.to || "").toLowerCase()) : undefined;
  };

  const relations: DataSourceRelation[] = [];
  for (const j of joins) {
    if (!j.as) continue;
    const parentRid = resolveNode(j.from);
    if (parentRid == null) {
      errors.push(`Join "${j.as}": không tìm thấy node cha "${j.from}".`);
      continue;
    }
    const targetEnt = byName.get((j.to || "").toLowerCase());
    if (!targetEnt) {
      errors.push(`Join "${j.as}": không tìm thấy đối tượng đích "${j.to}".`);
      continue;
    }
    if (!j.fromField) {
      errors.push(`Join "${j.as}": thiếu 'fromField'.`);
      continue;
    }
    const parentEnt = entityOfNode(parentRid);
    if (parentEnt && !parentEnt.fields.some((f) => f.name === j.fromField)) {
      warnings.push(`Join "${j.as}": cột nguồn "${j.fromField}" không có trên ${parentEnt.name}.`);
    }
    const toField = j.toField && j.toField.toLowerCase() !== "id" ? j.toField : undefined;
    if (toField && !targetEnt.fields.some((f) => f.name === toField)) {
      warnings.push(`Join "${j.as}": cột đích "${toField}" không có trên ${targetEnt.name}.`);
    }
    relations.push({
      id: ridOf(j.as),
      alias: j.as,
      fromRelationId: parentRid === "base" ? null : parentRid,
      fromField: j.fromField,
      toField,
      targetEntityId: targetEnt.id,
      joinKind: j.kind === "inner" ? "inner" : "left",
    });
  }

  const fields: DataSourceField[] = [];
  for (const c of dsl.columns ?? []) {
    const rid = resolveNode(c.from);
    if (rid == null) {
      errors.push(`Cột "${c.field}": không tìm thấy node "${c.from}".`);
      continue;
    }
    const ent = entityOfNode(rid);
    const fd = ent?.fields.find((f) => f.name === c.field);
    if (!fd) warnings.push(`Cột "${c.from}.${c.field}": field không tồn tại.`);
    const aliasOfNode =
      rid === "base" ? null : (joins.find((jj) => jj.as && ridOf(jj.as) === rid)?.as ?? rid);
    const key = c.as
      ? slug(c.as)
      : rid === "base"
        ? c.field
        : `${slug(aliasOfNode || rid)}_${c.field}`;
    fields.push({
      key,
      sourceRelationId: rid,
      sourceField: c.field,
      label: c.label || fd?.name || c.field,
      type: fd?.type || "text",
      writable: c.writable !== undefined ? c.writable : rid === "base",
    });
  }

  const aggregates: DataSourceAggregate[] = [];
  for (const a of dsl.aggregates ?? []) {
    if (!a.as) {
      errors.push("Một aggregate thiếu 'as' (key).");
      continue;
    }
    const sourceRid = a.from ? resolveNode(a.from) : "base";
    if (sourceRid == null) {
      errors.push(`Aggregate "${a.as}": không tìm thấy node nguồn "${a.from}".`);
      continue;
    }
    const targetEnt = byName.get((a.of || "").toLowerCase());
    if (!targetEnt) {
      errors.push(`Aggregate "${a.as}": không tìm thấy entity "${a.of}".`);
      continue;
    }
    if (!a.byField) {
      errors.push(`Aggregate "${a.as}": thiếu 'byField' (FK trên ${a.of}).`);
      continue;
    }
    if (!targetEnt.fields.some((f) => f.name === a.byField)) {
      warnings.push(`Aggregate "${a.as}": field "${a.byField}" không có trên ${targetEnt.name}.`);
    }
    let via: DataSourceAggregate["via"];
    if (a.via) {
      const farEnt = byName.get((a.via.entity || "").toLowerCase());
      if (!farEnt) {
        errors.push(`Aggregate "${a.as}": không tìm thấy entity far "${a.via.entity}".`);
        continue;
      }
      via = {
        farEntityId: farEnt.id,
        farField: a.via.field,
        ...(a.via.keyField && a.via.keyField.toLowerCase() !== "id"
          ? { farKeyField: a.via.keyField }
          : {}),
      };
    }
    if (a.fn !== "count" && !a.valueField) {
      warnings.push(`Aggregate "${a.as}": ${a.fn} cần 'valueField'.`);
    }
    aggregates.push({
      key: slug(a.as),
      label: a.label || a.as,
      agg: a.fn,
      ...(sourceRid !== "base" ? { sourceRelationId: sourceRid } : {}),
      ...(a.matchField && a.matchField.toLowerCase() !== "id" ? { matchField: a.matchField } : {}),
      targetEntityId: targetEnt.id,
      targetField: a.byField,
      ...(a.valueField ? { valueField: a.valueField } : {}),
      ...(via ? { via } : {}),
    });
  }

  return {
    config: {
      baseEntityId: baseEnt.id,
      relations,
      fields,
      ...(aggregates.length ? { aggregates } : {}),
      defaultLimit: dsl.limit,
    },
    errors,
    warnings,
  };
}

/* ─── Decompile: DataSourceConfig (id) → DSL (tên) ────────── */

export function decompileToDsl(cfg: DataSourceConfig, entities: DslEntity[]): DataSourceDsl {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const relById = new Map(cfg.relations.map((r) => [r.id, r]));
  const baseEnt = byId.get(cfg.baseEntityId);

  const nodeRefName = (rid: string): string => {
    if (rid === "base") return baseEnt?.name || "base";
    return relById.get(rid)?.alias || rid;
  };

  const joins: DataSourceDslJoin[] = cfg.relations.map((r) => ({
    as: r.alias,
    from: nodeRefName(r.fromRelationId ?? "base"),
    fromField: r.fromField,
    to: byId.get(r.targetEntityId)?.name || r.targetEntityId,
    ...(r.toField ? { toField: r.toField } : {}),
    kind: r.joinKind,
  }));

  const columns: DataSourceDslColumn[] = cfg.fields.map((f) => ({
    from: nodeRefName(f.sourceRelationId),
    field: f.sourceField,
    as: f.key,
    label: f.label,
    ...(f.writable !== undefined ? { writable: f.writable } : {}),
  }));

  const aggregates: DataSourceDslAgg[] = (cfg.aggregates ?? []).map((a) => ({
    as: a.key,
    label: a.label,
    fn: a.agg,
    of: byId.get(a.targetEntityId)?.name || a.targetEntityId,
    byField: a.targetField,
    ...(a.sourceRelationId && a.sourceRelationId !== "base"
      ? { from: nodeRefName(a.sourceRelationId) }
      : {}),
    ...(a.matchField ? { matchField: a.matchField } : {}),
    ...(a.valueField ? { valueField: a.valueField } : {}),
    ...(a.via
      ? {
          via: {
            entity: byId.get(a.via.farEntityId)?.name || a.via.farEntityId,
            field: a.via.farField,
            ...(a.via.farKeyField ? { keyField: a.via.farKeyField } : {}),
          },
        }
      : {}),
  }));

  return {
    base: baseEnt?.name || "",
    joins,
    columns,
    ...(aggregates.length ? { aggregates } : {}),
    ...(cfg.defaultLimit ? { limit: cfg.defaultLimit } : {}),
  };
}
