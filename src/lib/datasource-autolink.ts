/* ==========================================================
   Auto-link Detection — đề xuất liên kết đối tượng cho Nguồn dữ liệu.

   Thuần (deterministic, KHÔNG LLM): phân tích metadata entity có sẵn
   client-side (field lookup/ref = "khoá ngoại" của hệ low-code) để gợi ý
   liên kết trên DataSourceCanvas. Người dùng khỏi tự nhớ quan hệ giữa bảng.

   Bản cắt này phủ Tier 1-3 (giá trị cao, ít nhiễu):
     • Tier 1 — FK thực tế: field lookup/multi-lookup có `ref` → join cha→con.
     • Tier 2 — quan hệ ngược (1-N): entity khác trỏ lookup VỀ node → đề xuất
       Aggregate (đếm) thay vì join many-to-one.
     • Tier 3 — gián tiếp: BFS trên đồ thị FK, đường đi >1 hop qua bảng trung
       gian; chấp nhận → tự thêm các bảng trung gian.

   Tier 4 (tên cột tương đồng) + Tier 5 (kiểu tương thích) để backlog.
   ========================================================== */

import type { DataSourceConfig } from "@erp-framework/core";

/* ── Shape tối thiểu (MockEntity/EntityField gán cấu trúc được) ── */
export interface AlField {
  id: string;
  name: string;
  label?: string;
  type: string;
  /** Cho field lookup/multi-lookup — id entity đích (= khoá ngoại). */
  ref?: string;
}
export interface AlEntity {
  id: string;
  name: string;
  /** Field id dùng làm PK; mặc định khớp theo record "id". */
  primaryKey?: string;
  fields: AlField[];
}

/** 1 bước nhảy theo FK (lookup → record id đích). */
export interface LinkStep {
  fromEntityId: string;
  fromField: string;
  toEntityId: string;
  /** "id" = khớp record id đích (lookup cổ điển). */
  toField: string;
  /** Nhãn field FK để hiển thị lý do. */
  viaLabel: string;
}

export interface LinkSuggestion {
  /** Khoá ổn định để dedupe + key React. */
  id: string;
  kind: "join" | "aggregate";
  /** Node đã có trên canvas làm điểm bắt đầu ("base" | relationId). */
  fromNodeId: string;
  /** Entity ở hop cuối (đối tượng được thêm vào canvas). */
  targetEntityId: string;
  /** Chuỗi hop (length 1 = trực tiếp; >1 = qua bảng trung gian). */
  steps: LinkStep[];
  /** Với kind="aggregate": field FK trên entity con khớp về node nguồn. */
  aggTargetField?: string;
  confidence: number;
  tier: 1 | 2 | 3;
  reason: string;
}

const MAX_HOPS = 4;
const LOOKUP_TYPES = new Set(["lookup", "multi-lookup"]);

/** Cạnh FK xuôi: entity → các (field lookup, entity đích). */
export type FkGraph = Map<string, Array<{ field: AlField; toEntityId: string }>>;

/** Dựng đồ thị FK xuôi từ field lookup/multi-lookup có `ref` hợp lệ. */
export function buildFkGraph(entities: AlEntity[]): FkGraph {
  const exists = new Set(entities.map((e) => e.id));
  const g: FkGraph = new Map();
  for (const ent of entities) {
    const edges: Array<{ field: AlField; toEntityId: string }> = [];
    for (const f of ent.fields) {
      if (LOOKUP_TYPES.has(f.type) && f.ref && exists.has(f.ref)) {
        edges.push({ field: f, toEntityId: f.ref });
      }
    }
    g.set(ent.id, edges);
  }
  return g;
}

/** entityId của 1 node canvas ("base" | relationId) theo cfg. */
function nodeEntityId(cfg: DataSourceConfig, nodeId: string): string | undefined {
  if (nodeId === "base") return cfg.baseEntityId || undefined;
  return cfg.relations.find((r) => r.id === nodeId)?.targetEntityId;
}

/** Mọi node hiện có trên canvas. */
function canvasNodeIds(cfg: DataSourceConfig): string[] {
  return ["base", ...cfg.relations.map((r) => r.id)];
}

/** Hop đầu (fromNodeId, fromField, target) đã tồn tại trong relations? */
function firstHopExists(cfg: DataSourceConfig, fromNodeId: string, step: LinkStep): boolean {
  return cfg.relations.some(
    (r) =>
      (r.fromRelationId ?? "base") === fromNodeId &&
      r.targetEntityId === step.toEntityId &&
      r.fromField === step.fromField,
  );
}

/**
 * Đề xuất liên kết bắt đầu từ MỘT node canvas.
 * @param fromNodeId node cha ("base" | relationId)
 */
