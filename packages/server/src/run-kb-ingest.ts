/* ==========================================================
   run-kb-ingest.ts — Worker nạp tri thức cho Knowledge Base.
   Một nguồn (file / entity / text) → trích văn bản → cắt đoạn
   (chunk.ts) → sinh embedding (embeddings.ts) → ghi knowledge_chunks
   → cập nhật status/chunkCount. Luôn cập nhật trạng thái nguồn kể
   cả khi lỗi (theo mẫu run-entity-sync.ts).
   ========================================================== */
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { knowledgeSources, knowledgeChunks, entities, entityRecords } from "@erp-framework/db";
import type { DB } from "./db";
import { chunkText } from "./chunk";
import { embedTexts } from "./embeddings";
import { extractText } from "./extract";
import { logActivity } from "./activity";

type SourceRow = typeof knowledgeSources.$inferSelect;

/* Render toàn bộ entity_records của một entity thành văn bản —
   mỗi bản ghi một khối "Nhãn: giá trị". */
async function renderEntity(db: DB, companyId: string, entityId: string): Promise<string> {
  const [entity] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.companyId, companyId)));
  if (!entity) throw new Error("Entity không tồn tại hoặc khác công ty.");

  const fields = (entity.fields ?? []) as Array<{ name: string; label?: string }>;
  const recs = await db
    .select()
    .from(entityRecords)
    .where(and(eq(entityRecords.entityId, entityId), eq(entityRecords.companyId, companyId)));

  const blocks: string[] = [];
  for (const r of recs) {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const lines: string[] = [];
    for (const f of fields) {
      const v = data[f.name];
      if (v === undefined || v === null || v === "") continue;
      lines.push(`${f.label || f.name}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    }
    if (lines.length) blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

/* Lấy văn bản thô của một nguồn theo kind. */
async function loadText(db: DB, src: SourceRow): Promise<string> {
  const meta = (src.meta ?? {}) as Record<string, unknown>;
  if (src.kind === "text") {
    return String(meta.text ?? "");
  }
  if (src.kind === "entity") {
    const entityId = String(meta.entityId ?? "");
    if (!entityId) throw new Error("Nguồn entity thiếu entityId.");
    return renderEntity(db, src.companyId, entityId);
  }
  if (src.kind === "file") {
    const path = String(meta.path ?? "");
    if (!path) throw new Error("Nguồn file thiếu đường dẫn.");
    const buf = await readFile(path);
    return extractText(buf, typeof meta.mime === "string" ? meta.mime : undefined);
  }
  throw new Error(`Loại nguồn không hỗ trợ: ${src.kind}`);
}

/** Nạp MỘT nguồn tri thức theo id. Cập nhật status của nguồn dù
   thành công hay lỗi; ném lại lỗi để worker pg-boss ghi log. */
export async function runKbIngest(db: DB, sourceId: string): Promise<void> {
  const [src] = await db.select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId));
  if (!src) throw new Error(`Knowledge source không tồn tại: ${sourceId}`);

  // Đo thời gian + tiến độ embedding, lưu vào meta.ingest (giữ nguyên config
  // gốc trong meta — text/entityId/path). UI poll đọc để hiện X/Y đoạn + đoạn/s.
  const t0 = Date.now();
  const baseMeta = (src.meta ?? {}) as Record<string, unknown>;
  const startedAt = new Date(t0).toISOString();
  const setIngest = (ingest: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    db
      .update(knowledgeSources)
      .set({ meta: { ...baseMeta, ingest }, updatedAt: new Date(), ...extra })
      .where(eq(knowledgeSources.id, sourceId));

  await setIngest({ total: 0, embedded: 0, startedAt }, { status: "processing", error: null });

  try {
    const text = await loadText(db, src);
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new Error("Không trích được nội dung nào từ nguồn.");
    }
    // Đã biết tổng số đoạn → UI hiện 0/total ngay.
    await setIngest({ total: chunks.length, embedded: 0, startedAt });

    // Sinh embedding theo lô; cập nhật tiến độ mỗi lô. Lô nhỏ (16) → progress
    // nhích thường xuyên hơn (embed CPU chậm ~0.5 đoạn/s, lô 64 = ~2 phút mới
    // cập nhật → nhìn như treo). Ollama embed gần như tuần tự nên lô nhỏ không
    // làm chậm tổng đáng kể.
    const BATCH = 16;
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH).map((c) => c.content);
      vectors.push(...(await embedTexts(db, src.companyId, batch)));
      const embedded = Math.min(i + BATCH, chunks.length);
      const elapsed = (Date.now() - t0) / 1000;
      await setIngest({
        total: chunks.length,
        embedded,
        startedAt,
        perSec: elapsed > 0 ? Math.round((embedded / elapsed) * 10) / 10 : 0,
      });
    }

    // Thay toàn bộ chunk cũ của nguồn này.
    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, sourceId));
    await db.insert(knowledgeChunks).values(
      chunks.map((c, i) => ({
        companyId: src.companyId,
        sourceId,
        seq: c.seq,
        content: c.content,
        tokens: c.tokens,
        embedding: vectors[i] ?? null,
      })),
    );

    const durationMs = Date.now() - t0;
    const perSec = durationMs > 0 ? Math.round((chunks.length / (durationMs / 1000)) * 10) / 10 : 0;
    await db
      .update(knowledgeSources)
      .set({
        status: "ready",
        chunkCount: chunks.length,
        error: null,
        meta: {
          ...baseMeta,
          ingest: {
            total: chunks.length,
            embedded: chunks.length,
            ms: durationMs,
            perSec,
            startedAt,
            finishedAt: new Date().toISOString(),
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(knowledgeSources.id, sourceId));

    await logActivity(db, {
      companyId: src.companyId,
      kind: "kb-ingest",
      objectType: "knowledge",
      target: sourceId,
      detail:
        `Nạp tri thức "${src.title}" — ${chunks.length} đoạn trong ${(durationMs / 1000).toFixed(1)}s (${perSec} đoạn/s).`.slice(
          0,
          480,
        ),
    });
  } catch (e) {
    const msg = (e as Error).message;
    await db
      .update(knowledgeSources)
      .set({
        status: "error",
        error: msg.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(knowledgeSources.id, sourceId));
    await logActivity(db, {
      companyId: src.companyId,
      kind: "kb-ingest",
      objectType: "knowledge",
      target: sourceId,
      detail: `Nạp tri thức "${src.title}" lỗi: ${msg}`.slice(0, 480),
    });
    throw e;
  }
}
