/* ==========================================================
   feedback-ai.ts — Worker enrich feedback bằng embedding + LLM.
   Async qua pg-boss queue "feedback-ai":
   - embedTexts → set feedbacks.embedding (cho findSimilar dùng).
   - Gọi LLM 1-shot trả JSON {summary, tags[]} → set aiSummary + aiTags.
   Fail-safe: lỗi LLM/embedding không vỡ feedback — chỉ skip enrichment.
   ========================================================== */
import { and, eq } from "drizzle-orm";
import { feedbacks, llmProfiles } from "@erp-framework/db";
import type { DB } from "./db";
import { embedTexts } from "./embeddings";
import { decryptSecret } from "./crypto";
import { logActivity } from "./activity";

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

/** Gọi LLM một shot, kỳ vọng response là JSON {summary, tags}.
 *  Hỗ trợ OpenAI-compat (gồm Ollama) và Anthropic. */
async function callLlmJson(
  db: DB, companyId: string, text: string,
): Promise<{ summary?: string; tags?: string[] } | null> {
  // Lấy profile chat đầu tiên của công ty.
  const [p] = await db.select().from(llmProfiles).where(and(
    eq(llmProfiles.companyId, companyId),
    eq(llmProfiles.kind, "chat"),
  )).limit(1);
  if (!p) return null;

  const system =
    "Bạn nhận một feedback của người dùng về tính năng phần mềm. "
    + 'Trả về CHỈ MỘT object JSON dạng: {"summary": "<1-2 câu tóm tắt ngắn>", '
    + '"tags": ["<tag1>", "<tag2>", ...]} (tối đa 5 tag, tiếng Việt, kebab-case). '
    + "KHÔNG kèm markdown, KHÔNG giải thích thêm.";
  const user = text.slice(0, 4000);

  const isAnthropic = ["claude", "claude-pro", "anthropic"].includes(p.adapter);
  const key = (p.apiKeyEnc ? decryptSecret(p.apiKeyEnc) : "")
    || process.env[isAnthropic ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"] || "";
  if (!key && p.adapter !== "ollama") return null;

  let raw = "";
  try {
    if (isAnthropic) {
      const endpoint = (p.endpoint ?? "https://api.anthropic.com") + "/v1/messages";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: p.model,
          max_tokens: 512,
          system,
          messages: [{ role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) return null;
      const j = await r.json() as { content?: Array<{ text?: string }> };
      raw = j.content?.[0]?.text ?? "";
    } else {
      const endpoint = (p.endpoint ?? "https://api.openai.com") + "/v1/chat/completions";
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (key) headers.authorization = `Bearer ${key}`;
      const r = await fetch(endpoint, {
        method: "POST", headers,
        body: JSON.stringify({
          model: p.model,
          max_tokens: 512,
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) return null;
      const j = await r.json() as { choices?: Array<{ message?: { content?: string } }> };
      raw = j.choices?.[0]?.message?.content ?? "";
    }
  } catch (e) {
    console.warn("[feedback-ai] LLM fetch lỗi:", (e as Error).message);
    return null;
  }

  // Extract JSON object đầu tiên — đôi khi LLM trả kèm markdown.
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]) as { summary?: string; tags?: unknown };
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t): t is string => typeof t === "string").slice(0, 5)
      : undefined;
    return { summary: parsed.summary, tags };
  } catch {
    return null;
  }
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
  const ai = await callLlmJson(db, row.companyId, text);
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