function suggestFromNode(
  cfg: DataSourceConfig,
  graph: FkGraph,
  byId: Map<string, AlEntity>,
  fromNodeId: string,
): LinkSuggestion[] {
  const startEntityId = nodeEntityId(cfg, fromNodeId);
  if (!startEntityId) return [];
  const out: LinkSuggestion[] = [];

  /* ── Tier 1 + 3: BFS theo FK xuôi (đường ngắn nhất tới mỗi entity) ── */
  const visited = new Set<string>([startEntityId]);
  const queue: Array<{ entityId: string; path: LinkStep[] }> = [
    { entityId: startEntityId, path: [] },
  ];
  while (queue.length) {
    // biome-ignore lint/style/noNonNullAssertion: queue.length>0 đã đảm bảo
    const cur = queue.shift()!;
    for (const edge of graph.get(cur.entityId) ?? []) {
      if (visited.has(edge.toEntityId)) continue; // chỉ giữ đường ngắn nhất
      visited.add(edge.toEntityId);
      const step: LinkStep = {
        fromEntityId: cur.entityId,
        fromField: edge.field.name,
        toEntityId: edge.toEntityId,
        toField: "id",
        viaLabel: edge.field.label || edge.field.name,
      };
      const steps = [...cur.path, step];
      const hops = steps.length;
      // Hop đầu đã dựng rồi → bỏ (sẽ đề xuất từ node trung gian thay vì lặp).
      if (!firstHopExists(cfg, fromNodeId, steps[0] as LinkStep)) {
        const tier: 1 | 3 = hops === 1 ? 1 : 3;
        const confidence = hops === 1 ? 0.98 : 0.9 * 0.7 ** (hops - 1);
        const targetName = byId.get(edge.toEntityId)?.name ?? edge.toEntityId;
        const reason =
          hops === 1
            ? `FK (lookup) "${step.viaLabel}"`
            : `Gián tiếp qua ${steps
                .slice(0, -1)
                .map((s) => byId.get(s.toEntityId)?.name ?? s.toEntityId)
                .join(" → ")} (${hops} hop)`;
        out.push({
          id: `join|${fromNodeId}|${edge.toEntityId}|${step.fromField}`,
          kind: "join",
          fromNodeId,
          targetEntityId: edge.toEntityId,
          steps,
          confidence,
          tier,
          reason: `${reason} → ${targetName}`,
        });
      }
      if (steps.length < MAX_HOPS) queue.push({ entityId: edge.toEntityId, path: steps });
    }
  }

  /* ── Tier 2: quan hệ ngược (entity con trỏ lookup VỀ node) → aggregate ── */
  for (const [childId, edges] of graph) {
    if (childId === startEntityId) continue;
    for (const edge of edges) {
      if (edge.toEntityId !== startEntityId) continue;
      const childName = byId.get(childId)?.name ?? childId;
      // Đã có aggregate cho cặp này?
      const dup = (cfg.aggregates ?? []).some(
        (a) =>
          (a.sourceRelationId ?? "base") === fromNodeId &&
          a.targetEntityId === childId &&
          a.targetField === edge.field.name,
      );
      if (dup) continue;
      out.push({
        id: `agg|${fromNodeId}|${childId}|${edge.field.name}`,
        kind: "aggregate",
        fromNodeId,
        targetEntityId: childId,
        aggTargetField: edge.field.name,
        steps: [
          {
            fromEntityId: childId,
            fromField: edge.field.name,
            toEntityId: startEntityId,
            toField: "id",
            viaLabel: edge.field.label || edge.field.name,
          },
        ],
        confidence: 0.85,
        tier: 2,
        reason: `1-N: ${childName} trỏ về qua "${edge.field.label || edge.field.name}" — đếm số dòng`,
      });
    }
  }

  return out;
}

/**
 * Đề xuất toàn bộ liên kết cho 1 nguồn dữ liệu.
 * @param fromNodeId nếu set → chỉ gợi ý từ node đó; bỏ trống → quét mọi node.
 * Kết quả đã dedupe (giữ confidence cao nhất) + sort giảm dần theo confidence.
 */
export function suggestLinks(
  entities: AlEntity[],
  cfg: DataSourceConfig,
  opts?: { fromNodeId?: string },
): LinkSuggestion[] {
  if (!cfg.baseEntityId) return [];
  const byId = new Map(entities.map((e) => [e.id, e]));
  const graph = buildFkGraph(entities);
  const parents = opts?.fromNodeId ? [opts.fromNodeId] : canvasNodeIds(cfg);

  const merged = new Map<string, LinkSuggestion>();
  for (const nodeId of parents) {
    for (const s of suggestFromNode(cfg, graph, byId, nodeId)) {
      const prev = merged.get(s.id);
      if (!prev || s.confidence > prev.confidence) merged.set(s.id, s);
    }
  }
  return [...merged.values()].sort((a, b) => b.confidence - a.confidence || a.tier - b.tier);
}
