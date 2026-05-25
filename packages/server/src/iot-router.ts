/* ==========================================================
   iot-router.ts — tRPC admin cho module IoT:
   - devices.* — CRUD thiết bị + xoay key.
   - telemetry.list — xem dữ liệu thiết bị đã gửi.
   - commands.* — gửi/xem lệnh.
   Tất cả procedures multi-tenant qua rbacProcedure("...", "iot").
   ========================================================== */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  iotDevices, iotTelemetry, iotCommands,
} from "@erp-framework/db";
import { router, rbacProcedure } from "./trpc";
import {
  newDeviceKey, hashDeviceKey,
} from "./iot-shared";
import { publishCommand } from "./iot-mqtt";

export const iotRouter = router({
  devices: router({
    list: rbacProcedure("view", "iot").query(async ({ ctx }) =>
      ctx.db.select({
        id: iotDevices.id, name: iotDevices.name, label: iotDevices.label,
        meta: iotDevices.meta, lastSeenAt: iotDevices.lastSeenAt,
        createdAt: iotDevices.createdAt,
      }).from(iotDevices)
        .where(eq(iotDevices.companyId, ctx.user.companyId))
        .orderBy(desc(iotDevices.createdAt))),

    create: rbacProcedure("create", "iot")
      .input(z.object({
        name: z.string().min(1),
        label: z.string().optional(),
        meta: z.record(z.string(), z.unknown()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const key = newDeviceKey();
        const [d] = await ctx.db.insert(iotDevices).values({
          companyId: ctx.user.companyId,
          name: input.name,
          label: input.label ?? null,
          deviceKeyHash: hashDeviceKey(key),
          meta: input.meta ?? {},
        }).returning();
        if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        // Trả key thô MỘT LẦN — server không lưu được nữa sau câu trả lời này.
        return { device: d, key };
      }),

    delete: rbacProcedure("delete", "iot")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        await ctx.db.delete(iotDevices).where(and(
          eq(iotDevices.id, input),
          eq(iotDevices.companyId, ctx.user.companyId),
        ));
        return { ok: true };
      }),

    rotateKey: rbacProcedure("edit", "iot")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        const key = newDeviceKey();
        const [d] = await ctx.db.update(iotDevices).set({
          deviceKeyHash: hashDeviceKey(key),
          updatedAt: new Date(),
        }).where(and(
          eq(iotDevices.id, input),
          eq(iotDevices.companyId, ctx.user.companyId),
        )).returning({ id: iotDevices.id });
        if (!d) throw new TRPCError({ code: "NOT_FOUND" });
        return { key };
      }),
  }),

  telemetry: router({
    list: rbacProcedure("view", "iot")
      .input(z.object({
        deviceId: z.string().uuid().optional(),
        channel: z.string().optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }))
      .query(async ({ ctx, input }) => {
        const where = [eq(iotTelemetry.companyId, ctx.user.companyId)];
        if (input.deviceId) where.push(eq(iotTelemetry.deviceId, input.deviceId));
        if (input.channel) where.push(eq(iotTelemetry.channel, input.channel));
        if (input.from) where.push(gte(iotTelemetry.ts, new Date(input.from)));
        if (input.to) where.push(lte(iotTelemetry.ts, new Date(input.to)));
        return ctx.db.select().from(iotTelemetry)
          .where(and(...where))
          .orderBy(desc(iotTelemetry.ts))
          .limit(input.limit);
      }),

    /* Đếm số bản ghi theo channel — phục vụ overview. */
    summary: rbacProcedure("view", "iot")
      .input(z.object({ deviceId: z.string().uuid() }))
      .query(async ({ ctx, input }) => ctx.db
        .select({
          channel: iotTelemetry.channel,
          count: sql<number>`count(*)::int`,
        })
        .from(iotTelemetry)
        .where(and(
          eq(iotTelemetry.companyId, ctx.user.companyId),
          eq(iotTelemetry.deviceId, input.deviceId),
        ))
        .groupBy(iotTelemetry.channel)),
  }),

  commands: router({
    queue: rbacProcedure("create", "iot")
      .input(z.object({
        deviceId: z.string().uuid(),
        payload: z.record(z.string(), z.unknown()),
      }))
      .mutation(async ({ ctx, input }) => {
        // Đảm bảo thiết bị thuộc cùng công ty.
        const [d] = await ctx.db.select({ id: iotDevices.id })
          .from(iotDevices).where(and(
            eq(iotDevices.id, input.deviceId),
            eq(iotDevices.companyId, ctx.user.companyId),
          ));
        if (!d) throw new TRPCError({ code: "NOT_FOUND" });
        const [cmd] = await ctx.db.insert(iotCommands).values({
          companyId: ctx.user.companyId,
          deviceId: input.deviceId,
          payload: input.payload,
        }).returning();
        if (!cmd) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        // Đẩy ngay qua MQTT (no-op nếu MQTT không bật — device sẽ pull
        // qua REST GET /iot/v1/commands hoặc piggyback ở response telemetry).
        publishCommand(input.deviceId, cmd.id, input.payload);
        return cmd;
      }),

    list: rbacProcedure("view", "iot")
      .input(z.object({
        deviceId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
      }))
      .query(async ({ ctx, input }) => ctx.db.select().from(iotCommands)
        .where(and(
          eq(iotCommands.companyId, ctx.user.companyId),
          eq(iotCommands.deviceId, input.deviceId),
        ))
        .orderBy(desc(iotCommands.createdAt))
        .limit(input.limit)),

    cancel: rbacProcedure("edit", "iot")
      .input(z.string().uuid())
      .mutation(async ({ ctx, input }) => {
        await ctx.db.update(iotCommands)
          .set({ status: "error", result: { canceled: true } })
          .where(and(
            eq(iotCommands.id, input),
            eq(iotCommands.companyId, ctx.user.companyId),
            eq(iotCommands.status, "pending"),
          ));
        return { ok: true };
      }),
  }),
});
