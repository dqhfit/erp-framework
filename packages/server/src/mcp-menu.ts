/* ==========================================================
   mcp-menu.ts — MCP server quan ly legacy_menu_map qua API.
   Scope: menu:read (doc) | menu:write (doc + ghi)
   Endpoint: POST /mcp/menu
   Tools:
     menu_list           — liet ke cay menu (flat)
     menu_node_get       — lay 1 node theo sourceCode
     menu_node_add       — them node tuy chinh (folder | item)
     menu_node_set_page  — gan / go trang cho node
     menu_node_rename    — doi ten node
     menu_node_set_active — an / hien node
     menu_node_move      — chuyen node sang cha khac
     menu_node_delete    — xoa node custom
   ========================================================== */

import { randomUUID } from "node:crypto";
import { legacyMenuMap, pages } from "@erp-framework/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { authApiKey } from "./api-key-auth";
import type { DB } from "./db";

// ── Scope helpers ────────────────────────────────────────────────────────────

export function hasMenuScope(scopes: string[], level: "read" | "write" = "read"): boolean {
  if (scopes.includes("*") || scopes.includes("menu:*")) return true;
  if (level === "write") return scopes.includes("menu:write");
  return scopes.includes("menu:read") || scopes.includes("menu:write");
}

class McpError extends Error {
  code: number;
  constructor(msg: string, code = -32602) {
    super(msg);
    this.code = code;
  }
}

// ── Internal helpers (mirror legacy-menu-router.ts) ──────────────────────────

type StructRow = {
  sourceCode: string;
  parentCode: string | null;
  level: number | null;
  sort: number;
  custom: boolean;
  name: string | null;
};

async function loadStructure(db: DB, companyId: string): Promise<StructRow[]> {
  return db
    .select({
      sourceCode: legacyMenuMap.sourceCode,
      parentCode: legacyMenuMap.parentCode,
      level: legacyMenuMap.level,
      sort: legacyMenuMap.sort,
      custom: legacyMenuMap.custom,
      name: legacyMenuMap.name,
    })
    .from(legacyMenuMap)
    .where(eq(legacyMenuMap.companyId, companyId));
}

function descendantsOf(all: StructRow[], code: string): Set<string> {
  const byParent = new Map<string | null, string[]>();
  for (const r of all) {
    const list = byParent.get(r.parentCode) ?? [];
    list.push(r.sourceCode);
    byParent.set(r.parentCode, list);
  }
  const out = new Set<string>([code]);
  const stack = [code];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === undefined) break;
    for (const child of byParent.get(cur) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

function nextSortInGroup(all: StructRow[], parentCode: string | null): number {
  const sibs = all.filter((r) => r.parentCode === parentCode);
  return sibs.length ? Math.max(...sibs.map((s) => s.sort)) + 10 : 0;
}

function mergeOvSql(patch: Record<string, unknown>) {
  return sql`coalesce(${legacyMenuMap.overrides}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`;
}

// ── Tool definitions ─────────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  level: "read" | "write";
  inputSchema: Record<string, unknown>;
}

