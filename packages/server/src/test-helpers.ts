/* ==========================================================
   test-helpers.ts — Helper chung cho unit test các tRPC router.
   - makeMockCtx: tạo Context giả với user role + companyId
   - makeMockDb: drizzle chain mock có thể inject query result
   - assertThrowsTRPCError: assert mã lỗi tRPC
   Sử dụng pattern createCaller(router, ctx) để gọi procedure trực tiếp,
   bỏ qua HTTP layer. Test thuần unit — không cần Postgres thật.
   ========================================================== */
import { TRPCError } from "@trpc/server";
import { expect, vi } from "vitest";
import type { Role } from "@erp-framework/core";
import type { Context, SessionUser } from "./context";
import type { DB } from "./db";
import type { FastifyReply } from "fastify";

export interface MockUserInput {
  id?: string;
  email?: string;
  name?: string;
  role?: Role;
  companyId?: string | null;
  companyApproved?: boolean;
  companyDisabled?: boolean;
}

/** Tạo SessionUser với defaults sane.
 *  Dùng `'key' in overrides` để PHÂN BIỆT explicit `null` với undefined —
 *  tránh `null ?? default` ép null thành default (bug ban đầu). */
export function makeMockUser(overrides: MockUserInput = {}): SessionUser {
  return {
    id: overrides.id ?? "user_test_1",
    email: overrides.email ?? "test@example.com",
    name: overrides.name ?? "Test User",
    role: overrides.role ?? "admin",
    companyId: "companyId" in overrides ? (overrides.companyId ?? null) : "co_test_1",
    companyApproved: overrides.companyApproved ?? true,
    companyDisabled: overrides.companyDisabled ?? false,
  };
}

