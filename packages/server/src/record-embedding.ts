/* ==========================================================
   record-embedding.ts — Build + index embedding cho record.
   Hook ở records.create/update: gom field embedSearchable thành
   chuỗi → embed → upsert vào entity_record_embeddings. Best-effort
   (lỗi không cản trở write).
   ========================================================== */
import { and, eq, sql } from "drizzle-orm";
import { entityRecordEmbeddings, entities } from "@erp-framework/db";
import type { EntityFieldDef } from "@erp-framework/core";
import type { DB } from "./db";
import { embedTexts } from "./embeddings";

/** Trả về true nếu entity có field nào embedSearchable. */
export function hasEmbedFields(fields: EntityFieldDef[]): boolean {
  return fields.some((f) => f.embedSearchable);
}

/** Build chuỗi tổng hợp từ field embedSearchable. */
function buildEmbedText(fields: EntityFieldDef[], data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const f of fields) {
    if (!f.embedSearchable) continue;
    const v = data[f.name];
    if (v == null || v === "") continue;
    parts.push(typeof v === "string" ? v : JSON.stringify(v));
  }
  return parts.join(" ").trim();
}

/** Best-effort upsert embedding cho 1 record. Không await caller. */
export function indexRecordEmbedding(
  db: DB, companyId: string, entityId: string,
  fields: EntityFieldDef[], recordId: string, data: Record<string, unknown>,
): void {
  if (!hasEmbedFields(fields)) return;
  void (async () => {
    try {
      const text = buildEmbedText(fields, data);
      if (!text) return;
      const [vec] = await embedTexts(db, companyId, [text]);
      if (!vec) return;
      // Upsert qua DELETE + INSERT (drizzle không có upsert composite tự nhiên ở đây).
      await db.delete(entityRecordEmbeddings).where(and(
        eq(entityRecordEmbeddings.recordId, recordId),
        eq(entityRecordEmbeddings.companyId, companyId),
      ));
      await db.insert(entityRecordEmbeddings).values({
        companyId, entityId, recordId, text, embedding: vec as number[],
      });
    } catch (e) {
      console.error("[record-embedding] index lỗi:", (e as Error).message);
    }
  })();
}

/** Semantic search: cho query string → embed → cosine search top-K.
 *  Trả mảng { recordId, score, text }. */
export async function semanticSearchRecords(
  db: DB, companyId: string, entityName: string, query: string, limit = 10,
): Promise<Array<{ recordId: string; score: number; text: string }>> {
  const [ent] = await db.select({ id: entities.id }).from(entities)
    .where(and(eq(entities.companyId, companyId), eq(entities.name, entityName)));
  if (!ent) return [];
  const [qvec] = await embedTexts(db, companyId, [query]);
  if (!qvec) return [];
  // pgvector cosine distance qua operator <=> ; smaller = more similar.
  // score = 1 - distance (cao = similar).
  const vecLit = sql.raw(`'[${(qvec as number[]).join(",")}]'`);
  const rows = await db.execute(sql`
    SELECT record_id, text, 1 - (embedding <=> ${vecLit}::vector) AS score
    FROM entity_record_embeddings
    WHERE company_id = ${companyId}::uuid AND entity_id = ${ent.id}::uuid
    ORDER BY embedding <=> ${vecLit}::vector
    LIMIT ${limit}
  `) as unknown as Array<{ record_id: string; text: string; score: number }>;
  return rows.map((r) => ({ recordId: r.record_id, text: r.text, score: r.score }));
}
