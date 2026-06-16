/* ==========================================================
   workflow-guardrails.ts — Guardrails learning (Loops!-style).

   Khi một node trong workflow fail lặp cùng lỗi (gom theo fingerprint),
   ghi nhận + đếm fail_count; chạm ngưỡng (THRESHOLD) → sinh "lesson" qua
   LLM (FAIL-SAFE: lỗi/chưa cấu hình → giữ null, người tự viết). Guardrail
   "active" được chèn vào system prompt các lần chạy sau để tránh lặp lỗi.

   Gắn theo workflow + node (node "agent" dùng cfg.system/cfg.profile, KHÔNG
   gắn bảng agents — xem llm-client.ts). Mọi truy vấn scope companyId.
   ========================================================== */
import { workflowGuardrails } from "@erp-framework/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "./db";
import { computeFingerprint } from "./error-router";
import { callLlmJson } from "./llm-json";

/** Số lần fail cùng lỗi trước khi coi là "tái diễn" cần guardrail. */
const GUARDRAIL_THRESHOLD = 3;

/** Queue pg-boss sinh lesson (bền vững, sống qua restart). */
export const QUEUE_GUARDRAIL_LESSON = "guardrail-lesson";

export interface GuardrailLessonJobData {
  guardrailId: string;
  companyId: string;
  errorSample: string;
}

// DI: jobs.ts đăng ký hàm enqueue (tránh circular import workflow-guardrails↔jobs).
let lessonEnqueuer: ((data: GuardrailLessonJobData) => Promise<void>) | null = null;
export function registerEnqueueGuardrailLesson(
  fn: (data: GuardrailLessonJobData) => Promise<void>,
): void {
  lessonEnqueuer = fn;
}

/** Đẩy job sinh lesson. Có queue → enqueue (bền vững); chưa start (test/seed) →
 *  fallback chạy inline best-effort. Fail-safe: nuốt lỗi, không vỡ flow. */
async function enqueueLesson(db: DB, data: GuardrailLessonJobData): Promise<void> {
  try {
    if (lessonEnqueuer) {
      await lessonEnqueuer(data);
    } else {
      await synthesizeLesson(db, data.companyId, data.guardrailId, data.errorSample);
    }
  } catch {
    /* best-effort */
  }
}

interface RunStepLike {
  nodeId: string;
  kind: string;
  status: string;
  detail: string;
}

export interface GuardrailRow {
  nodeId: string;
  errorSample: string;
  lesson: string | null;
  failCount: number;
}

/** Ghi nhận các step lỗi của một run: upsert theo fingerprint, tăng fail_count.
 *  Best-effort — nuốt lỗi từng step (guardrail là phụ, KHÔNG được vỡ flow).
 *  Chỉ gọi ở run gốc (depth 0) để tránh nhân đôi từ sub-run. */
export async function recordNodeFailures(
  db: DB,
  companyId: string,
  workflowId: string,
  steps: RunStepLike[],
): Promise<void> {
  const errs = steps.filter((s) => s.status === "error" && s.detail);
  if (errs.length === 0) return;
  const now = new Date();
  for (const s of errs) {
    const fingerprint = computeFingerprint("error", s.detail);
    const sample = s.detail.slice(0, 500);
    try {
      const [row] = await db
        .insert(workflowGuardrails)
        .values({
          companyId,
          workflowId,
          nodeId: s.nodeId,
          fingerprint,
          errorSample: sample,
          failCount: 1,
          status: "active",
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: [
            workflowGuardrails.companyId,
            workflowGuardrails.workflowId,
            workflowGuardrails.nodeId,
            workflowGuardrails.fingerprint,
          ],
          set: {
            failCount: sql`${workflowGuardrails.failCount} + 1`,
            lastSeenAt: now,
            errorSample: sample,
            updatedAt: now,
            // Đánh dấu lúc chạm ngưỡng (giữ lần đầu, không ghi đè).
            thresholdMetAt: sql`CASE
              WHEN ${workflowGuardrails.failCount} + 1 >= ${GUARDRAIL_THRESHOLD}
              THEN COALESCE(${workflowGuardrails.thresholdMetAt}, ${now})
              ELSE ${workflowGuardrails.thresholdMetAt} END`,
          },
        })
        .returning();
      // Vừa chạm ngưỡng + chưa có lesson → enqueue sinh lesson (bền vững qua
      // pg-boss; fallback inline khi queue chưa start). Best-effort, fail-safe.
      if (row && row.failCount >= GUARDRAIL_THRESHOLD && !row.lesson) {
        void enqueueLesson(db, { guardrailId: row.id, companyId, errorSample: sample });
      }
    } catch {
      // Nuốt lỗi từng step — không che lỗi gốc của workflow.
    }
  }
}

/** Sinh 1 câu bài học ngắn từ mẫu lỗi (best-effort). FAIL-SAFE: callLlmJson trả
 *  null khi LLM lỗi / chưa cấu hình profile → giữ lesson null (UI hiện error
 *  pattern cho người viết tay). Tuân CLAUDE.md mục 6 — AI fail không vỡ flow. */
export async function synthesizeLesson(
  db: DB,
  companyId: string,
  guardrailId: string,
  errorSample: string,
): Promise<void> {
  const out = await callLlmJson<{ lesson?: string }>(db, companyId, {
    system:
      "Bạn là trợ lý DevOps. Dựa trên thông điệp lỗi LẶP LẠI của một bước workflow, " +
      "viết MỘT câu hướng dẫn ngắn (tiếng Việt) giúp agent tránh lặp lại lỗi này lần " +
      'sau. Trả JSON đúng dạng {"lesson": "..."}. Không giải thích thêm.',
    user: `Lỗi lặp lại:\n${errorSample}`,
    maxTokens: 200,
  });
  const lesson = out?.lesson?.trim();
  if (!lesson) return;
  await db
    .update(workflowGuardrails)
    .set({ lesson: lesson.slice(0, 1000), updatedAt: new Date() })
    .where(eq(workflowGuardrails.id, guardrailId));
}

/** Guardrail đang active của một workflow (ưu tiên fail_count cao). Lọc chỉ giữ
 *  guardrail có ý nghĩa để chèn: đã có lesson hoặc đã chạm ngưỡng. */
export async function loadActiveGuardrails(
  db: DB,
  companyId: string,
  workflowId: string,
): Promise<GuardrailRow[]> {
  const rows = await db
    .select({
      nodeId: workflowGuardrails.nodeId,
      errorSample: workflowGuardrails.errorSample,
      lesson: workflowGuardrails.lesson,
      failCount: workflowGuardrails.failCount,
    })
    .from(workflowGuardrails)
    .where(
      and(
        eq(workflowGuardrails.companyId, companyId),
        eq(workflowGuardrails.workflowId, workflowId),
        eq(workflowGuardrails.status, "active"),
      ),
    )
    .orderBy(desc(workflowGuardrails.failCount))
    .limit(20);
  return rows.filter((r) => !!r.lesson || r.failCount >= GUARDRAIL_THRESHOLD);
}

/** Render block markdown chèn vào đầu system prompt. Rỗng → "". */
export function formatGuardrailPreamble(rows: GuardrailRow[]): string {
  if (rows.length === 0) return "";
  const lines = rows.map((r) => {
    const note = r.lesson?.trim() || `Tránh lặp lỗi: ${r.errorSample}`;
    return `- ${note}`;
  });
  return `## Guardrails — bài học từ lỗi trước (tránh lặp lại)\n${lines.join("\n")}\n`;
}
