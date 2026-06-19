/* index.ts — Bootstrap Fastify + tRPC + scheduler pg-boss.
   Cổng 8910 (tránh đụng bridge 8909). */
import "./load-env"; // PHẢI đứng đầu — nạp .env trước khi db.ts đọc env
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { roleCan } from "@erp-framework/core";
import { agents, apiKeys, entities, knowledgeSources, sessions } from "@erp-framework/db";
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
import { CAD_GENERATE_TOOL, runCadGenerate } from "./cad-tool";
import { createContext, resolveActiveCompany } from "./context";
import { db } from "./db";
import { registerDrawingRoutes } from "./drawing-routes";
import { registerGraphQL } from "./graphql";
import { registerIotRoutes } from "./iot";
import { startIotMqtt, stopIotMqtt } from "./iot-mqtt";
import { enqueueKbIngest, startJobs, stopJobs } from "./jobs";
import { agenticRetrieve } from "./knowledge-agentic";
import { knowledgeSearch } from "./knowledge-search";
import { registerBackupMcp } from "./mcp-backup";
import { registerCadMcp } from "./mcp-cad";
import { makeCallTool } from "./mcp-client";
import { registerErrorsMcp } from "./mcp-errors";
import { registerFeedbackMcp } from "./mcp-feedback";
import { registerMigrationMcp } from "./mcp-migration";
import { registerOAuth } from "./oauth";
import { registerPrintRoutes } from "./print-routes";
import { getRecordStore } from "./record-store";
import { registerRestApi } from "./rest-api";
import { appRouter } from "./router";
import {
  decryptDataOut,
  loadEntityFields,
  queryParams,
  stripUnreadableFields,
} from "./router-helpers";
import { registerWebhookRoutes } from "./webhook-routes";
import { isChannelAllowed } from "./ws-channels";
import { verifyOoJwt } from "./documents-router";
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
    "ERP, ghi chú). Trả các đoạn liên quan kèm nguồn + score. Gọi nhiều lần " +
    "với truy vấn cụ thể khác nhau nếu câu hỏi nhiều khía cạnh. Lọc sourceKind " +
    "khi biết loại nguồn; tăng k khi cần rộng hơn.",
  schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Câu hỏi hoặc từ khoá cần tra cứu (nên cụ thể, 1 ý/lần)",
      },
      k: { type: "integer", minimum: 1, maximum: 20, description: "Số đoạn trả về (mặc định 5)" },
      sourceKind: {
        type: "string",
        enum: ["file", "entity", "text"],
        description:
          "Lọc theo loại nguồn: file (tài liệu), entity (dữ liệu ERP), text (ghi chú). Bỏ trống = tất cả.",
      },
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

/* Tool tra cứu DỮ LIỆU CÓ CẤU TRÚC (entity_records) — source routing của
   Agentic RAG. Chỉ cấp khi role có "view:entity". Deny-by-default: chỉ
   entity bật meta.agentSearchable=true mới truy được. Field-level RBAC
   strip áp lên kết quả. Xem docs/AGENTIC-RAG-DESIGN-2026-05-31.md §5. */
