/* ==========================================================
   iot.ts — REST endpoints cho thiết bị IoT (Fastify plugin, KHÔNG
   tRPC để firmware nhúng dùng curl/HTTP đơn giản):
   - POST /iot/v1/telemetry    — gửi dữ liệu (kèm command đang chờ
                                  ở response để tiết kiệm round-trip).
   - GET  /iot/v1/commands     — kéo command pending.
   - POST /iot/v1/commands/:id/ack — báo kết quả lệnh.
   Auth: header X-Device-Key (SHA-256 hash so với device_key_hash).
   ========================================================== */
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { iotCommands } from "@erp-framework/db";
import { db } from "./db";
import { findDeviceByKey, insertTelemetry, type IotDevice } from "./iot-shared";

interface TelemetryBody {
  channel?: string;
  payload?: unknown;
  ts?: string;
  // Hoặc batch:
  items?: Array<{ channel?: string; payload?: unknown; ts?: string }>;
}

interface AckBody {
  status?: "ack" | "error";
  result?: unknown;
}

async function authDevice(req: { headers: Record<string, unknown> })
: Promise<IotDevice | null> {
  const raw = req.headers["x-device-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (typeof key !== "string" || !key) return null;
  return findDeviceByKey(key);
}

/** Lấy mảng command đang pending của device + đánh dấu sent. */
async function pullPendingCommands(device: IotDevice) {
  const cmds = await db.select().from(iotCommands).where(and(
    eq(iotCommands.deviceId, device.id),
    eq(iotCommands.status, "pending"),
  )).limit(20);
  if (cmds.length === 0) return [];
  const ids = cmds.map((c) => c.id);
  await db.update(iotCommands)
    .set({ status: "sent", sentAt: new Date() })
    .where(and(
      eq(iotCommands.deviceId, device.id),
      eq(iotCommands.status, "pending"),
    ));
  return cmds.map((c) => ({ id: c.id, payload: c.payload }))
    .filter((c) => ids.includes(c.id));
}

export async function registerIotRoutes(app: FastifyInstance): Promise<void> {
  /* POST /iot/v1/telemetry — nhận telemetry. Body có thể là một bản
     ghi {channel, payload, ts?} hoặc batch {items:[...]}. Trả về
     mảng commands đang pending để device xử lý ngay (piggyback). */
  app.post("/iot/v1/telemetry", async (req, reply) => {
    const device = await authDevice(req);
    if (!device) return reply.code(401).send({ error: "X-Device-Key sai" });
    const body = (req.body ?? {}) as TelemetryBody;
    const items = Array.isArray(body.items) ? body.items
      : (body.payload !== undefined
        ? [{ channel: body.channel, payload: body.payload, ts: body.ts }]
        : []);
    if (items.length === 0) {
      return reply.code(400).send({ error: "Thiếu payload hoặc items[]" });
    }
    await insertTelemetry(device, items);
    const commands = await pullPendingCommands(device);
    return { ok: true, accepted: items.length, commands };
  });

  /* GET /iot/v1/commands — kéo command pending. Cũng có thể dùng
     riêng nếu device chưa có gì để gửi. */
  app.get("/iot/v1/commands", async (req, reply) => {
    const device = await authDevice(req);
    if (!device) return reply.code(401).send({ error: "X-Device-Key sai" });
    const commands = await pullPendingCommands(device);
    return { commands };
  });

  /* POST /iot/v1/commands/:id/ack — báo kết quả lệnh. */
  app.post<{ Params: { id: string } }>(
    "/iot/v1/commands/:id/ack",
    async (req, reply) => {
      const device = await authDevice(req);
      if (!device) return reply.code(401).send({ error: "X-Device-Key sai" });
      const body = (req.body ?? {}) as AckBody;
      const status = body.status === "error" ? "error" : "ack";
      const [updated] = await db.update(iotCommands).set({
        status, result: (body.result ?? null) as Record<string, unknown> | null,
        ackedAt: new Date(),
      }).where(and(
        eq(iotCommands.id, req.params.id),
        eq(iotCommands.deviceId, device.id),
      )).returning({ id: iotCommands.id });
      if (!updated) return reply.code(404).send({ error: "Lệnh không tồn tại" });
      return { ok: true };
    },
  );
}
