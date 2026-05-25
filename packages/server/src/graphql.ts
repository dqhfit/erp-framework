/* ==========================================================
   graphql.ts — Endpoint /graphql với typed schema tự sinh per entity.
   Auth qua X-API-Key (reuse rest-api auth pattern).

   v5 typed:
     - Mỗi entity sinh GraphQL Type với field tương ứng (vd
       type Customer { name: String! email: String code_id: String }).
     - Query: <entity>(id) + <entity>List(limit, offset, q) cho mỗi entity.
     - Mutation: create<Entity>(input).
     - Field type mapping: text/textarea/email/url/phone → String;
       number/integer/currency → Float / Int; boolean → Boolean;
       date/datetime → String (ISO); enum/multi-enum → String / [String];
       lookup → ID; json/file/image → JSON scalar custom.

   Schema rebuild khi entity meta đổi: POST /graphql/refresh hoặc auto
   reload sau TTL 60s.
   ========================================================== */
import type { FastifyInstance } from "fastify";
import { createSchema, createYoga } from "graphql-yoga";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { entities, entityRecords, apiKeys } from "@erp-framework/db";
import { validateRecord, type EntityFieldDef } from "@erp-framework/core";
import type { DB } from "./db";

interface YogaContext {
  db: DB;
  companyId: string | null;
}

/** Map FieldType → GraphQL scalar. Default String. */
function fieldTypeToGraphQL(type: string, required: boolean): string {
  let base: string;
  switch (type) {
    case "number": case "currency": base = "Float"; break;
    case "integer": case "sequence": base = "Int"; break;
    case "boolean": base = "Boolean"; break;
    case "multienum": case "multiselect": case "multi-enum": case "multi-select":
    case "multilookup": case "multi-lookup":
      return required ? "[String!]!" : "[String!]";
    case "lookup": case "relation": base = "ID"; break;
    case "json": base = "JSON"; break;
    default: base = "String";
  }
  return required ? `${base}!` : base;
}