const RECORDS_SEARCH_TOOL: ToolDef = {
  name: "records_search",
  description:
    "Tìm bản ghi dữ liệu CÓ CẤU TRÚC của một entity (vd đơn hàng, khách " +
    "hàng, sản phẩm). Dùng khi câu hỏi về SỐ LIỆU/BẢN GHI cụ thể, không " +
    "phải văn bản tài liệu (dùng knowledge_search cho tài liệu).",
  schema: {
    type: "object",
    properties: {
      entity: { type: "string", description: "Tên kỹ thuật của entity (vd 'don_hang')." },
      q: { type: "string", description: "Từ khoá full-text trên các field searchable." },
      filters: {
        type: "object",
        description:
          'Lọc theo field: { "<field>": { "op": "=|!=|contains|>|>=|<|<=|in", "value": ... } }.',
      },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Số bản ghi (mặc định 10)." },
    },
    required: ["entity"],
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

  // MCP server cho module Phản hồi — POST /mcp (JSON-RPC), auth X-API-Key
  // scope feedback:read|propose. AI ngoài (Claude) đọc feedback + ghi đề
  // xuất PENDING; admin duyệt trong UI mới thực thi (xem mcp-feedback.ts).
  registerFeedbackMcp(app, db);

  // MCP server cho module Lỗi — POST /mcp/errors (JSON-RPC), auth X-API-Key
  // scope errors:read|write. AI ngoài (Claude) đọc lỗi runtime app gửi về +
  // đổi trạng thái / XOÁ trực tiếp (xem mcp-errors.ts). Khác /mcp Phản hồi:
  // ở đây AI mutate trực tiếp (cần errors:write, deny-by-default).
  registerErrorsMcp(app, db);

  // MCP server cho module Migration — POST /mcp/migration (JSON-RPC), auth X-API-Key
  // scope migration:read. AI đọc trạng thái delta-sync, full-import job, entity
  // schema (storage tier, field mapping) để phân tích và gợi ý tối ưu.
  registerMigrationMcp(app, db);

  // MCP server cho bản vẽ CAD — POST /mcp/cad (JSON-RPC), auth X-API-Key
  // scope cad:read|write. Provider 3: máy trạm external (Claude Code +
  // FreeCAD MCP local) đọc sản phẩm/định mức + ghi bản vẽ "Bản vẽ AI"
  // ngược về (xem mcp-cad.ts). Mọi kết nối outbound từ máy trạm.
  registerCadMcp(app, db);

  // MCP server SAO LƯU — POST /mcp/backup (JSON-RPC) + GET /mcp/backup/db|uploads
  // (STREAM), auth X-API-Key scope backup:read|run|full. Cho máy KHÁC (offsite)
  // kéo backup TOÀN BỘ dữ liệu theo lịch — độc lập backup push-Drive (xem
  // mcp-backup.ts + tooling/backup-pull). Dump đa tenant → chỉ cấp backup:full
  // cho key sao lưu riêng của operator.
  registerBackupMcp(app, db);

  // Webhook ngoài kích hoạt workflow — POST /webhooks/workflow/:token
  // (token = triggerConfig.token; không cần auth header). Trigger 'webhook'.
  registerWebhookRoutes(app, db);

  // Engine in PDF — GET /print/:id?format=html|pdf — render template + data.
  registerPrintRoutes(app, db);

  // Stream file PDF bản vẽ — GET /banve/file?id=<uuid> (file mount BANVE_FILES_DIR).
  registerDrawingRoutes(app, db);

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
      // "Tìm sâu" (deep search): bật query-rewrite + CRAG grading trong
      // auto-RAG orchestrated. Mặc định false (Fast — rẻ). Xem design §1.5.
      deepSearch?: boolean;
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
      const canViewRecords = roleCan(active.role, "view", "entity");
      // cad_generate: cần quyền tạo record (bản vẽ) + engine CAD đã cấu hình
      // (FREECAD_MCP_URL). Vắng 1 trong 2 → tool không xuất hiện (fail-closed).
      const canGenerateCad =
        roleCan(active.role, "create", "entity") && !!process.env.FREECAD_MCP_URL;

      // Nếu request gắn với một agent cụ thể (cùng công ty): nạp 7 file
      // memory thành preamble + cấp tool memory_remember + dùng model
      // của agent (+ fallback list) thay cho profileName của body.
      let memoryPreamble = "";
      let boundAgentId: string | null = null;
      const agentModels: string[] = [];
      // #3b: phạm vi tri thức + công cụ riêng của agent (đọc từ config).
      let agentSourceIds: string[] | undefined;
      let agentToolAllow: string[] | null = null;
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
          const cfg = (ag.config ?? {}) as {
            model?: string;
            fallbackModels?: string[];
            knowledgeSourceIds?: string[];
            tools?: string[];
          };
          // Phạm vi tri thức: chỉ giới hạn khi agent cấu hình ≥1 nguồn;
          // rỗng/thiếu → agent dùng toàn bộ tri thức công ty (như trước).
          if (Array.isArray(cfg.knowledgeSourceIds) && cfg.knowledgeSourceIds.length > 0) {
            agentSourceIds = cfg.knowledgeSourceIds.filter(
              (x): x is string => typeof x === "string",
            );
          }
          // Allowlist công cụ: undefined = chưa cấu hình (agent cũ) → KHÔNG
          // ép; [] hoặc [...] = đã cấu hình → fail-closed theo danh sách.
          agentToolAllow = Array.isArray(cfg.tools)
            ? cfg.tools.filter((x): x is string => typeof x === "string")
            : null;
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
      // Auto-RAG orchestrated: tra Knowledge Base bằng câu hỏi mới nhất rồi
      // CHÈN đoạn liên quan + chỉ thị trích nguồn vào system prompt. Đường
      // dùng chung mọi adapter (gồm claude-cli — bridge tool-call emulation
      // dễ vỡ nên ưu tiên đường này). Fail-safe: lỗi không vỡ chat.
      //  - deepSearch=false (Fast, mặc định): tìm thẳng, KHÔNG tốn LLM thêm.
      //  - deepSearch=true (Tìm sâu): plan (rewrite) + CRAG grading.
      // Xem docs/AGENTIC-RAG-DESIGN-2026-05-31.md §1.5.
      let kbContext = "";
      try {
        const lastUser = [...(body.messages ?? [])]
          .reverse()
          .find((m) => m.role === "user")
          ?.content?.trim();
        if (lastUser) {
          const { hits, gradedOut } = await agenticRetrieve(db, active.companyId, lastUser, {
            limit: 5,
            userId: s.userId,
            plan: body.deepSearch === true,
            grade: body.deepSearch === true,
            // Tìm sâu: thêm graph expansion (đoạn lân cận) + nén + re-rank LLM.
            expand: body.deepSearch === true,
            rerank: body.deepSearch === true,
            sourceIds: agentSourceIds,
          });
          if (hits.length && !gradedOut) {
            kbContext =
              "\n\n## Tri thức nội bộ liên quan (Knowledge Base)\n" +
              "Khi dùng thông tin từ các trích đoạn dưới, TRÍCH NGUỒN dạng " +
              "[#tên nguồn]. CHỈ trả lời dựa trên nội dung đã truy hồi; nếu " +
              'không đủ thông tin, nói rõ "Không tìm thấy trong tri thức nội ' +
              'bộ" — TUYỆT ĐỐI không bịa.\n\n' +
              hits
                .map((h, i) => `[${i + 1}] Nguồn: [#${h.sourceTitle}]\n${h.content}`)
                .join("\n\n");
          } else if (gradedOut) {
            // CRAG kết luận lạc đề → KHÔNG chèn rác, nhắc model nói thẳng.
            kbContext =
              "\n\n## Tri thức nội bộ\n" +
              "Không tìm thấy nội dung liên quan trong Knowledge Base. Nếu câu " +
              'hỏi cần dữ liệu nội bộ, hãy nói rõ "Không tìm thấy trong tri ' +
              'thức nội bộ" thay vì suy đoán.';
          }
        }
      } catch (e) {
        console.warn("[agent] auto-RAG KB lỗi:", (e as Error).message);
      }
      const finalSystem = memoryPreamble + (body.system ?? "Bạn là trợ lý ERP.") + kbContext;

      const tools = [
        ...(body.tools ?? []),
        KB_SEARCH_TOOL,
        ...(canViewRecords ? [RECORDS_SEARCH_TOOL] : []),
        ...(canAddKb ? [KB_ADD_TOOL] : []),
        ...(canGenerateCad ? [CAD_GENERATE_TOOL] : []),
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
          const k = Number(args.k);
          const sk = String(args.sourceKind ?? "");
          const sourceKind = (["file", "entity", "text"] as const).find((v) => v === sk);
          const hits = await knowledgeSearch(db, active.companyId, String(args.query ?? ""), {
            limit: Number.isFinite(k) ? k : 5,
            sourceKind,
            sourceIds: agentSourceIds,
          });
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
        if (name === "records_search") {
          // RBAC: kiểm lại tại thời điểm chạy (fail-closed, không tin vào
          // việc tool đã/ chưa được liệt kê).
          if (!canViewRecords) throw new Error('Không có quyền "view:entity".');
          const entityName = String(args.entity ?? "").trim();
          if (!entityName) throw new Error("Thiếu tên entity.");
          // Resolve entity theo tên CASE-INSENSITIVE trong phạm vi công ty.
          const [ent] = await db
            .select()
            .from(entities)
            .where(
              and(
                eq(entities.companyId, active.companyId),
                sql`lower(${entities.name}) = lower(${entityName})`,
              ),
            )
            .limit(1);
          if (!ent)
            throw new Error(
              `Không tìm thấy entity "${entityName}" trong hệ thống. ` +
                `Hãy dùng đúng tên kỹ thuật của entity (phân biệt hoa/thường không quan trọng). ` +
                `Admin có thể xem danh sách entity tại mục Entities trong ứng dụng.`,
            );
          // Deny-by-default: chỉ entity được bật cờ opt-in mới cho agent tra.
          const meta = (ent.meta ?? {}) as { agentSearchable?: boolean };
          if (meta.agentSearchable !== true) {
            throw new Error(
              `Entity "${entityName}" chưa được cấp quyền cho agent tìm kiếm. ` +
                `Admin cần vào cài đặt entity → bật "Cho phép agent tìm kiếm" (AgentSearchable). ` +
                `Đây là tính năng opt-in để bảo vệ dữ liệu nhạy cảm.`,
            );
          }
          // Validate query của LLM qua zod (queryParams) — bỏ field rác.
          const parsed = queryParams.safeParse({
            q: typeof args.q === "string" ? args.q : undefined,
            filters:
              args.filters && typeof args.filters === "object"
                ? (args.filters as Record<string, unknown>)
                : undefined,
            limit: Math.min(50, Math.max(1, Number(args.limit) || 10)),
          });
          const query = parsed.success ? parsed.data : { limit: 10 };
          // Qua RecordStore — HYBRID-aware (entity tier='table' đọc bảng thật).
          const { rows } = await getRecordStore(db).list(active.companyId, ent.id, {
            q: query?.q,
            filters: query?.filters,
            limit: query?.limit ?? 10,
            withTotal: false,
          });
          // Decrypt + field-level RBAC strip (đồng nhất records.get).
          const fields = await loadEntityFields(db, active.companyId, ent.id);
          return rows.map((r) => ({
            id: r.id,
            data: stripUnreadableFields(
              fields,
              decryptDataOut(fields, r.data as Record<string, unknown>),
              active.role,
            ),
          }));
        }
        if (name === "cad_generate") {
          // RBAC kiểm lại tại runtime (fail-closed).
          if (!canGenerateCad) {
            throw new Error(
              'Không thể sinh bản vẽ CAD: cần quyền "create:entity" và FREECAD_MCP_URL đã cấu hình.',
            );
          }
          // Tool GHI dữ liệu — tôn trọng allowlist của agent (nếu đã cấu hình):
          // agent chỉ gọi được khi "cad_generate" nằm trong agents.config.tools.
          if (agentToolAllow && !agentToolAllow.includes("cad_generate")) {
            throw new Error('Agent không được phép gọi công cụ "cad_generate".');
          }
          const a = args as {
            masp?: unknown;
            params?: unknown;
            family?: unknown;
            format?: unknown;
          };
          return runCadGenerate(db, active.companyId, {
            masp: String(a.masp ?? ""),
            params:
              a.params && typeof a.params === "object" ? (a.params as Record<string, unknown>) : {},
            family: typeof a.family === "string" ? a.family : undefined,
            format:
              a.format === "html" || a.format === "pdf" || a.format === "svg"
                ? a.format
                : undefined,
            createdBy: s.userId,
          });
        }
        // #3b: fail-closed enforce allowlist công cụ của agent (chỉ khi đã
        // cấu hình — agentToolAllow != null). Tool built-in (memory/knowledge/
        // records) đã return ở trên nên không vướng allowlist này.
        if (agentToolAllow && !agentToolAllow.includes(name)) {
          throw new Error(`Agent không được phép gọi công cụ "${name}".`);
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

    // Nhận visibility từ form field (mặc định "company").
    const rawVis = (req.body as Record<string, unknown> | undefined)?.visibility;
    const visibility =
      typeof rawVis === "string" && ["private", "restricted", "company", "public"].includes(rawVis)
        ? rawVis
        : "company";

    const [row] = await db
      .insert(knowledgeSources)
      .values({
        companyId: active.companyId,
        kind: "file",
        title: originalName,
        status: "pending",
        visibility,
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

  /* Upload ảnh cho field type="image" — lưu vào UPLOAD_DIR/img/<companyId>/,
     trả { url } để frontend lưu vào field thay vì base64. */
  app.post("/upload/image", async (req, reply) => {
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

    // Allowlist chỉ raster — loại trừ SVG (có thể chứa <script> → XSS).
    const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
    const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

    const file = await req.file();
    if (!file) {
      reply.code(400).send({ error: "Thiếu file" });
      return;
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      reply.code(400).send({ error: "Chỉ chấp nhận JPEG/PNG/GIF/WebP" });
      return;
    }
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch (e) {
      reply.code(413).send({ error: `File quá lớn: ${(e as Error).message}` });
      return;
    }
    if (buf.length > 10 * 1024 * 1024) {
      reply.code(413).send({ error: "Ảnh không được vượt quá 10MB" });
      return;
    }

    const ext = extname(file.filename || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      reply.code(400).send({ error: "Định dạng file không hợp lệ" });
      return;
    }
    const filename = randomUUID() + ext;
    const dir = join(UPLOAD_DIR, "img", active.companyId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), buf);

    reply.send({ url: `/files/img/${active.companyId}/${filename}` });
  });

  /* Serve ảnh entity — /files/img/:companyId/:file.
     Kiểm tra session + xác nhận user thuộc companyId (chống cross-tenant). */
  app.get("/files/img/:companyId/:file", async (req, reply) => {
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

    const { companyId, file } = req.params as { companyId: string; file: string };
    if (!/^[0-9a-f-]+$/.test(companyId) || !/^[\w.-]+$/.test(file)) {
      reply.code(400).send({ error: "Path không hợp lệ" });
      return;
    }

    // Xác nhận user thuộc companyId trong URL — chặn cross-tenant.
    const membership = await resolveActiveCompany(db, s.userId, companyId);
    if (!membership || membership.companyId !== companyId) {
      reply.code(403).send({ error: "Không có quyền truy cập" });
      return;
    }

    const filePath = join(UPLOAD_DIR, "img", companyId, file);
    try {
      await stat(filePath);
    } catch {
      reply.code(404).send({ error: "Không tìm thấy file" });
      return;
    }

    const RASTER_MIME: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    const ext = extname(file).toLowerCase();
    const mime = RASTER_MIME[ext];
    if (!mime) {
      reply.code(400).send({ error: "Định dạng không hợp lệ" });
      return;
    }
    reply.header("Content-Type", mime);
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    reply.send(createReadStream(filePath));
  });

  /* ── Public share file endpoint (không cần login) ─────────────────────
     Dùng cho link chia sẻ công khai: knowledge_sources.visibility='public'
     + share_token match → stream file ra browser, không cần session. */
  app.get("/doc/share-file/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const { download } = req.query as { download?: string };
    const [source] = await db
      .select()
      .from(knowledgeSources)
      .where(
        and(eq(knowledgeSources.shareToken, token), eq(knowledgeSources.visibility, "public")),
      );
    if (!source) {
      reply.code(404).send({ error: "Link không hợp lệ hoặc đã hết hạn" });
      return;
    }
    const meta = (source.meta ?? {}) as Record<string, unknown>;
    const filePath = meta.path as string | undefined;
    if (!filePath) {
      reply.code(404).send({ error: "File chưa được lưu" });
      return;
    }
    try {
      await stat(filePath);
    } catch {
      reply.code(404).send({ error: "File không tồn tại trên ổ đĩa" });
      return;
    }
    const rawMime = (meta.mime as string | undefined) ?? "application/octet-stream";
    // Chỉ serve inline cho MIME an toàn (không chạy JS trên app origin).
    // Mọi loại khác (text/html, text/xml, ...) → attachment + octet-stream.
    const SAFE_INLINE = new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ]);
    const safeMime = SAFE_INLINE.has(rawMime) ? rawMime : "application/octet-stream";
    const isInline = SAFE_INLINE.has(rawMime) && download !== "1";
    reply.header("Content-Type", safeMime);
    reply.header(
      "Content-Disposition",
      `${isInline ? "inline" : "attachment"}; filename="${encodeURIComponent(source.title)}"`,
    );
    reply.header("X-Content-Type-Options", "nosniff");
    // sandbox: ngăn script/form nếu browser interpret content như document
    reply.header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' blob:;");
    reply.header("X-File-Title", encodeURIComponent(source.title));
    reply.header("X-File-Kind", source.kind ?? "file");
    reply.send(createReadStream(filePath));
  });

  /* Endpoint JSON metadata (không cần login) cho trang share SPA. */
  app.get("/doc/share-meta/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const [source] = await db
      .select({
        id: knowledgeSources.id,
        title: knowledgeSources.title,
        kind: knowledgeSources.kind,
        meta: knowledgeSources.meta,
        createdAt: knowledgeSources.createdAt,
      })
      .from(knowledgeSources)
      .where(
        and(eq(knowledgeSources.shareToken, token), eq(knowledgeSources.visibility, "public")),
      );
    if (!source) {
      reply.code(404).send({ error: "Link không hợp lệ hoặc đã hết hạn" });
      return;
    }
    const meta = (source.meta ?? {}) as Record<string, unknown>;
    reply.send({
      id: source.id,
      title: source.title,
      kind: source.kind,
      mime: (meta.mime as string | undefined) ?? "application/octet-stream",
      originalName: (meta.originalName as string | undefined) ?? source.title,
      size: (meta.size as number | undefined) ?? 0,
      createdAt: source.createdAt,
    });
  });

  /* ── OnlyOffice Document Server integration ─────────────────────────────
     2 REST endpoints phục vụ OnlyOffice container (gọi server→server qua
     Docker DNS, KHÔNG qua browser):
     1. GET  /doc/file/:sourceId?token=<jwt>  — stream file về cho OO
     2. POST /doc/callback/:sourceId          — OO gọi khi user save/close
  ─────────────────────────────────────────────────────────────────────── */

  /* Serve file cho OnlyOffice kéo về để render editor.
     Auth: JWT query param (signed với ONLYOFFICE_JWT_SECRET). */
  app.get("/doc/file/:sourceId", async (req, reply) => {
    const { sourceId } = req.params as { sourceId: string };
    const { token } = req.query as { token?: string };
    if (!token) {
      reply.code(401).send({ error: "Thiếu token" });
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = verifyOoJwt(token) as Record<string, unknown>;
    } catch {
      reply.code(401).send({ error: "Token không hợp lệ hoặc hết hạn" });
      return;
    }
    if (payload.sourceId !== sourceId) {
      reply.code(403).send({ error: "Token không khớp sourceId" });
      return;
    }
    const companyId = payload.companyId as string;
    const [source] = await db
      .select()
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.companyId, companyId)));
    if (!source) {
      reply.code(404).send({ error: "Không tìm thấy file" });
      return;
    }
    const meta = (source.meta ?? {}) as Record<string, unknown>;
    const filePath = meta.path as string | undefined;
    if (!filePath) {
      reply.code(404).send({ error: "File chưa được lưu" });
      return;
    }
    try {
      await stat(filePath);
    } catch {
      reply.code(404).send({ error: "File không tồn tại trên ổ đĩa" });
      return;
    }
    const mime = (meta.mime as string | undefined) ?? "application/octet-stream";
    reply.header("Content-Type", mime);
    reply.header(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(source.title)}"`,
    );
    reply.send(createReadStream(filePath));
  });

  /* Callback từ OnlyOffice khi user save/đóng document.
     OnlyOffice gửi Authorization: Bearer <jwt> (payload = { payload: body }).
     status=2 → tài liệu sẵn sàng download từ body.url → ghi đè file + cập nhật editKey. */
  app.post("/doc/callback/:sourceId", async (req, reply) => {
    const { sourceId } = req.params as { sourceId: string };

    // Verify JWT từ Authorization header
    const authHeader = (req.headers.authorization as string | undefined) ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!bearerToken) {
      // OnlyOffice gửi không có JWT khi JWT_ENABLED=false — trả lỗi rõ ràng.
      reply.send({ error: 1 });
      return;
    }
    try {
      const jwtPayload = verifyOoJwt(bearerToken) as Record<string, unknown>;
      // payload chứa callback body gốc
      const body = (jwtPayload.payload ?? jwtPayload) as Record<string, unknown>;
      await handleOoCallback(sourceId, body);
    } catch (e) {
      console.warn("[doc/callback] JWT verify failed:", (e as Error).message);
      reply.send({ error: 1 });
      return;
    }
    reply.send({ error: 0 });
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

/** Xử lý OnlyOffice save callback.
 *  status=2: document đã save, tải từ body.url về ghi đè file gốc + cập nhật editKey. */
async function handleOoCallback(sourceId: string, body: Record<string, unknown>): Promise<void> {
  const status = body.status as number;
  // status 1 = đang edit (ping định kỳ), 2 = ready to save, 6 = error.
  // Chỉ xử lý status=2 (document đã lưu xong phía OnlyOffice).
  if (status !== 2) return;

  const downloadUrl = body.url as string | undefined;
  const newKey = body.key as string | undefined;
  if (!downloadUrl) {
    console.warn(`[doc/callback] sourceId=${sourceId} status=2 nhưng thiếu url`);
    return;
  }

  // Chặn SSRF: chỉ cho phép fetch từ host onlyoffice (Docker DNS) qua http.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(downloadUrl);
  } catch {
    console.error(`[doc/callback] URL không hợp lệ: ${downloadUrl}`);
    return;
  }
  if (parsedUrl.protocol !== "http:" || parsedUrl.hostname !== "onlyoffice") {
    console.error(`[doc/callback] URL bị chặn (chỉ nhận onlyoffice nội bộ): ${downloadUrl}`);
    return;
  }

  const [source] = await db
    .select()
    .from(knowledgeSources)
    .where(eq(knowledgeSources.id, sourceId));
  if (!source) {
    console.warn(`[doc/callback] sourceId=${sourceId} không tồn tại trong DB`);
    return;
  }
  const meta = (source.meta ?? {}) as Record<string, unknown>;
  const filePath = meta.path as string | undefined;
  if (!filePath) {
    console.warn(`[doc/callback] sourceId=${sourceId} chưa có meta.path`);
    return;
  }

  // Tải file mới về từ OnlyOffice (URL tạm, hết hạn sau 15 phút). Không theo redirect.
  const res = await fetch(downloadUrl, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    console.error(`[doc/callback] Tải file thất bại: ${res.status} ${downloadUrl}`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(filePath, buf);

  // Cập nhật editKey + size trong meta (merge jsonb, KHÔNG ghi đè toàn bộ).
  // Đặt status=pending để worker KB biết cần nạp lại embedding.
  const ooMeta = { ...((meta.onlyoffice ?? {}) as Record<string, unknown>), editKey: newKey };
  await db
    .update(knowledgeSources)
    .set({
      status: "pending",
      error: null,
      meta: { ...meta, size: buf.length, onlyoffice: ooMeta },
      updatedAt: new Date(),
    })
    .where(eq(knowledgeSources.id, sourceId));

  try {
    await enqueueKbIngest(sourceId);
    console.info(
      `[doc/callback] Đã lưu ${sourceId} (${buf.length} bytes), enqueued KB re-ingest, editKey=${newKey}`,
    );
  } catch (e) {
    console.error(
      `[doc/callback] File lưu OK nhưng enqueue re-ingest thất bại: ${(e as Error).message}`,
    );
  }
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
