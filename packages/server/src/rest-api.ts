/* ==========================================================
   rest-api.ts — REST endpoints tự sinh cho entity records.
   /api/v1/entities/:name/records  GET / POST
   /api/v1/entities/:name/records/:id  GET / PATCH / DELETE
   Auth: header X-API-Key (xem api-keys-router). Scope check theo
   format "entity:<name>:<action>".
   Empty scopes = DENY (deny-by-default). Dùng "*" để grant full,
   hoặc "entity:*:read"/"entity:*:write" cho từng action.
   ========================================================== */

import { type EntityFieldDef, validateRecord } from "@erp-framework/core";
import { entities } from "@erp-framework/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { type ApiKeyContext, authApiKey } from "./api-key-auth";
import type { DB } from "./db";
import { getRecordStore } from "./record-store";

/** Deny-by-default. Empty scopes = không được phép gì. Admin muốn cấp
 *  full access phải explicit thêm "*" vào scopes (xem api-keys-router).
 *  Export để test (`rest-api.test.ts`) — không phải public API. */
export function hasScope(ctx: ApiKeyContext, entityName: string, action: string): boolean {
  if (ctx.scopes.length === 0) return false;
  return ctx.scopes.some(
    (s) => s === `entity:${entityName}:${action}` || s === `entity:*:${action}` || s === "*",
  );
}

async function loadEntityByName(
  db: DB,
  companyId: string,
  name: string,
): Promise<{ id: string; fields: EntityFieldDef[] } | null> {
  const [row] = await db
    .select({ id: entities.id, fields: entities.fields })
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
    // Qua RecordStore → dispatch EAV/bảng thật. (q full-text trên bảng thật chưa
    // hỗ trợ — bỏ qua, xem HYBRID-STORAGE.md.)
    const { rows } = await getRecordStore(db).list(auth.companyId, ent.id, {
      q: q.q,
      limit,
      offset,
      withTotal: false,
    });
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
    const row = await getRecordStore(db).getById(auth.companyId, id);
    if (!row || row.entityId !== ent.id)
      return reply.code(404).send({ error: "Record không tồn tại" });
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
    const row = await getRecordStore(db).insert(
      auth.companyId,
      ent.id,
      v.data as Record<string, unknown>,
      null,
    );
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
    const v = validateRecord(ent.fields, (req.body ?? {}) as Record<string, unknown>, {
      partial: true,
    });
    if (!v.ok) {
      return reply.code(400).send({ error: "Validation failed", details: v.errors });
    }
    const store = getRecordStore(db);
    const cur = await store.loadState(auth.companyId, id);
    if (!cur || cur.entityId !== ent.id)
      return reply.code(404).send({ error: "Record không tồn tại" });
    const row = await store.merge(
      auth.companyId,
      id,
      v.data as Record<string, unknown>,
      cur.version + 1,
    );
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
    const store = getRecordStore(db);
    const cur = await store.loadState(auth.companyId, id);
    if (cur && cur.entityId === ent.id) await store.softDelete(auth.companyId, id);
    return reply.code(204).send();
  });
}
