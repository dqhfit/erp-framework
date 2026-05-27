/* ==========================================================
   mssql-connections-router.ts — CRUD kết nối MSSQL legacy
   per-company. Mật khẩu mã hóa qua crypto.ts AES-256-GCM,
   stripped khi trả về client (FE chỉ thấy name + host + db).

   Endpoint:
   - list:        liệt kê connection của công ty (không password)
   - get:         đọc 1 connection (không password)
   - save:        upsert (mã hóa password trước khi lưu)
   - delete:      xóa connection
   - setDefault:  đặt 1 connection làm isDefault, reset các cái khác
   - testConnect: thử connect + listTables — kiểm tra config đúng
   ========================================================== */

import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { mssqlConnections } from "@erp-framework/db";
import { MssqlClient } from "@erp-framework/mssql-client";
import type { DB } from "./db";
import { rbacProcedure, router } from "./trpc";
import { encryptSecret, decryptSecret } from "./crypto";

const saveInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(1433),
  database: z.string().min(1).max(255),
  username: z.string().min(1).max(255),
  /** Password plaintext khi user nhập; nếu omit (sửa không đổi pass) →
   *  giữ nguyên password_enc cũ. */
  password: z.string().max(500).optional(),
  encrypt: z.boolean().default(true),
  trustServerCert: z.boolean().default(false),
  allowWrite: z.boolean().default(false),
  isDefault: z.boolean().default(false),
});

