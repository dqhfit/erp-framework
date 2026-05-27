/* ==========================================================
   procedure-runner.ts — Native procedure execution.
   Chạy JS procedure trong isolated-vm sandbox với bindings:
     - args        : input từ caller
     - db.queryRecords(entityName, filter?, opts?) — read entity_records
     - db.findById(entityName, id) — read 1 record
     - db.tx(async () => {...}) — chạy callback trong transaction; mọi
       entity.insert/update/delete + db.queryRecords/findById trong callback
       dùng cùng connection tx. Throw trong callback → rollback toàn bộ.
     - entity.insert(entityName, data) — write, đi qua validateRecord
     - entity.update(entityName, id, patch)
     - entity.delete(entityName, id)
     - callTool(name, args) — MCP (legacy fallback)
     - callProc(name, args) — gọi procedure khác (cycle-protected, depth ≤ 8)
     - fetch(url, init?) — host fetch (allowlist qua env code-runner)
     - console.log → log array
   Tất cả ops scope `companyId` trong closure — code không thoát được công ty.
   ========================================================== */
import ivm from "isolated-vm";
import { eq, and, sql } from "drizzle-orm";
import { entities, entityRecords, procedures } from "@erp-framework/db";
import { validateRecord, type EntityFieldDef } from "@erp-framework/core";
import type { DB } from "./db";
import { logActivity } from "./activity";

const MAX_DEPTH = 8;
const MEM_MB = Number(process.env.CODE_NODE_MEM_MB ?? 128);
const TIMEOUT_MS = Number(process.env.CODE_NODE_TIMEOUT_MS ?? 5_000);

