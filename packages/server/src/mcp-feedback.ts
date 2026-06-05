/* ==========================================================
   mcp-feedback.ts — MCP server (JSON-RPC over HTTP) cho module Phản hồi.

   Mục tiêu: cho AI bên ngoài (vd Claude) KẾT NỐI + ĐỌC các phản hồi,
   xét trùng lặp, rồi GHI "đề xuất" (task fix / lộ trình nâng cấp / đổi
   trạng thái) ở dạng PENDING để admin PREVIEW & duyệt. AI KHÔNG mutate
   trực tiếp — không có tool apply (admin duyệt trong UI mới thực thi).

   Endpoint: POST /mcp   (JSON-RPC 2.0)
   Auth:     header X-API-Key (api_keys), scope:
     - feedback:read    → tool đọc
     - feedback:propose → tool tạo/sửa đề xuất (kèm quyền đọc)
     - "feedback:*" / "*" → toàn quyền feedback
   Deny-by-default: scope rỗng = không gì. Mọi truy vấn scope companyId.

   Methods: initialize, tools/list, tools/call, ping.
   ========================================================== */
import { aiProposals, feedbacks, roadmapItems } from "@erp-framework/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type ApiKeyContext, authApiKey } from "./api-key-auth";
import type { DB } from "./db";
import { embedTexts } from "./embeddings";
import { FEEDBACK_STATUSES, ZProposalActions } from "./feedback-proposals";

const SERVER_NAME = "erp-feedback";
const SERVER_VERSION = "1.0.0";
const PROTOCOL_VERSION = "2024-11-05";

/* ── Scope helper ───────────────────────────────────────────── */
export function hasFeedbackScope(scopes: string[], level: "read" | "propose"): boolean {
  if (scopes.includes("*") || scopes.includes("feedback:*")) return true;
  if (scopes.includes("feedback:propose")) return true; // propose ⊇ read
  if (level === "read") return scopes.includes("feedback:read");
  return false;
}

/* ── Lỗi tool có mã JSON-RPC ────────────────────────────────── */
class McpError extends Error {
  code: number;
  constructor(message: string, code = -32602) {
    super(message);
    this.code = code;
  }
}

/* ── Khai báo tool (inputSchema = JSON Schema rút gọn) ───────── */
interface ToolDef {
  name: string;
  description: string;
  level: "read" | "propose";
  inputSchema: Record<string, unknown>;
}

const AREA_ENUM = ["entity", "workflow", "agent", "settings", "ui", "performance", "other"];