export const mssqlConnectionsRouter = router({
  /** Liệt kê connection — KHÔNG bao gồm password. */
  list: rbacProcedure("edit", "settings").query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: mssqlConnections.id,
        name: mssqlConnections.name,
        host: mssqlConnections.host,
        port: mssqlConnections.port,
        database: mssqlConnections.database,
        username: mssqlConnections.username,
        encrypt: mssqlConnections.encrypt,
        trustServerCert: mssqlConnections.trustServerCert,
        allowWrite: mssqlConnections.allowWrite,
        isDefault: mssqlConnections.isDefault,
        hasPassword: sql<boolean>`length(${mssqlConnections.passwordEnc}) > 0`,
        createdAt: mssqlConnections.createdAt,
        updatedAt: mssqlConnections.updatedAt,
      })
      .from(mssqlConnections)
      .where(eq(mssqlConnections.companyId, ctx.user.companyId))
      .orderBy(mssqlConnections.name);
    return rows;
  }),

  /** Đọc 1 connection — KHÔNG bao gồm password. */
  get: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({
          id: mssqlConnections.id,
          name: mssqlConnections.name,
          host: mssqlConnections.host,
          port: mssqlConnections.port,
          database: mssqlConnections.database,
          username: mssqlConnections.username,
          encrypt: mssqlConnections.encrypt,
          trustServerCert: mssqlConnections.trustServerCert,
          allowWrite: mssqlConnections.allowWrite,
          isDefault: mssqlConnections.isDefault,
          hasPassword: sql<boolean>`length(${mssqlConnections.passwordEnc}) > 0`,
        })
        .from(mssqlConnections)
        .where(
          and(eq(mssqlConnections.id, input), eq(mssqlConnections.companyId, ctx.user.companyId)),
        );
      return row ?? null;
    }),

  /** Upsert connection. Password optional khi update — giữ nguyên nếu thiếu. */
  save: rbacProcedure("edit", "settings")
    .input(saveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const passwordEnc = input.password ? encryptSecret(input.password) : undefined;

      if (input.id) {
        const updates: Record<string, unknown> = {
          name: input.name,
          host: input.host,
          port: input.port,
          database: input.database,
          username: input.username,
          encrypt: input.encrypt,
          trustServerCert: input.trustServerCert,
          allowWrite: input.allowWrite,
          isDefault: input.isDefault,
          updatedAt: new Date(),
        };
        if (passwordEnc != null) updates.passwordEnc = passwordEnc;

        const [row] = await ctx.db
          .update(mssqlConnections)
          .set(updates)
          .where(
            and(
              eq(mssqlConnections.id, input.id),
              eq(mssqlConnections.companyId, ctx.user.companyId),
            ),
          )
          .returning();
        if (!row) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Connection không tồn tại." });
        }
        // Nếu set isDefault=true → reset các connection khác về false.
        if (input.isDefault) await resetDefaults(ctx.db, ctx.user.companyId, row.id);
        return { id: row.id };
      }

      // Insert.
      const [row] = await ctx.db
        .insert(mssqlConnections)
        .values({
          companyId: ctx.user.companyId,
          name: input.name,
          host: input.host,
          port: input.port,
          database: input.database,
          username: input.username,
          passwordEnc: passwordEnc ?? "",
          encrypt: input.encrypt,
          trustServerCert: input.trustServerCert,
          allowWrite: input.allowWrite,
          isDefault: input.isDefault,
          createdBy: ctx.user.id,
        })
        .returning();
      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Không tạo được connection.",
        });
      }
      if (input.isDefault) await resetDefaults(ctx.db, ctx.user.companyId, row.id);
      return { id: row.id };
    }),

  delete: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(mssqlConnections)
        .where(
          and(eq(mssqlConnections.id, input), eq(mssqlConnections.companyId, ctx.user.companyId)),
        );
      return { ok: true };
    }),

  setDefault: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(mssqlConnections)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(
          and(eq(mssqlConnections.id, input), eq(mssqlConnections.companyId, ctx.user.companyId)),
        )
        .returning();
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection không tồn tại." });
      }
      await resetDefaults(ctx.db, ctx.user.companyId, row.id);
      return { ok: true };
    }),

  /** Trả về toàn bộ bảng của MSSQL legacy theo connection — dùng
   *  cho TagBox UI chọn seed/exclude. Cache phía FE để không re-fetch. */
  listTables: rbacProcedure("edit", "settings")
    .input(z.object({ connectionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(mssqlConnections)
        .where(
          and(
            eq(mssqlConnections.id, input.connectionId),
            eq(mssqlConnections.companyId, ctx.user.companyId),
          ),
        );
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection không tồn tại." });
      }
      const client = MssqlClient.fromConfig({
        host: row.host,
        port: row.port,
        database: row.database,
        username: row.username,
        password: decryptSecret(row.passwordEnc),
        encrypt: row.encrypt,
        trustServerCert: row.trustServerCert,
        allowWrite: row.allowWrite,
        requestTimeoutMs: 30_000,
      });
      try {
        await client.connect();
        return await client.listTables();
      } finally {
        await client.close();
      }
    }),

  /** Thử connect + listTables — return { ok, tables, error }. */
  testConnect: rbacProcedure("edit", "settings")
    .input(z.string().uuid())
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(mssqlConnections)
        .where(
          and(eq(mssqlConnections.id, input), eq(mssqlConnections.companyId, ctx.user.companyId)),
        );
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection không tồn tại." });
      }
      const client = MssqlClient.fromConfig({
        host: row.host,
        port: row.port,
        database: row.database,
        username: row.username,
        password: decryptSecret(row.passwordEnc),
        encrypt: row.encrypt,
        trustServerCert: row.trustServerCert,
        allowWrite: row.allowWrite,
        requestTimeoutMs: 10_000,
      });
      try {
        await client.connect();
        const tables = await client.listTables();
        return { ok: true, tableCount: tables.length, sample: tables.slice(0, 5) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      } finally {
        await client.close();
      }
    }),
});

async function resetDefaults(db: DB, companyId: string, exceptId: string): Promise<void> {
  await db
    .update(mssqlConnections)
    .set({ isDefault: false })
    .where(
      and(
        eq(mssqlConnections.companyId, companyId),
        sql`${mssqlConnections.id} <> ${exceptId}::uuid`,
      ),
    );
}