function pascalCase(s: string): string {
  return s.split(/[_-]/).filter(Boolean).map((p) =>
    p.charAt(0).toUpperCase() + p.slice(1)).join("");
}
function camelCase(s: string): string {
  const p = pascalCase(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function entityToGraphQLType(ent: { name: string; fields: EntityFieldDef[] }): string {
  const typeName = pascalCase(ent.name);
  const fieldDefs = ent.fields
    .filter((f) => f.type !== "formula" && f.type !== "rollup" && f.type !== "timeseries")
    .map((f) => `  ${camelCase(f.name)}: ${fieldTypeToGraphQL(f.type, !!f.required)}`)
    .join("\n");
  return `type ${typeName} {\n  id: ID!\n${fieldDefs}\n  createdAt: String!\n  updatedAt: String!\n}`;
}

async function buildSchema(db: DB) {
  const ents = await db.select({
    id: entities.id, name: entities.name, fields: entities.fields,
  }).from(entities).limit(100);
  const entityList = ents.map((e) => ({
    id: e.id, name: e.name, fields: (e.fields ?? []) as EntityFieldDef[],
  }));

  const typeDefs = entityList.map(entityToGraphQLType).join("\n\n");
  const queries = entityList.map((e) => {
    const pn = pascalCase(e.name);
    return `  ${camelCase(e.name)}(id: ID!): ${pn}\n  ${camelCase(e.name)}List(limit: Int, offset: Int, q: String): [${pn}!]!`;
  }).join("\n");
  const mutations = entityList.map((e) => {
    const pn = pascalCase(e.name);
    return `  create${pn}(input: JSON!): ${pn}`;
  }).join("\n");

  const sdl = `
scalar JSON

${typeDefs}

type Query {
${queries || "  _empty: String"}
  _entities: [String!]!
}

type Mutation {
${mutations || "  _empty: String"}
}
`;

  const resolvers = {
    JSON: { __serialize: (v: unknown) => v, __parseValue: (v: unknown) => v },
    Query: {
      _entities: () => entityList.map((e) => e.name),
      ...Object.fromEntries(entityList.flatMap((e) => {
        const cn = camelCase(e.name);
        return [
          [cn, async (_: unknown, args: { id: string }, ctx: YogaContext) =>
            fetchOne(ctx, e.id, args.id, e.fields)],
          [`${cn}List`, async (_: unknown, args: { limit?: number; offset?: number; q?: string },
            ctx: YogaContext) => fetchList(ctx, e.id, args, e.fields)],
        ];
      })),
    },
    Mutation: Object.fromEntries(entityList.map((e) => {
      const pn = pascalCase(e.name);
      return [
        `create${pn}`,
        async (_: unknown, args: { input: Record<string, unknown> }, ctx: YogaContext) =>
          createOne(ctx, e.id, args.input, e.fields),
      ];
    })),
  };
  return createSchema({ typeDefs: sdl, resolvers });
}

async function fetchOne(ctx: YogaContext, entityId: string, id: string, fields: EntityFieldDef[]) {
  if (!ctx.companyId) throw new Error("Unauthorized");
  const [row] = await ctx.db.select().from(entityRecords).where(and(
    eq(entityRecords.id, id),
    eq(entityRecords.companyId, ctx.companyId),
    eq(entityRecords.entityId, entityId),
  ));
  return row ? rowToTyped(row, fields) : null;
}

async function fetchList(
  ctx: YogaContext, entityId: string,
  args: { limit?: number; offset?: number; q?: string }, fields: EntityFieldDef[],
) {
  if (!ctx.companyId) throw new Error("Unauthorized");
  const conds = [
    eq(entityRecords.companyId, ctx.companyId),
    eq(entityRecords.entityId, entityId),
    sql`${entityRecords.deletedAt} IS NULL`,
  ];
  if (args.q?.trim()) {
    conds.push(sql`${entityRecords.searchTsv}::tsvector @@ websearch_to_tsquery('simple', ${args.q.trim()})`);
  }
  const rows = await ctx.db.select().from(entityRecords).where(and(...conds))
    .limit(Math.min(args.limit ?? 100, 500))
    .offset(args.offset ?? 0);
  return rows.map((r) => rowToTyped(r, fields));
}

async function createOne(
  ctx: YogaContext, entityId: string, input: Record<string, unknown>, fields: EntityFieldDef[],
) {
  if (!ctx.companyId) throw new Error("Unauthorized");
  const v = validateRecord(fields, input);
  if (!v.ok) throw new Error("Validation: "
    + v.errors.map((e) => `${e.field}: ${e.message}`).join("; "));
  const [row] = await ctx.db.insert(entityRecords).values({
    companyId: ctx.companyId, entityId, data: v.data,
  }).returning();
  return row ? rowToTyped(row, fields) : null;
}

function rowToTyped(
  row: { id: string; data: unknown; createdAt: Date; updatedAt: Date },
  fields: EntityFieldDef[],
): Record<string, unknown> {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  for (const f of fields) out[camelCase(f.name)] = data[f.name] ?? null;
  return out;
}

/* Schema cache + lazy rebuild. TTL 60s; force qua POST /graphql/refresh. */
let cachedSchema: Awaited<ReturnType<typeof buildSchema>> | null = null;
let cachedAt = 0;
const SCHEMA_TTL_MS = 60_000;

async function getSchema(db: DB) {
  const now = Date.now();
  if (!cachedSchema || now - cachedAt > SCHEMA_TTL_MS) {
    cachedSchema = await buildSchema(db);
    cachedAt = now;
  }
  return cachedSchema;
}

export function registerGraphQL(app: FastifyInstance, db: DB): void {
  app.route({
    url: "/graphql",
    method: ["GET", "POST", "OPTIONS"],
    handler: async (req, reply) => {
      const schema = await getSchema(db);
      // Yoga schema vs context type lệch sau khi cast — silence:
      // schema sinh từ resolvers nhận YogaContext, yoga.context khớp shape.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const yoga = createYoga({
        schema: schema as never,
        landingPage: false,
        context: async ({ request }: { request: Request }) => {
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

  /** Force rebuild schema (sau khi entity meta đổi). */
  app.post("/graphql/refresh", async (_req, reply) => {
    cachedSchema = null;
    cachedAt = 0;
    return reply.send({ ok: true, message: "Schema sẽ rebuild ở request tiếp" });
  });
}
