/* ==========================================================
   graphql.ts — Endpoint /graphql với schema tự sinh từ entity meta.
   Auth qua X-API-Key (reuse rest-api auth pattern). Minimal v1:
     - Query: entities, entity(name), records(entityName, limit, offset).
     - Mutation: createRecord(entityName, data).
   Schema không generate dynamic Type per entity — trả Records[id, data
   JSON] thay vì typed fields. Caller parse data theo entity meta.

   v2 sẽ generate Type động (vd type Customer { name: String! email: String }
   từ entity.fields[]), nhưng cần restart server khi schema entity đổi.
   ========================================================== */
import type { FastifyInstance } from "fastify";
import { createSchema, createYoga } from "graphql-yoga";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { entities, entityRecords, apiKeys } from "@erp-framework/db";
import { validateRecord, type EntityFieldDef } from "@erp-framework/core";
import type { DB } from "./db";

const typeDefs = /* GraphQL */ `
  type Entity {
    id: String!
    name: String!
    label: String!
    fields: String!
  }
  type Record {
    id: String!
    entityId: String!
    data: String!
    version: Int!
    createdAt: String!
    updatedAt: String!
  }
  type RecordList {
    rows: [Record!]!
    total: Int!
  }
  type Query {
    entities: [Entity!]!
    entity(name: String!): Entity
    records(entityName: String!, limit: Int, offset: Int, q: String): RecordList!
  }
  type Mutation {
    createRecord(entityName: String!, data: String!): Record
  }
`;

interface YogaContext {
  db: DB;
  companyId: string | null;
}

const resolvers = {
  Query: {
    entities: async (_: unknown, __: unknown, ctx: YogaContext) => {
      if (!ctx.companyId) throw new Error("Unauthorized");
      const rows = await ctx.db.select().from(entities)
        .where(eq(entities.companyId, ctx.companyId));
      return rows.map((r) => ({
        id: r.id, name: r.name, label: r.label,
        fields: JSON.stringify(r.fields ?? []),
      }));
    },
    entity: async (_: unknown, args: { name: string }, ctx: YogaContext) => {
      if (!ctx.companyId) throw new Error("Unauthorized");
      const [r] = await ctx.db.select().from(entities).where(and(
        eq(entities.companyId, ctx.companyId),
        eq(entities.name, args.name),
      ));
      if (!r) return null;
      return { id: r.id, name: r.name, label: r.label,
        fields: JSON.stringify(r.fields ?? []) };
    },
    records: async (_: unknown, args: {
      entityName: string; limit?: number; offset?: number; q?: string;
    }, ctx: YogaContext) => {
      if (!ctx.companyId) throw new Error("Unauthorized");
      const [ent] = await ctx.db.select({ id: entities.id }).from(entities).where(and(
        eq(entities.companyId, ctx.companyId), eq(entities.name, args.entityName),
      ));
      if (!ent) return { rows: [], total: 0 };
      const conds = [
        eq(entityRecords.companyId, ctx.companyId),
        eq(entityRecords.entityId, ent.id),
        sql`${entityRecords.deletedAt} IS NULL`,
      ];
      if (args.q?.trim()) {
        conds.push(sql`${entityRecords.searchTsv}::tsvector @@ websearch_to_tsquery('simple', ${args.q.trim()})`);
      }
      const rows = await ctx.db.select().from(entityRecords).where(and(...conds))
        .limit(Math.min(args.limit ?? 100, 500))
        .offset(args.offset ?? 0);
      const [c] = await ctx.db.select({ count: sql<number>`count(*)::int` })
        .from(entityRecords).where(and(...conds));
      return {
        rows: rows.map((r) => ({
          id: r.id, entityId: r.entityId,
          data: JSON.stringify(r.data ?? {}),
          version: r.version,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
        total: c?.count ?? 0,
      };
    },
  },
  Mutation: {
    createRecord: async (_: unknown, args: { entityName: string; data: string },
      ctx: YogaContext) => {
      if (!ctx.companyId) throw new Error("Unauthorized");
      const [ent] = await ctx.db.select({ id: entities.id, fields: entities.fields })
        .from(entities).where(and(
          eq(entities.companyId, ctx.companyId), eq(entities.name, args.entityName),
        ));
      if (!ent) throw new Error(`Entity ${args.entityName} không tồn tại`);
      const parsed = JSON.parse(args.data) as Record<string, unknown>;
      const v = validateRecord((ent.fields ?? []) as EntityFieldDef[], parsed);
      if (!v.ok) throw new Error("Validation: "
        + v.errors.map((e) => `${e.field}: ${e.message}`).join("; "));
      const [row] = await ctx.db.insert(entityRecords).values({
        companyId: ctx.companyId, entityId: ent.id, data: v.data,
      }).returning();
      return row ? {
        id: row.id, entityId: row.entityId,
        data: JSON.stringify(row.data ?? {}),
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      } : null;
    },
  },
};

const schema = createSchema({ typeDefs, resolvers });

export function registerGraphQL(app: FastifyInstance, db: DB): void {
  const yoga = createYoga({
    schema,
    landingPage: false,
    context: async ({ request }: { request: Request }) => {
      // Auth — X-API-Key header (reuse rest-api auth pattern).
      const key = request.headers.get("x-api-key");
      if (!key || !key.startsWith("sk_")) return { db, companyId: null };
      const hash = createHash("sha256").update(key).digest("hex");
      const [row] = await db.select({ companyId: apiKeys.companyId, enabled: apiKeys.enabled })
        .from(apiKeys).where(eq(apiKeys.keyHash, hash));
      if (!row || !row.enabled) return { db, companyId: null };
      return { db, companyId: row.companyId };
    },
    graphqlEndpoint: "/graphql",
  });
  app.route({
    url: "/graphql",
    method: ["GET", "POST", "OPTIONS"],
    handler: async (req, reply) => {
      // Bridge Fastify req → Fetch Request → yoga.fetch → Fastify reply.
      const url = "http://localhost" + req.url;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers[k] = v;
      }
      const fetchReq = new Request(url, {
        method: req.method,
        headers,
        body: req.method !== "GET" && req.method !== "HEAD"
          ? JSON.stringify(req.body) : undefined,
      });
      const response = await yoga.fetch(fetchReq);
      reply.status(response.status);
      response.headers.forEach((v: string, k: string) => reply.header(k, v));
      reply.send(await response.text());
    },
  });
}
