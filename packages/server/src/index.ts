/* index.ts — Bootstrap Fastify + tRPC + scheduler pg-boss.
   Cổng 8910 (tránh đụng bridge 8909). */
import "./load-env"; // PHẢI đứng đầu — nạp .env trước khi db.ts đọc env
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { roleCan } from "@erp-framework/core";
import { agents, apiKeys, knowledgeSources, sessions } from "@erp-framework/db";
import { runMigrations } from "@erp-framework/db/migrate";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocketPlugin from "@fastify/websocket";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { and, eq, sql } from "drizzle-orm";
import Fastify from "fastify";
import { canActOnAgentLite } from "./agent-acl";
import { runAgentChat, type ToolDef } from "./agent-chat";
import {
  appendMemory,
  formatMemoryPreamble,
  loadAgentMemory,
  MEMORY_FILES,
  type MemoryFile,
} from "./agent-memory";
import { SESSION_COOKIE } from "./auth";
import { assertWithinBudget } from "./budget";
import { createContext, resolveActiveCompany } from "./context";
import { db } from "./db";
import { registerGraphQL } from "./graphql";
import { registerIotRoutes } from "./iot";
import { startIotMqtt, stopIotMqtt } from "./iot-mqtt";
import { enqueueKbIngest, startJobs, stopJobs } from "./jobs";
import { knowledgeSearch } from "./knowledge-search";
import { makeCallTool } from "./mcp-client";
import { registerOAuth } from "./oauth";
import { registerPrintRoutes } from "./print-routes";
import { registerRestApi } from "./rest-api";
import { appRouter } from "./router";
import { isChannelAllowed } from "./ws-channels";
import { registerConnection, subscribe, unsubscribe } from "./ws-hub";
import "./plugins"; // Đăng ký plugin server-side vào pluginRegistry
import { bootstrapTools, shutdownTools } from "./tools";

const PORT = Number(process.env.PORT ?? 8910);
const HOST = process.env.HOST ?? "127.0.0.1";
/** Thư mục lưu file tải lên Knowledge Base (volume Docker erp-uploads). */
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/data/uploads";

/* Tool server-side luôn có cho agent — tra cứu Knowledge Base. */
const KB_SEARCH_TOOL: ToolDef = {
  name: "knowledge_search",
  description:
    "Tra cứu Knowledge Base nội bộ của công ty (tài liệu đã tải lên, dữ liệu " +
    "ERP, ghi chú). Dùng khi cần thông tin nội bộ để trả lời.",
  schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Câu hỏi hoặc từ khoá cần tra cứu" },
    },
    required: ["query"],
  },
};

/* Tool agent tự ghi nhớ vào memory file của chính nó. Chỉ cấp khi
   agentId được client truyền (route /agent/chat đã xác minh agent
   thuộc đúng công ty). Append-only — không cho ghi đè cả file. */
const MEMORY_REMEMBER_TOOL: ToolDef = {
  name: "memory_remember",
  description:
    "Ghi nhớ một điều mới vào memory file của agent (vd USER.md cho sở " +
    "thích người dùng). Append theo dòng kèm dấu thời gian.",
  schema: {
    type: "object",
    properties: {
      file: {
        type: "string",
        enum: [...MEMORY_FILES],
        description: "Tên file memory cần ghi (IDENTITY, SOUL, USER, …).",
      },
      content: {
        type: "string",
        description: "Nội dung ngắn cần lưu (1-3 câu).",
      },
    },
    required: ["file", "content"],
  },
};

/* Tool lưu nội dung vào Knowledge Base — chỉ cấp cho vai trò có
   quyền create:knowledge. Tạo một nguồn tri thức dạng văn bản. */
const KB_ADD_TOOL: ToolDef = {
  name: "knowledge_add",
  description:
    "Lưu một đoạn nội dung vào Knowledge Base của công ty (tạo nguồn tri thức " +
    "dạng văn bản). Dùng khi người dùng yêu cầu ghi nhớ / lưu lại thông tin.",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Tiêu đề ngắn cho nội dung" },
      content: { type: "string", description: "Nội dung cần lưu vào tri thức" },
    },
    required: ["title", "content"],
  },
};