const TOOLS: ToolDef[] = [
  {
    name: "menu_list",
    description:
      "Liet ke toan bo node cay menu legacy (flat). " +
      "Tra ve sourceCode, name, level, parentCode, sort, pageId (uuid trang da gan), pageName, active, custom. " +
      "Loc theo parentCode hoac chi hien node co trang (hasPage=true).",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        parentCode: {
          type: "string",
          description: "Chi lay con truc tiep cua node nay (1 cap). Bo trong = tat ca.",
        },
        hasPage: {
          type: "boolean",
          description: "true = chi tra node da co trang gan; false = chi tra node chua co trang.",
        },
        activeOnly: {
          type: "boolean",
          description: "true (mac dinh) = bo node dang an; false = tra ca node an.",
        },
        search: {
          type: "string",
          description: "Tim kiem khong phan biet hoa thuong trong ten hoac sourceCode.",
        },
      },
    },
  },
  {
    name: "menu_node_get",
    description:
      "Lay chi tiet 1 node menu theo sourceCode. Tra ve cac truong day du: " +
      "sourceCode, name, level, parentCode, sort, pageId, pageName, active, custom, overrides, winId.",
    level: "read",
    inputSchema: {
      type: "object",
      properties: {
        sourceCode: {
          type: "string",
          description: "sourceCode cua node (vi du: G1004, I1274, CUST-LCP-NKI).",
        },
      },
      required: ["sourceCode"],
    },
  },
  {
    name: "menu_node_add",
    description:
      "Them 1 node menu tuy chinh (custom=true) duoi node cha. " +
      "kind='folder' = thu muc (chua menu con, KHONG gan trang truc tiep). " +
      "kind='item' (mac dinh) = muc thuong, gan trang duoc. " +
      "Tuy chon: truyen pageName de gan trang ngay khi tao. " +
      "Tra ve sourceCode tu dong sinh (CUST-xxx) va pageId neu da gan.",
    level: "write",
    inputSchema: {
      type: "object",
      properties: {
        parentCode: {
          type: ["string", "null"],
          description: "sourceCode cua node cha. null = them vao goc.",
        },
        name: {
          type: "string",
          description: "Ten hien thi (co the co tieng Viet).",
          minLength: 1,
          maxLength: 200,
        },
        kind: {
          type: "string",
          enum: ["folder", "item"],
          description: "folder = thu muc; item = muc gan trang (mac dinh).",
        },
        pageName: {
          type: "string",
          description:
            "Ten may (pages.name) de gan trang ngay sau khi tao node. Chi dung khi kind='item'.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "menu_node_set_page",
    description:
      "Gan hoac go trang cho 1 node menu. " +
      "Truyen pageName (ten may) hoac pageId (uuid) de gan; bo ca hai de go. " +
      "KHONG gan duoc trang vao thu muc (node co con hoac kind=folder). " +
      "Tu dong publish trang con nhap khi gan vao menu.",
    level: "write",
    inputSchema: {
      type: "object",
      properties: {
        sourceCode: { type: "string", description: "sourceCode cua node menu." },
        pageName: { type: "string", description: "Ten may trang (pages.name). Bo de go lien ket." },
        pageId: {
          type: "string",
          description: "UUID trang. Uu tien hon pageName neu truyen ca hai.",
        },
      },
      required: ["sourceCode"],
    },
  },
  {
    name: "menu_node_rename",
    description:
      "Doi ten hien thi cua 1 node menu. Ten duoc luu vao ca cot name lan overrides.name (song sot re-import DQHF).",
    level: "write",
    inputSchema: {
      type: "object",
      properties: {
        sourceCode: { type: "string", description: "sourceCode cua node." },
        name: {
          type: "string",
          description: "Ten moi (co the co tieng Viet).",
          minLength: 1,
          maxLength: 200,
        },
      },
      required: ["sourceCode", "name"],
    },
  },
  {
    name: "menu_node_set_active",
    description:
      "An (active=false) hoac hien lai (active=true) 1 node menu. " +
      "Node an bien mat khoi sidebar cua moi nguoi dung nhung admin/editor van thay duoc. " +
      "Dung cho node DQHF goc (KHONG xoa — xoa dung menu_node_delete cho node custom).",
    level: "write",
    inputSchema: {
      type: "object",
      properties: {
        sourceCode: { type: "string", description: "sourceCode cua node." },
        active: { type: "boolean", description: "true = hien; false = an." },
      },
      required: ["sourceCode", "active"],
    },
  },
  {
    name: "menu_node_move",
    description:
      "Chuyen 1 node sang node cha khac (hoac ra goc). " +
      "Phat hien va chan chuyen vong (node vao nhanh con cua chinh no). " +
      "Sort tu dong dat cuoi nhom moi.",
    level: "write",
    inputSchema: {
      type: "object",
      properties: {
        sourceCode: { type: "string", description: "sourceCode cua node can chuyen." },
        parentCode: {
          type: ["string", "null"],
          description: "sourceCode cua node cha moi. null = chuyen ra goc.",
        },
      },
      required: ["sourceCode"],
    },
  },
  {
    name: "menu_node_delete",
    description:
      "Xoa 1 node menu TUY CHINH (custom=true). " +
      "Khong xoa duoc node DQHF goc — dung menu_node_set_active de an thay. " +
      "Khong xoa duoc node con con — phai chuyen/xoa con truoc.",
    level: "write",
    inputSchema: {
      type: "object",
      properties: {
        sourceCode: {
          type: "string",
          description: "sourceCode cua node can xoa (phai la custom=true).",
        },
      },
      required: ["sourceCode"],
    },
  },
];

// ── Tool handler ─────────────────────────────────────────────────────────────

async function callMenuTool(
  db: DB,
  companyId: string,
  scopes: string[],
  name: string,
  rawArgs: unknown,
): Promise<unknown> {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const def = TOOLS.find((t) => t.name === name);
  if (!def) throw new McpError(`Tool khong ton tai: ${name}`, -32601);
  if (def.level === "write" && !hasMenuScope(scopes, "write")) {
    throw new McpError("Thieu scope menu:write cho tool ghi.", -32602);
  }

  switch (name) {
    // ── READ ──────────────────────────────────────────────────────────────────
    case "menu_list": {
      const filterParent = args.parentCode != null ? String(args.parentCode) : null;
      const filterHasPage = args.hasPage as boolean | undefined;
      const activeOnly = args.activeOnly !== false; // mac dinh true
      const search = args.search ? String(args.search).toLowerCase() : null;

      const rows = await db
        .select({
          sourceCode: legacyMenuMap.sourceCode,
          name: legacyMenuMap.name,
          level: legacyMenuMap.level,
          parentCode: legacyMenuMap.parentCode,
          sort: legacyMenuMap.sort,
          active: legacyMenuMap.active,
          custom: legacyMenuMap.custom,
          overrides: legacyMenuMap.overrides,
          winId: legacyMenuMap.winId,
          pageId: legacyMenuMap.pageId,
          pageName: pages.name,
          pagePublished: pages.published,
        })
        .from(legacyMenuMap)
        .leftJoin(pages, and(eq(legacyMenuMap.pageId, pages.id), isNull(pages.deletedAt)))
        .where(
          and(
            eq(legacyMenuMap.companyId, companyId),
            activeOnly ? eq(legacyMenuMap.active, true) : undefined,
          ),
        );

      return rows
        .filter((r) => {
          if (filterParent !== null && r.parentCode !== filterParent) return false;
          if (filterHasPage === true && !r.pageId) return false;
          if (filterHasPage === false && r.pageId) return false;
          if (search) {
            const haystack = `${r.sourceCode} ${r.name ?? ""}`.toLowerCase();
            if (!haystack.includes(search)) return false;
          }
          return true;
        })
        .sort(
          (a, b) =>
            (a.sort ?? 0) - (b.sort ?? 0) || (a.name ?? "").localeCompare(b.name ?? "", "vi"),
        )
        .map((r) => ({
          sourceCode: r.sourceCode,
          name: r.name,
          level: r.level,
          parentCode: r.parentCode,
          sort: r.sort,
          active: r.active,
          custom: r.custom,
          winId: r.winId ?? null,
          pageId: r.pageId ?? null,
          pageName: r.pageName ?? null,
          pagePublished: r.pagePublished ?? null,
        }));
    }

    case "menu_node_get": {
      const sourceCode = String(args.sourceCode ?? "");
      if (!sourceCode) throw new McpError("sourceCode bat buoc.");
      const [row] = await db
        .select({
          sourceCode: legacyMenuMap.sourceCode,
          name: legacyMenuMap.name,
          level: legacyMenuMap.level,
          parentCode: legacyMenuMap.parentCode,
          sort: legacyMenuMap.sort,
          active: legacyMenuMap.active,
          custom: legacyMenuMap.custom,
          overrides: legacyMenuMap.overrides,
          winId: legacyMenuMap.winId,
          portStatus: legacyMenuMap.portStatus,
          pageId: legacyMenuMap.pageId,
          pageName: pages.name,
          pagePublished: pages.published,
        })
        .from(legacyMenuMap)
        .leftJoin(pages, and(eq(legacyMenuMap.pageId, pages.id), isNull(pages.deletedAt)))
        .where(
          and(eq(legacyMenuMap.companyId, companyId), eq(legacyMenuMap.sourceCode, sourceCode)),
        )
        .limit(1);
      if (!row) throw new McpError(`Node menu khong ton tai: ${sourceCode}`, -32004);
      return {
        sourceCode: row.sourceCode,
        name: row.name,
        level: row.level,
        parentCode: row.parentCode,
        sort: row.sort,
        active: row.active,
        custom: row.custom,
        overrides: row.overrides,
        winId: row.winId ?? null,
        portStatus: row.portStatus,
        pageId: row.pageId ?? null,
        pageName: row.pageName ?? null,
        pagePublished: row.pagePublished ?? null,
      };
    }

    // ── WRITE ─────────────────────────────────────────────────────────────────
    case "menu_node_add": {
      const nodeName = String(args.name ?? "").trim();
      if (!nodeName) throw new McpError("name bat buoc.");
      if (nodeName.length > 200) throw new McpError("name toi da 200 ky tu.");
      const kind = (args.kind as string | undefined) ?? "item";
      if (kind !== "folder" && kind !== "item")
        throw new McpError("kind phai la 'folder' hoac 'item'.");
      const parentCode = args.parentCode != null ? String(args.parentCode) : null;

      const all = await loadStructure(db, companyId);
      if (parentCode !== null && !all.find((n) => n.sourceCode === parentCode)) {
        throw new McpError(`Node cha khong ton tai: ${parentCode}`, -32004);
      }
      const parentNode = parentCode ? all.find((n) => n.sourceCode === parentCode) : null;
      const level = parentNode ? (parentNode.level ?? 0) + 1 : 1;
      const sort = nextSortInGroup(all, parentCode);
      const sourceCode = `CUST-${randomUUID().toUpperCase().slice(0, 12)}`;

      await db.insert(legacyMenuMap).values({
        companyId,
        sourceId: 0,
        sourceCode,
        name: nodeName,
        level,
        parentCode,
        sort,
        custom: true,
        active: true,
        portStatus: "chua",
        overrides: kind === "folder" ? { kind: "folder" } : null,
      });

      // Gan trang ngay neu co pageName va kind=item
      let linkedPageId: string | null = null;
      if (kind === "item" && args.pageName) {
        const pageName = String(args.pageName);
        const [pg] = await db
          .select({ id: pages.id, published: pages.published })
          .from(pages)
          .where(
            and(eq(pages.companyId, companyId), eq(pages.name, pageName), isNull(pages.deletedAt)),
          )
          .limit(1);
        if (pg) {
          if (!pg.published) {
            await db
              .update(pages)
              .set({ published: true, publishMode: "private", updatedAt: new Date() })
              .where(and(eq(pages.id, pg.id), eq(pages.companyId, companyId)));
          }
          await db
            .update(legacyMenuMap)
            .set({ pageId: pg.id, portStatus: "xong", updatedAt: new Date() })
            .where(
              and(eq(legacyMenuMap.companyId, companyId), eq(legacyMenuMap.sourceCode, sourceCode)),
            );
          linkedPageId = pg.id;
        } else {
          // Tra ve canh bao nhung khong fail
          return {
            ok: true,
            sourceCode,
            level,
            sort,
            pageId: null,
            warning: `Trang '${pageName}' khong tim thay — node da tao nhung chua gan trang.`,
          };
        }
      }
      return { ok: true, sourceCode, level, sort, pageId: linkedPageId };
    }

    case "menu_node_set_page": {
      const sourceCode = String(args.sourceCode ?? "");
      if (!sourceCode) throw new McpError("sourceCode bat buoc.");

      // Xac dinh pageId can gan
      let targetPageId: string | null = null;
      let autoPublished = false;
      if (args.pageId || args.pageName) {
        const lookup = args.pageId
          ? db
              .select({ id: pages.id, published: pages.published })
              .from(pages)
              .where(
                and(
                  eq(pages.id, String(args.pageId)),
                  eq(pages.companyId, companyId),
                  isNull(pages.deletedAt),
                ),
              )
              .limit(1)
          : db
              .select({ id: pages.id, published: pages.published })
              .from(pages)
              .where(
                and(
                  eq(pages.name, String(args.pageName)),
                  eq(pages.companyId, companyId),
                  isNull(pages.deletedAt),
                ),
              )
              .limit(1);
        const [pg] = await lookup;
        if (!pg) throw new McpError(`Trang khong ton tai: ${args.pageId ?? args.pageName}`, -32004);
        if (!pg.published) {
          await db
            .update(pages)
            .set({ published: true, publishMode: "private", updatedAt: new Date() })
            .where(and(eq(pages.id, pg.id), eq(pages.companyId, companyId)));
          autoPublished = true;
        }
        targetPageId = pg.id;
      }

      // Kiem tra node ton tai va khong phai thu muc
      const [target] = await db
        .select({
          id: legacyMenuMap.id,
          overrides: legacyMenuMap.overrides,
          pageId: legacyMenuMap.pageId,
        })
        .from(legacyMenuMap)
        .where(
          and(eq(legacyMenuMap.companyId, companyId), eq(legacyMenuMap.sourceCode, sourceCode)),
        )
        .limit(1);
      if (!target) throw new McpError(`Node menu khong ton tai: ${sourceCode}`, -32004);

      if (targetPageId) {
        const markedFolder = (target.overrides as { kind?: unknown } | null)?.kind === "folder";
        const [child] = await db
          .select({ id: legacyMenuMap.id })
          .from(legacyMenuMap)
          .where(
            and(eq(legacyMenuMap.companyId, companyId), eq(legacyMenuMap.parentCode, sourceCode)),
          )
          .limit(1);
        if (markedFolder || child) {
          throw new McpError(
            "Khong gan trang vao thu muc. Them trang lam muc con ben trong thu muc.",
          );
        }
      }

      await db
        .update(legacyMenuMap)
        .set({
          pageId: targetPageId,
          ...(targetPageId ? { portStatus: "xong" } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(legacyMenuMap.companyId, companyId), eq(legacyMenuMap.sourceCode, sourceCode)),
        );

      return { ok: true, pageId: targetPageId, autoPublished };
    }

    case "menu_node_rename": {
      const sourceCode = String(args.sourceCode ?? "");
      const newName = String(args.name ?? "").trim();
      if (!sourceCode) throw new McpError("sourceCode bat buoc.");
      if (!newName) throw new McpError("name bat buoc.");
      if (newName.length > 200) throw new McpError("name toi da 200 ky tu.");
      const [row] = await db
        .update(legacyMenuMap)
        .set({ name: newName, overrides: mergeOvSql({ name: newName }), updatedAt: new Date() })
        .where(
          and(eq(legacyMenuMap.companyId, companyId), eq(legacyMenuMap.sourceCode, sourceCode)),
        )
        .returning({ id: legacyMenuMap.id });
      if (!row) throw new McpError(`Node menu khong ton tai: ${sourceCode}`, -32004);
      return { ok: true };
    }

    case "menu_node_set_active": {
      const sourceCode = String(args.sourceCode ?? "");
      const active = args.active === true || args.active === "true";
      if (!sourceCode) throw new McpError("sourceCode bat buoc.");
      const [row] = await db
        .update(legacyMenuMap)
        .set({ active, overrides: mergeOvSql({ active }), updatedAt: new Date() })
        .where(
          and(eq(legacyMenuMap.companyId, companyId), eq(legacyMenuMap.sourceCode, sourceCode)),
        )
        .returning({ id: legacyMenuMap.id });
      if (!row) throw new McpError(`Node menu khong ton tai: ${sourceCode}`, -32004);
      return { ok: true, active };
    }

    case "menu_node_move": {
      const sourceCode = String(args.sourceCode ?? "");
      if (!sourceCode) throw new McpError("sourceCode bat buoc.");
      const newParent = args.parentCode != null ? String(args.parentCode) : null;
      if (newParent === sourceCode) throw new McpError("Khong the dat node lam cha cua chinh no.");

      const all = await loadStructure(db, companyId);
      if (!all.find((n) => n.sourceCode === sourceCode)) {
        throw new McpError(`Node khong ton tai: ${sourceCode}`, -32004);
      }
      if (newParent !== null) {
        if (!all.find((n) => n.sourceCode === newParent)) {
          throw new McpError(`Node cha dich khong ton tai: ${newParent}`, -32004);
        }
        if (descendantsOf(all, sourceCode).has(newParent)) {
          throw new McpError("Khong the chuyen vao nhanh con cua chinh no (gay vong).");
        }
      }
      const parentNode = newParent ? all.find((n) => n.sourceCode === newParent) : null;
      const newLevel = parentNode ? (parentNode.level ?? 0) + 1 : 1;
      const newSort = nextSortInGroup(all, newParent);
      await db
        .update(legacyMenuMap)
        .set({
          parentCode: newParent,
          level: newLevel,
          sort: newSort,
          overrides: mergeOvSql({ parentCode: newParent, level: newLevel, sort: newSort }),
          updatedAt: new Date(),
        })
        .where(
          and(eq(legacyMenuMap.companyId, companyId), eq(legacyMenuMap.sourceCode, sourceCode)),
        );
      return { ok: true, newParent, newLevel, newSort };
    }

    case "menu_node_delete": {
      const sourceCode = String(args.sourceCode ?? "");
      if (!sourceCode) throw new McpError("sourceCode bat buoc.");
      const all = await loadStructure(db, companyId);
      const node = all.find((n) => n.sourceCode === sourceCode);
      if (!node) throw new McpError(`Node khong ton tai: ${sourceCode}`, -32004);
      if (!node.custom) {
        throw new McpError(
          "Chi xoa duoc node tu them (custom=true). Dung menu_node_set_active de an node DQHF goc.",
        );
      }
      if (all.some((n) => n.parentCode === sourceCode)) {
        throw new McpError("Node con co con — chuyen hoac xoa con truoc.");
      }
      await db
        .delete(legacyMenuMap)
        .where(
          and(eq(legacyMenuMap.companyId, companyId), eq(legacyMenuMap.sourceCode, sourceCode)),
        );
      return { ok: true, deleted: sourceCode };
    }

    default:
      throw new McpError(`Tool chua implement: ${name}`, -32601);
  }
}

// ── HTTP endpoint ─────────────────────────────────────────────────────────────

interface JsonRpcReq {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function registerMenuMcp(app: FastifyInstance, db: DB): void {
  app.post("/mcp/menu", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    if (!hasMenuScope(auth.scopes)) {
      return reply.code(403).send({ error: "Thieu scope menu:read" });
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
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "erp-menu", version: "1.0.0" },
          });
        case "tools/list":
          return ok({
            tools: TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: { type: "object", ...t.inputSchema },
            })),
          });
        case "tools/call": {
          const p = asObj(body.params);
          const toolName = String(p.name ?? "");
          const data = await callMenuTool(db, auth.companyId, auth.scopes, toolName, p.arguments);
          return ok({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
        }
        case "ping":
          return ok({ pong: true });
        case "notifications/initialized":
          return reply.code(204).send();
        default:
          return fail(-32601, `Method khong ho tro: ${method ?? "?"}`);
      }
    } catch (e) {
      if (e instanceof McpError) return fail(e.code, e.message);
      console.error("[mcp/menu]", e);
      return fail(-32603, (e as Error).message || "Loi noi bo");
    }
  });
}