function getAllowlist(): string[] {
  return (process.env.CODE_NODE_FETCH_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ProcedureInvokeResult {
  output: unknown;
  logs: string[];
  durationMs: number;
}

export interface MakeInvokeProcedureDeps {
  db: DB;
  companyId: string;
  /** MCP callTool (legacy) — bind sẵn theo công ty từ caller. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Actor để ghi activity_log; null nếu chạy nội bộ (workflow). */
  actorUserId?: string | null;
}

/**
 * Tạo hàm `invokeProcedure(name, args)` cho 1 công ty.
 * Hàm trả về có thể được gọi:
 *   - từ tRPC procedures.invoke
 *   - từ workflow runner (case "procedure")
 *   - từ records.* khi binding = "proc:<name>"
 *   - từ procedure khác (callProc) — track depth chống cycle
 */
export function makeInvokeProcedure(deps: MakeInvokeProcedureDeps) {
  const invoke = async (
    name: string,
    args: Record<string, unknown>,
    depth = 0,
  ): Promise<ProcedureInvokeResult> => {
    if (depth > MAX_DEPTH) {
      throw new Error(`Procedure depth > ${MAX_DEPTH} (vòng lặp?)`);
    }
    const [row] = await deps.db
      .select()
      .from(procedures)
      .where(
        and(
          eq(procedures.companyId, deps.companyId),
          eq(procedures.name, name),
          eq(procedures.enabled, true),
        ),
      );
    if (!row) throw new Error(`Procedure không tồn tại hoặc đã tắt: ${name}`);
    return runCode(row.code, args, depth);
  };

  const runCode = async (
    code: string,
    args: Record<string, unknown>,
    depth: number,
  ): Promise<ProcedureInvokeResult> => {
    const t0 = performance.now();
    const isolate = new ivm.Isolate({ memoryLimit: MEM_MB });
    const logs: string[] = [];
    const allowlist = getAllowlist();

    // Stack DB hien hanh — bottom la deps.db (auto-commit), khi db.tx mo
    // thi push tx len; helper insert/update/delete/query doc currentDb().
    // Nested tx → drizzle dung savepoint (currentDb().transaction(...)).
    const txStack: DB[] = [deps.db];
    const currentDb = (): DB => txStack[txStack.length - 1]!;

    try {
      const context = await isolate.createContext();
      const jail = context.global;

      await jail.set("__args", new ivm.ExternalCopy(args).copyInto());

      await jail.set(
        "__log",
        new ivm.Reference((...a: unknown[]) => {
          logs.push(a.map((v) => (typeof v === "string" ? v : safeStringify(v))).join(" "));
        }),
      );

      // db.queryRecords(entityName, filter?, opts?)
      await jail.set(
        "__dbQuery",
        new ivm.Reference(async (entityName: unknown, filter: unknown, opts: unknown) => {
          try {
            const rows = await queryRecords(
              currentDb(),
              deps.companyId,
              String(entityName ?? ""),
              (filter && typeof filter === "object" ? filter : null) as Record<
                string,
                unknown
              > | null,
              (opts && typeof opts === "object" ? opts : null) as {
                limit?: number;
                offset?: number;
              } | null,
            );
            return { ok: true, value: rows };
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
        }),
      );

      await jail.set(
        "__dbFindById",
        new ivm.Reference(async (entityName: unknown, id: unknown) => {
          try {
            const row = await findById(
              currentDb(),
              deps.companyId,
              String(entityName ?? ""),
              String(id ?? ""),
            );
            return { ok: true, value: row };
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
        }),
      );

      await jail.set(
        "__entityInsert",
        new ivm.Reference(async (entityName: unknown, data: unknown) => {
          try {
            const row = await insertRecord(
              currentDb(),
              deps,
              String(entityName ?? ""),
              (data && typeof data === "object" ? data : {}) as Record<string, unknown>,
            );
            return { ok: true, value: row };
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
        }),
      );

      await jail.set(
        "__entityUpdate",
        new ivm.Reference(async (entityName: unknown, id: unknown, patch: unknown) => {
          try {
            const row = await updateRecord(
              currentDb(),
              deps,
              String(entityName ?? ""),
              String(id ?? ""),
              (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>,
            );
            return { ok: true, value: row };
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
        }),
      );

      await jail.set(
        "__entityDelete",
        new ivm.Reference(async (entityName: unknown, id: unknown) => {
          try {
            await deleteRecord(currentDb(), deps, String(entityName ?? ""), String(id ?? ""));
            return { ok: true, value: null };
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
        }),
      );

      // db.tx(async () => { ... }) — mo transaction; nested goi tao savepoint.
      // ivm.Reference cua callback nhan tu isolate qua arguments.reference=true.
      // Throw trong callback → drizzle rollback va loi bubble len caller.
      await jail.set(
        "__tx",
        new ivm.Reference(async (cbRef: ivm.Reference<() => Promise<unknown>>) => {
          try {
            const result = await currentDb().transaction(async (tx) => {
              txStack.push(tx as unknown as DB);
              try {
                return await cbRef.apply(undefined, [], {
                  arguments: { copy: true },
                  result: { promise: true, copy: true },
                });
              } finally {
                txStack.pop();
              }
            });
            return { ok: true, value: result };
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
        }),
      );

      await jail.set(
        "__callTool",
        new ivm.Reference(async (name: unknown, callArgs: unknown) => {
          try {
            if (typeof name !== "string") throw new Error("callTool: name phải là chuỗi");
            const out = await deps.callTool(
              name,
              (callArgs && typeof callArgs === "object" ? callArgs : {}) as Record<string, unknown>,
            );
            return { ok: true, value: out ?? null };
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
        }),
      );

      await jail.set(
        "__callProc",
        new ivm.Reference(async (name: unknown, procArgs: unknown) => {
          try {
            if (typeof name !== "string") throw new Error("callProc: name phải là chuỗi");
            const r = await invoke(
              name,
              (procArgs && typeof procArgs === "object" ? procArgs : {}) as Record<string, unknown>,
              depth + 1,
            );
            return { ok: true, value: r.output };
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
        }),
      );

      await jail.set(
        "__fetch",
        new ivm.Reference(async (url: unknown, init: unknown) => {
          try {
            if (typeof url !== "string") throw new Error("fetch: url phải là chuỗi");
            // Deny-by-default: allowlist rỗng = block mọi fetch.
            // Cấu hình CODE_NODE_FETCH_ALLOWLIST="https://api.example.com,https://..."
            if (!allowlist.some((d) => url.startsWith(d))) {
              throw new Error(
                `fetch domain không nằm trong allowlist: ${url}. ` +
                  `Set CODE_NODE_FETCH_ALLOWLIST để cho phép domain.`,
              );
            }
            const res = await fetch(url, (init ?? {}) as RequestInit);
            const text = await res.text();
            return { ok: true, value: { ok: res.ok, status: res.status, text } };
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
        }),
      );

      const wrapped = `
        (() => {
          const args = __args ?? {};
          const console = Object.freeze({
            log: (...a) => __log.applySync(undefined, a, { arguments: { copy: true } }),
          });
          const __unwrap = async (p) => {
            const r = await p;
            if (!r.ok) throw new Error(r.error);
            return r.value;
          };
          const __apply = (ref, args) => __unwrap(ref.apply(
            undefined, args,
            { arguments: { copy: true }, result: { promise: true, copy: true } },
          ));
          // tx khac __apply: callback can dươc gui sang host nhu reference
          // (function khong copy duoc qua isolate boundary).
          const __txInvoke = (fn) => __unwrap(__tx.apply(
            undefined, [fn],
            { arguments: { reference: true }, result: { promise: true, copy: true } },
          ));
          const db = Object.freeze({
            queryRecords: (e, f, o) => __apply(__dbQuery, [e, f, o]),
            findById:     (e, id)   => __apply(__dbFindById, [e, id]),
            tx:           (fn)      => __txInvoke(fn),
          });
          const entity = Object.freeze({
            insert: (e, d)      => __apply(__entityInsert, [e, d]),
            update: (e, id, p)  => __apply(__entityUpdate, [e, id, p]),
            delete: (e, id)     => __apply(__entityDelete, [e, id]),
          });
          const callTool = (n, a) => __apply(__callTool, [n, a]);
          const callProc = (n, a) => __apply(__callProc, [n, a]);
          const fetch    = (u, i) => __apply(__fetch, [u, i]);
          return (async () => {
            ${code}
          })();
        })()
      `;
      const script = await isolate.compileScript(wrapped);
      const resultCopy = await script.run(context, {
        promise: true,
        copy: true,
        timeout: TIMEOUT_MS,
      });
      return {
        output: resultCopy,
        logs,
        durationMs: Math.round(performance.now() - t0),
      };
    } finally {
      isolate.dispose();
    }
  };

  return invoke;
}

/* ── DB ops (chạy ngoài isolate, scoped theo companyId) ─────────── */

async function loadEntity(db: DB, companyId: string, entityName: string) {
  const [row] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.companyId, companyId), eq(entities.name, entityName)));
  if (!row) throw new Error(`Entity không tồn tại: ${entityName}`);
  return row;
}

async function queryRecords(
  db: DB,
  companyId: string,
  entityName: string,
  filter: Record<string, unknown> | null,
  opts: { limit?: number; offset?: number } | null,
) {
  const ent = await loadEntity(db, companyId, entityName);
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 1000);
  const offset = Math.max(opts?.offset ?? 0, 0);
  let q = db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.companyId, companyId),
        eq(entityRecords.entityId, ent.id),
        filter && Object.keys(filter).length > 0
          ? sql`${entityRecords.data} @> ${JSON.stringify(filter)}::jsonb`
          : sql`true`,
      ),
    )
    .$dynamic();
  q = q.limit(limit).offset(offset);
  const rows = await q;
  return rows.map((r) => ({
    id: r.id,
    data: r.data,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

async function findById(db: DB, companyId: string, entityName: string, id: string) {
  const ent = await loadEntity(db, companyId, entityName);
  const [r] = await db
    .select()
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.companyId, companyId),
        eq(entityRecords.entityId, ent.id),
        eq(entityRecords.id, id),
      ),
    );
  return r ? { id: r.id, data: r.data, createdAt: r.createdAt, updatedAt: r.updatedAt } : null;
}

/* Helper write nhan `db` rieng (khac voi deps.db) — de tx scope:
   db.tx() push tx vao stack, helper se nhan tx thay vi auto-commit db. */

async function insertRecord(
  db: DB,
  deps: MakeInvokeProcedureDeps,
  entityName: string,
  data: Record<string, unknown>,
) {
  const ent = await loadEntity(db, deps.companyId, entityName);
  const fields = (ent.fields ?? []) as EntityFieldDef[];
  const v = validateRecord(fields, data);
  if (!v.ok)
    throw new Error(
      `Dữ liệu không hợp lệ: ${v.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
    );
  const [row] = await db
    .insert(entityRecords)
    .values({
      companyId: deps.companyId,
      entityId: ent.id,
      data: v.data,
      createdBy: deps.actorUserId ?? null,
    })
    .returning();
  await logActivity(db, {
    companyId: deps.companyId,
    kind: "procedure_write",
    objectType: "entity",
    target: entityName,
    detail: `Procedure insert record ${row?.id ?? ""}`,
    actorUserId: deps.actorUserId ?? undefined,
  });
  return row;
}

async function updateRecord(
  db: DB,
  deps: MakeInvokeProcedureDeps,
  entityName: string,
  id: string,
  patch: Record<string, unknown>,
) {
  const ent = await loadEntity(db, deps.companyId, entityName);
  const fields = (ent.fields ?? []) as EntityFieldDef[];
  const v = validateRecord(fields, patch, { partial: true });
  if (!v.ok)
    throw new Error(
      `Dữ liệu không hợp lệ: ${v.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
    );
  // Merge JSONB ở app layer — đọc, hợp nhất, ghi.
  const [cur] = await db
    .select({ data: entityRecords.data })
    .from(entityRecords)
    .where(
      and(
        eq(entityRecords.companyId, deps.companyId),
        eq(entityRecords.entityId, ent.id),
        eq(entityRecords.id, id),
      ),
    );
  if (!cur) throw new Error(`Record không tồn tại: ${id}`);
  const merged = { ...(cur.data as Record<string, unknown>), ...v.data };
  const [row] = await db
    .update(entityRecords)
    .set({ data: merged, updatedAt: new Date() })
    .where(and(eq(entityRecords.companyId, deps.companyId), eq(entityRecords.id, id)))
    .returning();
  await logActivity(db, {
    companyId: deps.companyId,
    kind: "procedure_write",
    objectType: "entity",
    target: entityName,
    detail: `Procedure update record ${id}`,
    actorUserId: deps.actorUserId ?? undefined,
  });
  return row;
}

async function deleteRecord(db: DB, deps: MakeInvokeProcedureDeps, entityName: string, id: string) {
  const ent = await loadEntity(db, deps.companyId, entityName);
  await db
    .delete(entityRecords)
    .where(
      and(
        eq(entityRecords.companyId, deps.companyId),
        eq(entityRecords.entityId, ent.id),
        eq(entityRecords.id, id),
      ),
    );
  await logActivity(db, {
    companyId: deps.companyId,
    kind: "procedure_write",
    objectType: "entity",
    target: entityName,
    detail: `Procedure delete record ${id}`,
    actorUserId: deps.actorUserId ?? undefined,
  });
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