/** Mock FastifyReply tối thiểu — chỉ cookie ops cho auth router. */
function makeMockReply(): FastifyReply {
  return {
    setCookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
}

export interface MakeMockCtxInput {
  /** SessionUser hoặc null cho unauthenticated. */
  user?: SessionUser | null;
  /** Mock DB. Mặc định = empty stub (mọi query trả []). */
  db?: DB;
  /** Session token (vd cho logout test). */
  sessionToken?: string | null;
  /** Client IP (cho rate-limit test). */
  ip?: string;
}

/** Build Context giả cho test. */
export function makeMockCtx(input: MakeMockCtxInput = {}): Context {
  return {
    db: input.db ?? makeEmptyDb(),
    user: input.user === undefined ? makeMockUser() : input.user,
    sessionToken: input.sessionToken ?? null,
    reply: makeMockReply(),
    ip: input.ip ?? "127.0.0.1",
  };
}

/* ─── DB mock ────────────────────────────────────────────── */

/** Recorded DB op — caller có thể inspect sau test. */
export interface DbOp {
  kind: "select" | "insert" | "update" | "delete" | "execute";
  table?: string;
  values?: unknown;
  set?: unknown;
}

export interface MockDbController {
  /** Trả về drizzle DB mock thoả mãn kiểu DB. */
  db: DB;
  /** Inject result cho query select kế tiếp (FIFO). */
  enqueueSelect: (rows: unknown[]) => void;
  /** Inject result cho insert.returning() kế tiếp. */
  enqueueInsert: (rows: unknown[]) => void;
  /** Inject result cho update.returning() kế tiếp. */
  enqueueUpdate: (rows: unknown[]) => void;
  /** Inject result cho db.execute(sql\`...\`) kế tiếp. */
  enqueueExecute: (rows: unknown[]) => void;
  /** Lịch sử ops đã gọi. */
  ops: DbOp[];
}

/** DB mock điều khiển được — call site enqueue result cho mỗi query. */
export function makeMockDb(): MockDbController {
  const selectQueue: unknown[][] = [];
  const insertQueue: unknown[][] = [];
  const updateQueue: unknown[][] = [];
  const executeQueue: unknown[][] = [];
  const ops: DbOp[] = [];

  // Thenable helper: chain end-point return Promise resolving to queue head.
  const dequeue = <T>(q: T[][]): Promise<T[]> => {
    const v = q.shift() ?? [];
    return Promise.resolve(v as T[]);
  };

  // limit() trả Promise (await được) KÈM .offset() (cùng resolve 1 kết quả đã
  // dequeue) — hỗ trợ chuỗi `.limit().offset()` của RecordStore.list.
  const limitResult = () => {
    const p = dequeue(selectQueue);
    return Object.assign(p, { offset: (_n: number) => p });
  };

  const selectChain = () => ({
    from: (_table: unknown) => {
      ops.push({ kind: "select" });
      const next = {
        where: (_cond?: unknown) => ({
          ...next,
          limit: (_n: number) => limitResult(),
          orderBy: (..._a: unknown[]) => ({
            ...next,
            limit: (_n: number) => limitResult(),
            then: (r: (v: unknown[]) => unknown) => dequeue(selectQueue).then(r),
          }),
          then: (r: (v: unknown[]) => unknown) => dequeue(selectQueue).then(r),
        }),
        limit: (_n: number) => limitResult(),
        orderBy: (..._a: unknown[]) => ({
          ...next,
          limit: (_n: number) => limitResult(),
          then: (r: (v: unknown[]) => unknown) => dequeue(selectQueue).then(r),
        }),
        then: (r: (v: unknown[]) => unknown) => dequeue(selectQueue).then(r),
        innerJoin: (..._a: unknown[]) => next,
        leftJoin: (..._a: unknown[]) => next,
        $dynamic: () => next,
      };
      return next;
    },
  });

  const insertChain = () => ({
    values: (values: unknown) => {
      ops.push({ kind: "insert", values });
      return {
        returning: () => dequeue(insertQueue),
        onConflictDoNothing: () => ({
          returning: () => dequeue(insertQueue),
          then: (r: (v: unknown) => unknown) => Promise.resolve().then(r),
        }),
        onConflictDoUpdate: (_o: unknown) => ({
          returning: () => dequeue(insertQueue),
          then: (r: (v: unknown) => unknown) => Promise.resolve().then(r),
        }),
        then: (r: (v: unknown) => unknown) => Promise.resolve().then(r),
      };
    },
  });

  const updateChain = () => ({
    set: (set: unknown) => {
      ops.push({ kind: "update", set });
      return {
        where: (_cond?: unknown) => ({
          returning: () => dequeue(updateQueue),
          then: (r: (v: unknown) => unknown) => Promise.resolve().then(r),
        }),
      };
    },
  });

  const deleteChain = () => ({
    where: (_cond?: unknown) => {
      ops.push({ kind: "delete" });
      return Promise.resolve(undefined);
    },
  });

  const db = {
    select: selectChain,
    insert: insertChain,
    update: updateChain,
    delete: deleteChain,
    execute: (..._a: unknown[]) => {
      ops.push({ kind: "execute" });
      return dequeue(executeQueue);
    },
  } as unknown as DB;

  return {
    db,
    enqueueSelect: (rows) => selectQueue.push(rows),
    enqueueInsert: (rows) => insertQueue.push(rows),
    enqueueUpdate: (rows) => updateQueue.push(rows),
    enqueueExecute: (rows) => executeQueue.push(rows),
    ops,
  };
}

/** DB stub trả [] cho mọi query (dùng khi không quan tâm DB). */
function makeEmptyDb(): DB {
  return makeMockDb().db;
}

/* ─── Assertion helpers ─────────────────────────────────── */

/** Assert async callback throw TRPCError với code cụ thể. */
export async function assertThrowsTRPCError(
  fn: () => Promise<unknown>,
  expectedCode: TRPCError["code"],
): Promise<TRPCError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TRPCError);
    const trpcErr = e as TRPCError;
    expect(trpcErr.code).toBe(expectedCode);
    return trpcErr;
  }
  throw new Error(`Expected TRPCError(${expectedCode}) but no error thrown`);
}
