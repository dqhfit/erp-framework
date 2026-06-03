/* ==========================================================
   webhook-routes.ts — Endpoint nhận webhook ngoài kích hoạt workflow
   (Fastify, KHÔNG tRPC để hệ thống bên thứ ba POST trực tiếp).

   POST /webhooks/workflow/:token
   - token = triggerConfig.token của workflow (triggerType='webhook',
     isActive=true). Token là bí mật khó đoán → không cần auth header.
   - Body (JSON) + query → nạp vào vars.webhook của run.
   - Không khớp token → 404 (không lộ tồn tại workflow).
   ========================================================== */
import type { FastifyInstance } from "fastify";
import type { DB } from "./db";
import { enqueueWorkflowRun } from "./jobs";
import { findWebhookWorkflow } from "./workflow-triggers";

export function registerWebhookRoutes(app: FastifyInstance, db: DB): void {
  app.post<{ Params: { token: string } }>("/webhooks/workflow/:token", async (req, reply) => {
    const wf = await findWebhookWorkflow(db, req.params.token);
    if (!wf) return reply.code(404).send({ error: "Webhook không tồn tại hoặc đã tắt" });
    await enqueueWorkflowRun(wf.id, {
      webhook: {
        body: (req.body ?? {}) as Record<string, unknown>,
        query: (req.query ?? {}) as Record<string, unknown>,
      },
    });
    // 202 Accepted — run chạy nền qua pg-boss, không chờ kết quả.
    return reply.code(202).send({ ok: true });
  });
}
