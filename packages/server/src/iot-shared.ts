/* ==========================================================
   iot-shared.ts — Tiện ích dùng chung cho module IoT:
   sinh/băm device key, tra cứu thiết bị, chèn telemetry, kích
   hoạt workflow có trigger `iot_telemetry` khớp filter.
   Dùng từ cả REST (/iot/v1) lẫn MQTT subscriber.
   ========================================================== */
import crypto from "node:crypto";
import { and, eq, type InferSelectModel } from "drizzle-orm";
import { iotDevices, iotTelemetry, workflows } from "@erp-framework/db";
import { db } from "./db";
import { enqueueWorkflowRun } from "./jobs";

export type IotDevice = InferSelectModel<typeof iotDevices>;

/** Sinh device key 32-byte ngẫu nhiên → hex 64 ký tự. */
export function newDeviceKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** SHA-256(hex) của device key — chỉ hash lưu trong DB. */
export function hashDeviceKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** Tra thiết bị theo key thô (auth). Null nếu key không khớp. */
export async function findDeviceByKey(key: string): Promise<IotDevice | null> {
  if (!key) return null;
  const h = hashDeviceKey(key);
  const [d] = await db.select().from(iotDevices)
    .where(eq(iotDevices.deviceKeyHash, h));
  return d ?? null;
}

interface TelemetryItem {
  channel?: string;
  payload?: unknown;
  ts?: string | Date;
}

/** Chèn 1+ bản ghi telemetry, cập nhật last_seen_at, kích hoạt workflow. */
export async function insertTelemetry(
  device: IotDevice,
  items: TelemetryItem[],
): Promise<void> {
  if (items.length === 0) return;
  const rows = items.map((it) => ({
    companyId: device.companyId,
    deviceId: device.id,
    channel: it.channel ?? "default",
    payload: (it.payload ?? {}) as Record<string, unknown>,
    ts: it.ts ? new Date(it.ts) : new Date(),
  }));
  await db.insert(iotTelemetry).values(rows);
  await db.update(iotDevices)
    .set({ lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(iotDevices.id, device.id));
  // Workflow trigger — fire-and-forget; lỗi không chặn nhận telemetry.
  for (const row of rows) {
    triggerIotWorkflows(device, row).catch((e) =>
      console.error("[iot] trigger workflow lỗi:", e));
  }
}

/** Quét workflow có triggerType='iot_telemetry' khớp filter & enqueue. */
async function triggerIotWorkflows(
  device: IotDevice,
  telemetry: { channel: string; payload: Record<string, unknown>; ts: Date },
): Promise<void> {
  const list = await db.select().from(workflows).where(and(
    eq(workflows.companyId, device.companyId),
    eq(workflows.triggerType, "iot_telemetry"),
    eq(workflows.isActive, true),
  ));
  for (const wf of list) {
    const cfg = (wf.triggerConfig ?? {}) as {
      deviceId?: string; channel?: string;
    };
    if (cfg.deviceId && cfg.deviceId !== device.id) continue;
    if (cfg.channel && cfg.channel !== telemetry.channel) continue;
    await enqueueWorkflowRun(wf.id, {
      iot: {
        device: { id: device.id, name: device.name },
        channel: telemetry.channel,
        payload: telemetry.payload,
        ts: telemetry.ts.toISOString(),
      },
    });
  }
}
