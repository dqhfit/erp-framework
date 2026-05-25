/* ==========================================================
   feedback-ai.ts — Worker enrich feedback bằng embedding + LLM.
   Async qua pg-boss queue "feedback-ai":
   - embedTexts → set feedbacks.embedding (cho findSimilar dùng).
   - Gọi LLM 1-shot trả JSON {summary, tags[]} → set aiSummary + aiTags.
   Fail-safe: lỗi LLM/embedding không vỡ feedback — chỉ skip enrichment.
   ========================================================== */
import { eq } from "drizzle-orm";
import { feedbacks } from "@erp-framework/db";
import type { DB } from "./db";
import { embedTexts } from "./embeddings";
import { logActivity } from "./activity";
import { callLlmJson } from "./llm-json";

export const QUEUE_FEEDBACK_AI = "feedback-ai";

export interface FeedbackAiJobData {
  feedbackId: string;
}

let enqueue: ((feedbackId: string) => Promise<void>) | null = null;

/** Đăng ký hàm enqueue từ jobs.ts (DI để tránh circular import). */
export function registerEnqueueFeedbackAi(fn: (id: string) => Promise<void>): void {
  enqueue = fn;
}

export async function enqueueFeedbackAi(feedbackId: string): Promise<void> {
  if (!enqueue) {
    // Boss chưa start (vd test/seed) — fallback: chạy sync, không chặn caller lâu.
    console.warn("[feedback-ai] queue chưa đăng ký, bỏ qua enrichment");
    return;
  }
  await enqueue(feedbackId);
}

/** Compose text cho cả embedding lẫn LLM prompt. */
function composeText(row: {
  title: string; body: string; suggestion: string | null;
}): string {
  return [row.title, row.body, row.suggestion].filter(Boolean).join("\n\n");
}

/** Gọi LLM để tóm tắt + tag feedback. Dùng helper chung llm-json.ts. */
async function summarizeFeedback(
  db: DB, companyId: string, text: string,
): Promise<{ summary?: string; tags?: string[] } | null> {
  const r = await callLlmJson<{ summary?: string; tags?: unknown }>(
    db, companyId, {
      system:
        "Bạn nhận một feedback của người dùng về tính năng phần mềm. "
        + 'Trả về CHỈ MỘT object JSON dạng: {"summary": "<1-2 câu tóm tắt ngắn>", '
        + '"tags": ["<tag1>", "<tag2>", ...]} (tối đa 5 tag, tiếng Việt, kebab-case). '
        + "KHÔNG kèm markdown, KHÔNG giải thích thêm.",
      user: text,
      maxTokens: 512,
    });
  if (!r) return null;
  const tags = Array.isArray(r.tags)
    ? r.tags.filter((t): t is string => typeof t === "string").slice(0, 5)
    : undefined;
  return { summary: r.summary, tags };
}

/** Handler chính cho 1 job. */
export async function runFeedbackAi(db: DB, feedbackId: string): Promise<void> {
  const [row] = await db.select({
    id: feedbacks.id,
    companyId: feedbacks.companyId,
    title: feedbacks.title,
    body: feedbacks.body,
    suggestion: feedbacks.suggestion,
  }).from(feedbacks).where(eq(feedbacks.id, feedbackId));
  if (!row) return;

  const text = composeText(row);

  // Embedding — lỗi không cản phần LLM.
  let embedded = false;
  try {
    const [vec] = await embedTexts(db, row.companyId, [text]);
    if (vec) {
      await db.update(feedbacks)
        .set({ embedding: vec as unknown as number[], updatedAt: new Date() })
        .where(eq(feedbacks.id, feedbackId));
      embedded = true;
    }
  } catch (e) {
    console.warn(`[feedback-ai/embed] ${feedbackId}:`, (e as Error).message);
  }

  // LLM enrichment.
  const ai = await summarizeFeedback(db, row.companyId, text);
  if (ai && (ai.summary || ai.tags)) {
    await db.update(feedbacks).set({
      aiSummary: ai.summary ?? null,
      aiTags: ai.tags ?? null,
      updatedAt: new Date(),
    }).where(eq(feedbacks.id, feedbackId));
  }

  await logActivity(db, {
    companyId: row.companyId,
    kind: "feedback.ai",
    target: feedbackId,
    detail: `embedded=${embedded} summary=${!!ai?.summary} tags=${ai?.tags?.length ?? 0}`,
  });
}
