/* index.ts — Bootstrap Fastify + tRPC + scheduler pg-boss.
   Cổng 8910 (tránh đụng bridge 8909). */
import "./load-env"; // PHẢI đứng đầu — nạp .env trước khi db.ts đọc env
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { eq } from "drizzle-orm";
import { sessions } from "@erp-framework/db";
import { roleCan } from "@erp-framework/core";
import { appRouter } from "./router";
import { createContext, resolveActiveCompany } from "./context";
import { startJobs, stopJobs } from "./jobs";
import { db } from "./db";
import { SESSION_COOKIE } from "./auth";
import { runAgentChat } from "./agent-chat";
import { makeCallTool } from "./mcp-client";
import { assertWithinBudget } from "./budget";
import "./plugins"; // Đăng ký plugin server-side vào pluginRegistry

const PORT = Number(process.env.PORT ?? 8910);
const HOST = process.env.HOST ?? "127.0.0.1";

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  // CORS — cho frontend (origin khác) gọi kèm cookie phiên.
  // Production BẮT BUỘC khai báo CORS_ORIGIN tường minh: phản chiếu
  // mọi origin kèm credentials:true là lỗ hổng (web bất kỳ gọi API
  // kèm cookie nạn nhân). Dev: thiếu CORS_ORIGIN → phản chiếu origin.
  const corsOrigin = process.env.CORS_ORIGIN;
  if (process.env.NODE_ENV === "production" && !corsOrigin) {
    throw new Error(
      "CORS_ORIGIN bắt buộc ở production — khai báo (các) origin được "
      + "phép, phân tách bằng dấu phẩy nếu nhiều.",
    );
  }
  await app.register(cors, {
    origin: corsOrigin
      ? corsOrigin.split(",").map((s) => s.trim()).filter(Boolean)
      : true,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      // In RÕ lỗi server-side ra console — tRPC mặc định nuốt lỗi vào
      // JSON response nên log Fastify không thấy stack trace.
      onError({ error, path, type }: { error: Error; path?: string; type: string }) {
        console.error(`[tRPC ERROR] ${type} ${path ?? "?"}:`, error);
      },
    },
  });

  app.get("/", async () => ({
    name: "ERP Framework server",
    status: "ok",
    endpoints: { health: "/health", trpc: "/trpc" },
  }));
  app.get("/health", async () => ({ ok: true, ts: Date.now() }));

  /* Agent chat — SSE stream. Vòng lặp agentic (LLM + MCP tool) chạy
     server-side; mỗi bước phát một event. Cần phiên đăng nhập. */
  app.post("/agent/chat", async (req, reply) => {
    const sid = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
    if (!sid) { reply.code(401).send({ error: "Chưa đăng nhập" }); return; }
    const [s] = await db.select().from(sessions).where(eq(sessions.id, sid));
    if (!s || s.expiresAt < new Date()) {
      reply.code(401).send({ error: "Phiên hết hạn" }); return;
    }
    // Đa công ty: phân giải công ty đang chọn của phiên.
    const active = await resolveActiveCompany(db, s.userId, s.activeCompanyId);
    if (!active) {
      reply.code(403).send({ error: "Bạn chưa thuộc công ty nào" }); return;
    }
    // RBAC — endpoint này nằm ngoài tRPC nên phải tự kiểm quyền,
    // đồng nhất với rbacProcedure("run","agent") của các route khác.
    if (!roleCan(active.role, "run", "agent")) {
      reply.code(403).send({ error: 'Vai trò không có quyền "run:agent"' });
      return;
    }
    const body = (req.body ?? {}) as {
      profileName?: string;
      system?: string;
      messages?: Array<{ role: "user" | "assistant"; content: string }>;
      tools?: Array<{ name: string; description?: string; schema: Record<string, unknown> }>;
    };
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    });
    const emit = (e: unknown) => raw.write(`data: ${JSON.stringify(e)}\n\n`);
    try {
      await assertWithinBudget(db, active.companyId);
      await runAgentChat({
        db,
        companyId: active.companyId,
        profileName: body.profileName,
        system: body.system ?? "Bạn là trợ lý ERP.",
        messages: body.messages ?? [],
        tools: body.tools ?? [],
        callTool: makeCallTool(db, active.companyId),
        onEvent: emit,
      });
    } catch (e) {
      emit({ type: "error", message: (e as Error).message });
    }
    raw.end();
  });

  await app.listen({ host: HOST, port: PORT });
  console.log(`ERP Framework server → http://${HOST}:${PORT}`);

  // Scheduler — KHÔNG chặn boot nếu DB chưa sẵn sàng.
  startJobs().catch((e) =>
    console.warn("pg-boss chưa khởi động (kiểm tra DATABASE_URL):", (e as Error).message));
}

async function shutdown(): Promise<void> {
  await stopJobs();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
