/* ==========================================================
   rest-api.ts — REST endpoints tự sinh cho entity records.
   /api/v1/entities/:name/records  GET / POST
   /api/v1/entities/:name/records/:id  GET / PATCH / DELETE
   Auth: header X-API-Key (xem api-keys-router). Scope check theo
   format "entity:<name>:<action>"; empty scopes = full access.
   ========================================================== */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { apiKeys, entities, entityRecords } from "@erp-framework/db";
import { validateRecord, type EntityFieldDef } from "@erp-framework/core";
import type { DB } from "./db";

interface ApiKeyContext {
  companyId: string;
  scopes: string[];
}

/** Verify X-API-Key + load company + scopes. Trả null nếu invalid. */
async function authApiKey(
  db: DB, req: FastifyRequest,
): Promise<ApiKeyContext | null> {
  const key = req.headers["x-api-key"];
  if (typeof key !== "string" || !key.startsWith("sk_")) return null;
  const hash = createHash("sha256").update(key).digest("hex");
  const [row] = await db.select().from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.enabled, true)));
  if (!row) return null;
  // Best-effort update lastUsedAt (không await).
  void db.update(apiKeys).set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id)).catch(() => { /* ignore */ });
  return {
    companyId: row.companyId,
    scopes: (row.scopes ?? []) as string[],
  };
}

function hasScope(ctx: ApiKeyContext, entityName: string, action: string): boolean {
  if (ctx.scopes.length === 0) return true; // empty = full
  return ctx.scopes.some((s) =>
    s === `entity:${entityName}:${action}` || s === `entity:*:${action}` || s === "*"
  );
}

async function loadEntityByName(
  db: DB, companyId: string, name: string,
): Promise<{ id: string; fields: EntityFieldDef[] } | null> {
  const [row] = await db.select({ id: entities.id, fields: entities.fields })
    .from(entities)
    .where(and(eq(entities.companyId, companyId), eq(entities.name, name)));
  if (!row) return null;
  return { id: row.id, fields: (row.fields ?? []) as EntityFieldDef[] };
}

export function registerRestApi(app: FastifyInstance, db: DB): void {
  // List records.
  app.get("/api/v1/entities/:name/records", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    const { name } = req.params as { name: string };
    if (!hasScope(auth, name, "read")) return reply.code(403).send({ error: "Scope missing" });
    const ent = await loadEntityByName(db, auth.companyId, name);
    if (!ent) return reply.code(404).send({ error: "Entity không tồn tại" });
    const q = req.query as { limit?: string; offset?: string; q?: string };
    const limit = Math.min(Number(q.limit ?? 100), 500);
    const offset = Math.max(Number(q.offset ?? 0), 0);
    const rows = await db.select().from(entityRecords).where(and(
      eq(entityRecords.companyId, auth.companyId),
      eq(entityRecords.entityId, ent.id),
      sql`${entityRecords.deletedAt} IS NULL`,
      q.q ? sql`${entityRecords.searchTsv}::tsvector @@ websearch_to_tsquery('simple', ${q.q})` : sql`true`,
    )).limit(limit).offset(offset);
    return reply.send({ rows, count: rows.length });
  });

  // Get one.
  app.get("/api/v1/entities/:name/records/:id", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    const { name, id } = req.params as { name: string; id: string };
    if (!hasScope(auth, name, "read")) return reply.code(403).send({ error: "Scope missing" });
    const ent = await loadEntityByName(db, auth.companyId, name);
    if (!ent) return reply.code(404).send({ error: "Entity không tồn tại" });
    const [row] = await db.select().from(entityRecords).where(and(
      eq(entityRecords.id, id),
      eq(entityRecords.companyId, auth.companyId),
      eq(entityRecords.entityId, ent.id),
    ));
    if (!row) return reply.code(404).send({ error: "Record không tồn tại" });
    return reply.send(row);
  });

  // Create.
  app.post("/api/v1/entities/:name/records", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    const { name } = req.params as { name: string };
    if (!hasScope(auth, name, "write")) return reply.code(403).send({ error: "Scope missing" });
    const ent = await loadEntityByName(db, auth.companyId, name);
    if (!ent) return reply.code(404).send({ error: "Entity không tồn tại" });
    const v = validateRecord(ent.fields, (req.body ?? {}) as Record<string, unknown>);
    if (!v.ok) {
      return reply.code(400).send({ error: "Validation failed", details: v.errors });
    }
    const [row] = await db.insert(entityRecords).values({
      companyId: auth.companyId, entityId: ent.id, data: v.data,
    }).returning();
    return reply.code(201).send(row);
  });

  // Patch (merge JSONB).
  app.patch("/api/v1/entities/:name/records/:id", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    const { name, id } = req.params as { name: string; id: string };
    if (!hasScope(auth, name, "write")) return reply.code(403).send({ error: "Scope missing" });
    const ent = await loadEntityByName(db, auth.companyId, name);
    if (!ent) return reply.code(404).send({ error: "Entity không tồn tại" });
    const v = validateRecord(ent.fields, (req.body ?? {}) as Record<string, unknown>, { partial: true });
    if (!v.ok) {
      return reply.code(400).send({ error: "Validation failed", details: v.errors });
    }
    const [row] = await db.update(entityRecords).set({
      data: sql`${entityRecords.data} || ${JSON.stringify(v.data)}::jsonb`,
      version: sql`${entityRecords.version} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(entityRecords.id, id),
      eq(entityRecords.companyId, auth.companyId),
      eq(entityRecords.entityId, ent.id),
    )).returning();
    if (!row) return reply.code(404).send({ error: "Record không tồn tại" });
    return reply.send(row);
  });

  // Delete (soft).
  app.delete("/api/v1/entities/:name/records/:id", async (req, reply) => {
    const auth = await authApiKey(db, req);
    if (!auth) return reply.code(401).send({ error: "Invalid API key" });
    const { name, id } = req.params as { name: string; id: string };
    if (!hasScope(auth, name, "write")) return reply.code(403).send({ error: "Scope missing" });
    const ent = await loadEntityByName(db, auth.companyId, name);
    if (!ent) return reply.code(404).send({ error: "Entity không tồn tại" });
    await db.update(entityRecords).set({ deletedAt: new Date() }).where(and(
      eq(entityRecords.id, id),
      eq(entityRecords.companyId, auth.companyId),
      eq(entityRecords.entityId, ent.id),
    ));
    return reply.code(204).send();
  });
}
