/* index.ts — Bootstrap Fastify + tRPC + scheduler pg-boss.
   Cổng 8910 (tránh đụng bridge 8909). */
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { eq } from "drizzle-orm";
import { sessions } from "@erp-framework/db";
import { appRouter } from "./router";
import { createContext } from "./context";
import { startJobs, stopJobs } from "./jobs";
import { db } from "./db";
import { SESSION_COOKIE } from "./auth";
import { runAgentChat } from "./agent-chat";
import { makeCallTool } from "./mcp-client";
import "./plugins"; // Đăng ký plugin server-side vào pluginRegistry

const PORT = Number(process.env.PORT ?? 8910);
const HOST = process.env.HOST ?? "127.0.0.1";

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  // CORS — cho frontend (origin khác) gọi kèm cookie phiên.
  // origin: true = phản chiếu origin request (tiện cho dev); prod nên
  // khoá qua CORS_ORIGIN. credentials: true để cookie đi qua.
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? true,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter, createContext },
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
      await runAgentChat({
        db,
        profileName: body.profileName,
        system: body.system ?? "Bạn là trợ lý ERP.",
        messages: body.messages ?? [],
        tools: body.tools ?? [],
        callTool: makeCallTool(db),
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