async function main(): Promise<void> {
  // Migrate trước khi listen — idempotent (drizzle ghi nhật ký schema
  // "drizzle" để theo dõi). Fail-fast nếu schema không apply được:
  // app đứng lên với DB sai schema sẽ gây lỗi runtime khó debug hơn.
  // Hoạt động cho mọi deploy (Docker, k8s, PM2, native), không phụ
  // thuộc shell command bên ngoài.
  console.log("[migrate] chạy migrations...");
  try {
    await runMigrations(db);
    console.log("[migrate] ✓ DB schema đã đồng bộ.");
  } catch (e) {
    console.error("[migrate] LỖI:", (e as Error).message);
    throw e;
  }

  // Audit security: scan api_keys có scopes=[] (deny-by-default sẽ chặn
  // mọi request từ key này). Cảnh báo admin để cấp scope phù hợp hoặc
  // disable key. Không auto-fix vì không biết quyền user thật sự muốn.
  try {
    const insecure = await db
      .select({ id: apiKeys.id, label: apiKeys.label, companyId: apiKeys.companyId })
      .from(apiKeys)
      .where(and(eq(apiKeys.enabled, true), sql`jsonb_array_length(${apiKeys.scopes}) = 0`));
    if (insecure.length > 0) {
      console.warn(
        `[security] ${insecure.length} API key đang enabled với scopes=[] — ` +
          "tất cả request sẽ bị từ chối (deny-by-default). Cập nhật scopes qua " +
          "apiKeys.updateScopes hoặc disable key:",
      );
      for (const k of insecure) {
        console.warn(`  - id=${k.id} label="${k.label}" company=${k.companyId}`);
      }
    }
  } catch (e) {
    console.warn("[security] không scan được api_keys:", (e as Error).message);
  }

  // maxParamLength cao — tRPC httpBatchLink gộp nhiều procedure vào URL
  // (/trpc/a,b,c…); mặc định Fastify 100 ký tự sẽ làm batch lớn bị 404.
  // trustProxy — đọc X-Forwarded-For từ nginx/Traefik phía trước (Coolify
  // có 2 lớp proxy: Traefik → nginx → server). Mặc định Fastify trả IP
  // của connection peer (= nginx container) → rate-limit sẽ chung 1 IP
  // cho mọi user. Bật trustProxy để req.ip lấy IP client thật.
  const app = Fastify({
    logger: true,
    maxParamLength: 5000,
    trustProxy: true,
  });

  // CORS — cho frontend (origin khác) gọi kèm cookie phiên.
  // Production BẮT BUỘC khai báo CORS_ORIGIN tường minh: phản chiếu
  // mọi origin kèm credentials:true là lỗ hổng (web bất kỳ gọi API
  // kèm cookie nạn nhân). Dev: thiếu CORS_ORIGIN → phản chiếu origin.
  const corsOrigin = process.env.CORS_ORIGIN;
  if (process.env.NODE_ENV === "production" && !corsOrigin) {
    throw new Error(
      "CORS_ORIGIN bắt buộc ở production — khai báo (các) origin được " +
        "phép, phân tách bằng dấu phẩy nếu nhiều.",
    );
  }
  await app.register(cors, {
    origin: corsOrigin
      ? corsOrigin
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : true,
    credentials: true,
  });
  await app.register(cookie);
  // Multipart — cho route /upload nhận file tải lên (giới hạn 25MB).
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  // WebSocket — cho realtime push notifications + presence.
  await app.register(websocketPlugin);
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

  // Route REST cho thiết bị IoT — /iot/v1/* (auth header X-Device-Key).
  // Tách khỏi tRPC để firmware nhúng (curl/HTTP) dùng được trực tiếp.
  await registerIotRoutes(app);

  // Route REST tự sinh cho entity records — /api/v1/entities/:name/*
  // (auth header X-API-Key, scopes per entity). Mobile/external/3rd-party
  // dùng được thẳng, không cần codegen tRPC.
  registerRestApi(app, db);

  // Engine in PDF — GET /print/:id?format=html|pdf — render template + data.
  registerPrintRoutes(app, db);

  // GraphQL endpoint song song REST — /graphql với schema tự sinh từ
  // entity meta. Auth X-API-Key. v1 minimal: entity/records query +
  // createRecord mutation.
  registerGraphQL(app, db);

  // OAuth 2.0 client_credentials grant — POST /oauth/token. Wrapper
  // standard trên api_keys; trả lại chính sk_xxx làm access_token.
  registerOAuth(app, db);

  // Tool system — hydrate từ DB, quét TOOLS_DIR, mount HTTP proxy cho
  // web-app/mcp-server, auto-start tools có spawn.autoStart=true.
  // KHÔNG fail-fast: nếu thư mục tools không tồn tại → log warn, bỏ qua.
  await bootstrapTools(app, db);

  app.get("/", async () => ({
    name: "ERP Framework server",
    status: "ok",
    endpoints: { health: "/health", trpc: "/trpc", iot: "/iot/v1", ws: "/ws" },
  }));
  app.get("/health", async () => ({ ok: true, ts: Date.now() }));

  /* WebSocket endpoint — realtime push. Client connect kèm cookie phiên;
     server xác thực user qua sessions table, register vào ws-hub. Client
     gửi {action: "subscribe"|"unsubscribe", channel} để quản channels.
     Channel format: "notifications:<userId>" hoặc "presence:<recordId>".
     Server tự reject channel không khớp user/company. */
  app.get("/ws", { websocket: true }, async (socket, req) => {
    const sid = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
    if (!sid) {
      socket.close(1008, "Unauthorized");
      return;
    }
    const [s] = await db.select().from(sessions).where(eq(sessions.id, sid));
    if (!s || s.expiresAt < new Date()) {
      socket.close(1008, "Session expired");
      return;
    }
    const active = await resolveActiveCompany(db, s.userId, s.activeCompanyId);
    if (!active) {
      socket.close(1008, "No company");
      return;
    }
    const conn = registerConnection(socket as never, s.userId, active.companyId);
    socket.send(JSON.stringify({ channel: "system", payload: { ok: true, userId: s.userId } }));
    socket.on("message", (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString()) as { action?: string; channel?: string };
        if (!m.channel) return;
        // P4.1 — channel allowlist. Mọi channel phải khớp 1 trong các
        // pattern + scope theo user/company hiện tại. Channel ngoài
        // whitelist hoặc cross-tenant → silently drop (không reply
        // error để tránh oracle).
        if (!isChannelAllowed(m.channel, s.userId, active.companyId)) return;
        if (m.action === "subscribe") subscribe(conn, m.channel);
        else if (m.action === "unsubscribe") unsubscribe(conn, m.channel);
      } catch {
        /* malformed message — ignore */
      }
    });
  });

  /* Agent chat — SSE stream. Vòng lặp agentic (LLM + MCP tool) chạy
     server-side; mỗi bước phát một event. Cần phiên đăng nhập. */
  app.post("/agent/chat", async (req, reply) => {
    const sid = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
    if (!sid) {
      reply.code(401).send({ error: "Chưa đăng nhập" });
      return;
    }
    const [s] = await db.select().from(sessions).where(eq(sessions.id, sid));
    if (!s || s.expiresAt < new Date()) {
      reply.code(401).send({ error: "Phiên hết hạn" });
      return;
    }
    // Đa công ty: phân giải công ty đang chọn của phiên.
    const active = await resolveActiveCompany(db, s.userId, s.activeCompanyId);
    if (!active) {
      reply.code(403).send({ error: "Bạn chưa thuộc công ty nào" });
      return;
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
      // Khi chat được "gắn" với một agent cụ thể (vd đang ở /agents/$id):
      // load memory files của agent vào preamble + cấp tool memory_remember.
      agentId?: string;
    };
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const emit = (e: unknown) => raw.write(`data: ${JSON.stringify(e)}\n\n`);
    try {
      await assertWithinBudget(db, active.companyId);
      // callTool: "knowledge_search"/"knowledge_add" xử lý server-side;
      // các tool khác rơi về MCP. knowledge_add chỉ cấp khi đủ quyền.
      const mcpCallTool = makeCallTool(db, active.companyId);
      const canAddKb = roleCan(active.role, "create", "knowledge");

      // Nếu request gắn với một agent cụ thể (cùng công ty): nạp 7 file
      // memory thành preamble + cấp tool memory_remember + dùng model
      // của agent (+ fallback list) thay cho profileName của body.
      let memoryPreamble = "";
      let boundAgentId: string | null = null;
      const agentModels: string[] = [];
      if (body.agentId) {
        // ACL per-agent: nếu agent private, user phải là member; nếu open,
        // RBAC company-wide đã pass ở trên. canActOnAgentLite return false
        // cũng coi như "không gắn" — phiên chat vẫn chạy nhưng không có
        // memory + tool memory_remember.
        const allowed = await canActOnAgentLite(
          db,
          { id: s.userId, role: active.role, companyId: active.companyId },
          body.agentId,
          "chat",
        );
        const [ag] = allowed
          ? await db
              .select()
              .from(agents)
              .where(and(eq(agents.id, body.agentId), eq(agents.companyId, active.companyId)))
          : [];
        if (ag) {
          const mem = await loadAgentMemory(ag.id, ag.name);
          memoryPreamble = formatMemoryPreamble(mem) + "\n\n---\n\n";
          boundAgentId = ag.id;
          const cfg = (ag.config ?? {}) as { model?: string; fallbackModels?: string[] };
          const primary = cfg.model || ag.model;
          if (primary) agentModels.push(primary);
          if (Array.isArray(cfg.fallbackModels)) {
            for (const m of cfg.fallbackModels) {
              if (typeof m === "string" && m && !agentModels.includes(m)) {
                agentModels.push(m);
              }
            }
          }
        }
      }
      // Auto-RAG: tra Knowledge Base bằng câu hỏi mới nhất rồi CHÈN đoạn liên
      // quan vào system prompt. Cần thiết vì claude-cli (bridge) KHÔNG hỗ trợ
      // tool-calling → agent không tự gọi được knowledge_search. knowledgeSearch
      // đã lọc theo MIN_SCORE (chỉ đoạn liên quan). Fail-safe: lỗi không vỡ chat.
      let kbContext = "";
      try {
        const lastUser = [...(body.messages ?? [])]
          .reverse()
          .find((m) => m.role === "user")
          ?.content?.trim();
        if (lastUser) {
          const hits = await knowledgeSearch(db, active.companyId, lastUser, 5);
          if (hits.length) {
            kbContext =
              "\n\n## Tri thức nội bộ liên quan (Knowledge Base)\n" +
              "Ưu tiên dùng các trích đoạn sau để trả lời nếu phù hợp; nếu không liên quan thì bỏ qua.\n\n" +
              hits.map((h, i) => `[${i + 1}] Nguồn: ${h.sourceTitle}\n${h.content}`).join("\n\n");
          }
        }
      } catch (e) {
        console.warn("[agent] auto-RAG KB lỗi:", (e as Error).message);
      }
      const finalSystem = memoryPreamble + (body.system ?? "Bạn là trợ lý ERP.") + kbContext;

      const tools = [
        ...(body.tools ?? []),
        KB_SEARCH_TOOL,
        ...(canAddKb ? [KB_ADD_TOOL] : []),
        ...(boundAgentId ? [MEMORY_REMEMBER_TOOL] : []),
      ];
      const callTool = async (name: string, args: Record<string, unknown>) => {
        if (name === "memory_remember") {
          if (!boundAgentId) throw new Error("Chưa gắn agent cho phiên này.");
          const f = String(args.file ?? "") as MemoryFile;
          const content = String(args.content ?? "").trim();
          if (!content) throw new Error("Nội dung ghi nhớ rỗng.");
          if (!MEMORY_FILES.includes(f)) {
            throw new Error(`File memory không hợp lệ: ${f}`);
          }
          await appendMemory(boundAgentId, f, content);
          return { ok: true, file: f };
        }
        if (name === "knowledge_search") {
          const hits = await knowledgeSearch(db, active.companyId, String(args.query ?? ""), 5);
          return hits.map((h) => ({
            source: h.sourceTitle,
            content: h.content,
            score: Number(h.score.toFixed(3)),
          }));
        }
        if (name === "knowledge_add") {
          if (!canAddKb) throw new Error("Không có quyền thêm tri thức.");
          const title = String(args.title ?? "").trim() || "Ghi chú từ chat";
          const content = String(args.content ?? "").trim();
          if (!content) throw new Error("Nội dung lưu vào tri thức bị trống.");
          const [row] = await db
            .insert(knowledgeSources)
            .values({
              companyId: active.companyId,
              kind: "text",
              title,
              status: "pending",
              meta: { text: content },
              createdBy: s.userId,
            })
            .returning();
          if (!row) throw new Error("Không tạo được nguồn tri thức.");
          await enqueueKbIngest(row.id);
          return { ok: true, sourceId: row.id, title };
        }
        return mcpCallTool(name, args);
      };

      // Khi agent có model + fallback: thử lần lượt; chỉ retry khi
      // chưa stream event nào (lỗi pre-stream: auth, rate limit, model
      // unavailable…). Đã stream rồi mà lỗi giữa chừng → trả thẳng.
      if (agentModels.length > 0) {
        let lastErr = "";
        for (const m of agentModels) {
          let attemptStreamed = false;
          let attemptErr = "";
          const innerEmit = (e: { type: string; message?: string }) => {
            if (e.type === "error" && !attemptStreamed) {
              attemptErr = e.message ?? "unknown";
              return; // giữ lại, có thể thử model tiếp
            }
            attemptStreamed = true;
            emit(e);
          };
          await runAgentChat({
            db,
            companyId: active.companyId,
            userId: s.userId,
            modelOverride: m,
            system: finalSystem,
            messages: body.messages ?? [],
            tools,
            callTool,
            onEvent: innerEmit,
          });
          if (attemptStreamed) {
            raw.end();
            return;
          }
          lastErr = attemptErr || "Không có event nào phát ra";
          console.log(`[agent-fallback] ${m} thất bại → ${lastErr}`);
        }
        emit({
          type: "error",
          message:
            `Tất cả ${agentModels.length} model trong cấu hình agent đều thất bại. ` +
            `Lỗi cuối: ${lastErr}`,
        });
      } else {
        // Không gắn agent → flow cũ, theo profileName.
        await runAgentChat({
          db,
          companyId: active.companyId,
          userId: s.userId,
          profileName: body.profileName,
          system: finalSystem,
          messages: body.messages ?? [],
          tools,
          callTool,
          onEvent: emit,
        });
      }
    } catch (e) {
      emit({ type: "error", message: (e as Error).message });
    }
    raw.end();
  });

  /* Tải file lên Knowledge Base — multipart/form-data, field "file".
     Lưu vào UPLOAD_DIR, tạo knowledge_sources kind=file rồi đẩy vào
     hàng đợi kb-ingest (worker gọi Tika trích văn bản). Endpoint nằm
     ngoài tRPC nên tự kiểm phiên + RBAC như /agent/chat. */
  app.post("/upload", async (req, reply) => {
    const sid = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
    if (!sid) {
      reply.code(401).send({ error: "Chưa đăng nhập" });
      return;
    }
    const [s] = await db.select().from(sessions).where(eq(sessions.id, sid));
    if (!s || s.expiresAt < new Date()) {
      reply.code(401).send({ error: "Phiên hết hạn" });
      return;
    }
    const active = await resolveActiveCompany(db, s.userId, s.activeCompanyId);
    if (!active) {
      reply.code(403).send({ error: "Bạn chưa thuộc công ty nào" });
      return;
    }
    if (!roleCan(active.role, "create", "knowledge")) {
      reply.code(403).send({ error: 'Vai trò không có quyền "create:knowledge"' });
      return;
    }

    const file = await req.file();
    if (!file) {
      reply.code(400).send({ error: "Thiếu file tải lên" });
      return;
    }
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch (e) {
      // @fastify/multipart ném khi file vượt limits.fileSize.
      reply.code(413).send({ error: `Không đọc được file: ${(e as Error).message}` });
      return;
    }
    const originalName = file.filename || "tài-liệu";
    const mime = file.mimetype || "application/octet-stream";

    const [row] = await db
      .insert(knowledgeSources)
      .values({
        companyId: active.companyId,
        kind: "file",
        title: originalName,
        status: "pending",
        meta: { originalName, mime, size: buf.length },
        createdBy: s.userId,
      })
      .returning();
    if (!row) {
      reply.code(500).send({ error: "Không tạo được nguồn" });
      return;
    }

    const dir = join(UPLOAD_DIR, active.companyId);
    const path = join(dir, row.id + extname(originalName));
    await mkdir(dir, { recursive: true });
    await writeFile(path, buf);
    await db
      .update(knowledgeSources)
      .set({
        meta: { originalName, mime, size: buf.length, path },
        updatedAt: new Date(),
      })
      .where(eq(knowledgeSources.id, row.id));

    await enqueueKbIngest(row.id);
    reply.send({ id: row.id, title: row.title, status: "pending" });
  });

  await app.listen({ host: HOST, port: PORT });
  console.log(`ERP Framework server → http://${HOST}:${PORT}`);

  // Scheduler — KHÔNG chặn boot nếu DB chưa sẵn sàng.
  startJobs().catch((e) =>
    console.warn("pg-boss chưa khởi động (kiểm tra DATABASE_URL):", (e as Error).message),
  );

  // MQTT bridge cho IoT — no-op nếu MQTT_URL không khai báo.
  startIotMqtt().catch((e) => console.warn("[iot-mqtt] không kết nối được:", (e as Error).message));
}

async function shutdown(): Promise<void> {
  await stopIotMqtt();
  await stopJobs();
  await shutdownTools();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