const TOOLS: ToolDef[] = [
  {
    name: "feedback_list",
    description:
      "Liệt kê phản hồi/đề xuất của công ty (sort vote desc). Lọc theo status (new|in_progress|done|wontfix), area, mine. Trả id, title, area, severity, status, voteCount, aiSummary, aiTags.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...FEEDBACK_STATUSES] },
        area: { type: "string", enum: AREA_ENUM },
        limit: { type: "number", minimum: 1, maximum: 200 },
      },
    },
  },
  {
    name: "feedback_get",
    description: "Lấy chi tiết 1 phản hồi (kèm body, suggestion, resolutionNote, comments).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "UUID feedback" } },
      required: ["id"],
    },
  },
  {
    name: "feedback_find_similar",
    description:
      "Tìm phản hồi tương tự (cosine embedding) cho 1 feedback (truyền id) hoặc 1 đoạn text. Dùng để xét trùng lặp trước khi đề xuất gộp.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "UUID feedback gốc (ưu tiên)" },
        text: { type: "string", description: "Hoặc đoạn text để so khớp" },
        limit: { type: "number", minimum: 1, maximum: 20 },
      },
    },
  },
  {
    name: "feedback_cluster_duplicates",
    description:
      "Quét các phản hồi CHƯA xử lý (new+in_progress), gom cụm trùng/giống nhau theo embedding. Trả các cụm (>=2 mục) để đề xuất set trạng thái chung hoặc gộp vào lộ trình.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        threshold: {
          type: "number",
          minimum: 0.5,
          maximum: 0.99,
          description: "Ngưỡng cosine, mặc định 0.82",
        },
        max: {
          type: "number",
          minimum: 2,
          maximum: 300,
          description: "Số feedback quét tối đa, mặc định 150",
        },
      },
    },
  },
  {
    name: "roadmap_list",
    description:
      "Liệt kê các mục lộ trình nâng cấp / task-fix của công ty. Lọc theo status (planned|in_progress|done|dropped).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["planned", "in_progress", "done", "dropped"] },
      },
    },
  },
  {
    name: "proposal_list",
    description:
      "Liệt kê đề xuất AI đã tạo. Lọc theo status (pending|approved|rejected|applied|superseded).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "approved", "rejected", "applied", "superseded"],
        },
      },
    },
  },
  {
    name: "proposal_get",
    description: "Lấy chi tiết 1 đề xuất AI (title, summary, actions, status, review_note).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "proposal_create",
    description:
      "TẠO đề xuất ở trạng thái PENDING để admin preview & duyệt (KHÔNG thực thi ngay). summary = mô tả/markdown cho người đọc. actions = danh sách hành động: " +
      "set_status{feedbackIds,status,resolutionNote?} | mark_duplicate{primaryId,duplicateIds,status?,resolutionNote?} | " +
      "add_to_roadmap{feedbackIds?,roadmapId?,roadmap?{title,description?,area?,priority?,targetQuarter?},setStatus?}.",
    level: "propose",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 3, maxLength: 200 },
        summary: { type: "string", maxLength: 20000 },
        feedbackIds: { type: "array", items: { type: "string" } },
        actions: { type: "array", description: "ProposalAction[] (xem mô tả)" },
      },
      required: ["title", "actions"],
    },
  },
  {
    name: "proposal_update",
    description:
      "Sửa 1 đề xuất CÒN pending (refine trước khi admin duyệt). Chỉ tác giả/AI sửa được khi chưa duyệt.",
    level: "propose",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string", minLength: 3, maxLength: 200 },
        summary: { type: "string", maxLength: 20000 },
        feedbackIds: { type: "array", items: { type: "string" } },
        actions: { type: "array" },
      },
      required: ["id"],
    },
  },
  {
    name: "proposal_withdraw",
    description: "Rút 1 đề xuất còn pending (đánh dấu superseded) — vd khi đã có đề xuất tốt hơn.",
    level: "propose",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/* ── Tiện ích ───────────────────────────────────────────────── */
function asObj(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Vector pgvector có thể về dạng number[] hoặc chuỗi "[...]". Chuẩn hoá. */
export function parseVec(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") {
    try {
      const arr = JSON.parse(v);
      return Array.isArray(arr) ? (arr as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/* ── Cosine-similar query (dùng cho find_similar) ───────────── */
async function similarByVector(
  db: DB,
  companyId: string,
  vec: number[],
  excludeId: string | null,
  limit: number,
): Promise<Array<{ id: string; title: string; status: string; similarity: number }>> {
  const vecLit = sql`${"[" + vec.join(",") + "]"}::vector`;
  const rows = await db.execute<{
    id: string;
    title: string;
    status: string;
    similarity: number;
  }>(sql`
    SELECT id, title, status, 1 - (embedding <=> ${vecLit}) AS similarity
    FROM feedbacks
    WHERE company_id = ${companyId}
      AND deleted_at IS NULL
      AND embedding IS NOT NULL
      ${excludeId ? sql`AND id <> ${excludeId}` : sql``}
    ORDER BY embedding <=> ${vecLit}
    LIMIT ${limit}
  `);
  const list = Array.isArray(rows) ? rows : ((rows as unknown as { rows: unknown[] }).rows ?? []);
  return (list as Array<{ id: string; title: string; status: string; similarity: number }>).filter(
    (r) => r.similarity > 0.6,
  );
}

/* ── Dispatch 1 tool → dữ liệu thuần (testable) ─────────────── */
export async function callFeedbackTool(
  db: DB,
  ctx: ApiKeyContext,
  name: string,
  rawArgs: unknown,
): Promise<unknown> {
  const def = TOOL_MAP.get(name);
  if (!def) throw new McpError(`Tool không tồn tại: ${name}`, -32601);
  if (!hasFeedbackScope(ctx.scopes, def.level)) {
    throw new McpError(`Thiếu scope feedback:${def.level} cho tool ${name}`, -32001);
  }
  const args = asObj(rawArgs);
  const companyId = ctx.companyId;

  switch (name) {
    case "feedback_list": {
      const status = args.status as string | undefined;
      const area = args.area as string | undefined;
      const limit = Math.min(Number(args.limit ?? 100) || 100, 200);
      const conds = [eq(feedbacks.companyId, companyId), isNull(feedbacks.deletedAt)];
      if (status) conds.push(eq(feedbacks.status, status as (typeof FEEDBACK_STATUSES)[number]));
      if (area) conds.push(eq(feedbacks.area, area));
      const rows = await db
        .select({
          id: feedbacks.id,
          title: feedbacks.title,
          area: feedbacks.area,
          severity: feedbacks.severity,
          status: feedbacks.status,
          voteCount: feedbacks.voteCount,
          aiSummary: feedbacks.aiSummary,
          aiTags: feedbacks.aiTags,
          createdAt: feedbacks.createdAt,
        })
        .from(feedbacks)
        .where(and(...conds))
        .orderBy(desc(feedbacks.voteCount), desc(feedbacks.createdAt))
        .limit(limit);
      return { count: rows.length, items: rows };
    }

    case "feedback_get": {
      const id = z.string().uuid().parse(args.id);
      const [row] = await db
        .select()
        .from(feedbacks)
        .where(
          and(
            eq(feedbacks.id, id),
            eq(feedbacks.companyId, companyId),
            isNull(feedbacks.deletedAt),
          ),
        );
      if (!row) throw new McpError("Feedback không tồn tại", -32004);
      const { embedding: _omit, ...safe } = row;
      void _omit;
      return safe;
    }

    case "feedback_find_similar": {
      const limit = Math.min(Number(args.limit ?? 5) || 5, 20);
      const id = args.id ? z.string().uuid().parse(args.id) : null;
      let vec: number[] | null = null;
      if (id) {
        const [row] = await db
          .select({ embedding: feedbacks.embedding })
          .from(feedbacks)
          .where(and(eq(feedbacks.id, id), eq(feedbacks.companyId, companyId)));
        if (!row) throw new McpError("Feedback không tồn tại", -32004);
        vec = parseVec(row.embedding);
        if (!vec)
          throw new McpError("Feedback chưa có embedding (chờ enrich) — dùng text thay thế");
      } else {
        const text = z.string().min(3).parse(args.text);
        const r = await embedTexts(db, companyId, [text]);
        vec = r[0] ?? null;
        if (!vec) throw new McpError("Không tạo được embedding — kiểm tra cấu hình LLM", -32603);
      }
      const hits = await similarByVector(db, companyId, vec, id, limit);
      return { count: hits.length, hits };
    }

    case "feedback_cluster_duplicates": {
      const threshold = Math.min(Math.max(Number(args.threshold ?? 0.82) || 0.82, 0.5), 0.99);
      const max = Math.min(Math.max(Number(args.max ?? 150) || 150, 2), 300);
      const rows = await db
        .select({
          id: feedbacks.id,
          title: feedbacks.title,
          status: feedbacks.status,
          embedding: feedbacks.embedding,
        })
        .from(feedbacks)
        .where(
          and(
            eq(feedbacks.companyId, companyId),
            isNull(feedbacks.deletedAt),
            inArray(feedbacks.status, ["new", "in_progress"]),
            sql`${feedbacks.embedding} IS NOT NULL`,
          ),
        )
        .orderBy(desc(feedbacks.createdAt))
        .limit(max);
      interface ClusterItem {
        id: string;
        title: string;
        status: string;
        vec: number[];
      }
      const items: ClusterItem[] = [];
      for (const r of rows) {
        const vec = parseVec(r.embedding);
        if (vec) items.push({ id: r.id, title: r.title, status: r.status as string, vec });
      }
      // Gom cụm tham lam: mỗi mục chưa gán → seed, hút các mục >= threshold.
      const assigned = new Set<string>();
      const clusters: Array<{ members: Array<{ id: string; title: string; status: string }> }> = [];
      for (let i = 0; i < items.length; i++) {
        const seed = items[i];
        if (!seed || assigned.has(seed.id)) continue;
        const members = [{ id: seed.id, title: seed.title, status: seed.status }];
        assigned.add(seed.id);
        for (let j = i + 1; j < items.length; j++) {
          const other = items[j];
          if (!other || assigned.has(other.id)) continue;
          if (cosine(seed.vec, other.vec) >= threshold) {
            members.push({ id: other.id, title: other.title, status: other.status });
            assigned.add(other.id);
          }
        }
        if (members.length >= 2) clusters.push({ members });
      }
      return { scanned: items.length, threshold, clusterCount: clusters.length, clusters };
    }

    case "roadmap_list": {
      const status = args.status as string | undefined;
      const conds = [eq(roadmapItems.companyId, companyId)];
      if (status) conds.push(eq(roadmapItems.status, status));
      const rows = await db
        .select()
        .from(roadmapItems)
        .where(and(...conds))
        .orderBy(desc(roadmapItems.createdAt))
        .limit(200);
      return { count: rows.length, items: rows };
    }

    case "proposal_list": {
      const status = args.status as string | undefined;
      const conds = [eq(aiProposals.companyId, companyId)];
      if (status) conds.push(eq(aiProposals.status, status));
      const rows = await db
        .select({
          id: aiProposals.id,
          title: aiProposals.title,
          status: aiProposals.status,
          createdByKind: aiProposals.createdByKind,
          createdAt: aiProposals.createdAt,
          reviewedAt: aiProposals.reviewedAt,
        })
        .from(aiProposals)
        .where(and(...conds))
        .orderBy(desc(aiProposals.createdAt))
        .limit(200);
      return { count: rows.length, items: rows };
    }

    case "proposal_get": {
      const id = z.string().uuid().parse(args.id);
      const [row] = await db
        .select()
        .from(aiProposals)
        .where(and(eq(aiProposals.id, id), eq(aiProposals.companyId, companyId)));
      if (!row) throw new McpError("Đề xuất không tồn tại", -32004);
      return row;
    }

    case "proposal_create": {
      const title = z.string().min(3).max(200).parse(args.title);
      const summary = args.summary ? z.string().max(20000).parse(args.summary) : null;
      const actions = ZProposalActions.parse(args.actions);
      const explicit = z.array(z.string().uuid()).max(500).optional().parse(args.feedbackIds);
      const feedbackIds = explicit?.length ? explicit : deriveFeedbackIds(actions);
      const [row] = await db
        .insert(aiProposals)
        .values({
          companyId,
          title: title.trim(),
          summary,
          actions,
          feedbackIds,
          status: "pending",
          createdByKind: "ai",
          apiKeyId: ctx.id,
        })
        .returning({ id: aiProposals.id, status: aiProposals.status });
      return {
        id: row?.id,
        status: row?.status,
        message: "Đã tạo đề xuất pending, chờ admin duyệt.",
      };
    }

    case "proposal_update": {
      const id = z.string().uuid().parse(args.id);
      const [row] = await db
        .select({ id: aiProposals.id, status: aiProposals.status, apiKeyId: aiProposals.apiKeyId })
        .from(aiProposals)
        .where(and(eq(aiProposals.id, id), eq(aiProposals.companyId, companyId)));
      if (!row) throw new McpError("Đề xuất không tồn tại", -32004);
      if (row.status !== "pending") {
        throw new McpError(`Chỉ sửa được đề xuất pending (hiện ${row.status})`, -32002);
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (args.title !== undefined)
        patch.title = z.string().min(3).max(200).parse(args.title).trim();
      if (args.summary !== undefined) patch.summary = z.string().max(20000).parse(args.summary);
      if (args.actions !== undefined) patch.actions = ZProposalActions.parse(args.actions);
      if (args.feedbackIds !== undefined) {
        patch.feedbackIds = z.array(z.string().uuid()).max(500).parse(args.feedbackIds);
      }
      await db.update(aiProposals).set(patch).where(eq(aiProposals.id, id));
      return { ok: true };
    }

    case "proposal_withdraw": {
      const id = z.string().uuid().parse(args.id);
      const res = await db
        .update(aiProposals)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(
          and(
            eq(aiProposals.id, id),
            eq(aiProposals.companyId, companyId),
            eq(aiProposals.status, "pending"),
          ),
        )
        .returning({ id: aiProposals.id });
      if (res.length === 0) {
        throw new McpError("Không tìm thấy đề xuất pending để rút", -32004);
      }
      return { ok: true };
    }

    default:
      throw new McpError(`Tool chưa cài đặt: ${name}`, -32601);
  }
}

/** Gom tập feedbackId xuất hiện trong actions (khi caller không truyền). */
function deriveFeedbackIds(actions: z.infer<typeof ZProposalActions>): string[] {
  const set = new Set<string>();
  for (const a of actions) {
    if (a.type === "set_status") for (const id of a.feedbackIds) set.add(id);
    else if (a.type === "mark_duplicate") {
      set.add(a.primaryId);
      for (const id of a.duplicateIds) set.add(id);
    } else for (const id of a.feedbackIds ?? []) set.add(id);
  }
  return [...set];
}

/* ── JSON-RPC handler ───────────────────────────────────────── */
interface JsonRpcReq {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export function registerFeedbackMcp(app: FastifyInstance, db: DB): void {
  app.post("/mcp", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    if (!hasFeedbackScope(auth.scopes, "read")) {
      return reply.code(403).send({ error: "Thiếu scope feedback:read|propose" });
    }

    const body = (req.body ?? {}) as JsonRpcReq;
    const id = body.id ?? null;
    const method = body.method;

    const ok = (result: unknown) => reply.send({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string) =>
      reply.send({ jsonrpc: "2.0", id, error: { code, message } });

    try {
      switch (method) {
        case "initialize":
          return ok({
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          });
        case "notifications/initialized":
          // Notification — không có id, không trả body.
          return reply.code(204).send();
        case "ping":
          return ok({});
        case "tools/list":
          return ok({
            tools: TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          });
        case "tools/call": {
          const p = asObj(body.params);
          const name = String(p.name ?? "");
          const data = await callFeedbackTool(db, auth, name, p.arguments);
          // MCP chuẩn: content array. Nhúng JSON để client/LLM đọc.
          return ok({
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          });
        }
        default:
          return fail(-32601, `Method không hỗ trợ: ${method ?? "?"}`);
      }
    } catch (e) {
      if (e instanceof McpError) return fail(e.code, e.message);
      if (e instanceof z.ZodError) {
        return fail(-32602, `Tham số sai: ${e.issues.map((i) => i.message).join("; ")}`);
      }
      console.error("[mcp/feedback] lỗi:", e);
      return fail(-32603, (e as Error).message || "Lỗi nội bộ");
    }
  });
}
