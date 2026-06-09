/* ==========================================================
   iot-mqtt.ts — Tích hợp MQTT (Mosquitto):
   - Server kết nối broker như MỘT client (cred từ env MQTT_*).
   - Subscribe iot/+/telemetry/+  → chèn telemetry + kích hoạt workflow.
   - Subscribe iot/+/ack/+        → cập nhật iot_commands.
   - publishCommand(...)          → gửi lệnh xuống iot/<deviceId>/cmd/<cmdId>.
   Topic dùng deviceId (UUID) — KHÔNG dùng device key thô (key chỉ
   ở dạng hash trong DB). Device khi đăng ký nhận về cả deviceId
   lẫn deviceKey; dùng deviceId làm topic ID + deviceKey làm MQTT
   username/password (mặc định cùng cred chia sẻ ở MVP).
   Nếu MQTT_URL không khai báo, module này không bật — REST vẫn chạy.
   ========================================================== */
import { connect, type MqttClient } from "mqtt";
import { and, eq } from "drizzle-orm";
import { iotCommands, iotDevices } from "@erp-framework/db";
import { db } from "./db";
import { hashDeviceKey, insertTelemetry, type IotDevice } from "./iot-shared";

let client: MqttClient | null = null;

/** Bật xác thực device-key cho MQTT ingest (payload JSON phải kèm `key` khớp
 *  device_key_hash). MẶC ĐỊNH TẮT để không vỡ firmware cũ — bật sau khi
 *  firmware gửi kèm key. Xem audit MQTT device-auth. */
const REQUIRE_DEVICE_KEY =
  process.env.IOT_MQTT_REQUIRE_KEY === "1" || process.env.IOT_MQTT_REQUIRE_KEY === "true";

/** Khởi tạo MQTT client. No-op nếu MQTT_URL không đặt. */
export async function startIotMqtt(): Promise<void> {
  const url = process.env.MQTT_URL;
  if (!url) {
    console.log("[iot-mqtt] MQTT_URL không đặt — bỏ qua MQTT bridge.");
    return;
  }
  client = connect(url, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    reconnectPeriod: 5000,
    clientId: `erp-server-${process.pid}`,
  });

  client.on("connect", () => {
    console.log("[iot-mqtt] đã kết nối", url);
    client?.subscribe(["iot/+/telemetry/+", "iot/+/ack/+"], (err) => {
      if (err) console.error("[iot-mqtt] subscribe lỗi:", err);
    });
  });
  client.on("error", (e) => console.error("[iot-mqtt] lỗi:", e.message));
  client.on("message", (topic, buf) => {
    void handleMessage(topic, buf).catch((e) => console.error("[iot-mqtt] message lỗi:", e));
  });
}

export async function stopIotMqtt(): Promise<void> {
  if (client) {
    await new Promise<void>((r) => client!.end(false, {}, () => r()));
    client = null;
  }
}

async function findDeviceById(id: string): Promise<IotDevice | null> {
  const [d] = await db.select().from(iotDevices).where(eq(iotDevices.id, id));
  return d ?? null;
}

async function handleMessage(topic: string, buf: Buffer): Promise<void> {
  // iot/<deviceId>/telemetry/<channel>  hoặc  iot/<deviceId>/ack/<cmdId>
  const parts = topic.split("/");
  if (parts.length !== 4 || parts[0] !== "iot") return;
  const [, deviceId, kind, tail] = parts;
  if (!deviceId || !kind || !tail) return;
  const device = await findDeviceById(deviceId);
  if (!device) return; // không có thiết bị → bỏ qua (kẻ lạ publish).

  let payload: unknown;
  try {
    payload = JSON.parse(buf.toString("utf8"));
  } catch {
    payload = buf.toString("utf8");
  }

  // Xác thực thiết bị (MQTT không có header X-Device-Key như REST): khi bật,
  // payload PHẢI là object chứa `key` khớp device_key_hash. Tách key khỏi
  // payload trước khi dùng (tránh rò khoá vào telemetry lưu trữ).
  if (REQUIRE_DEVICE_KEY) {
    const obj =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const key = obj && typeof obj.key === "string" ? obj.key : null;
    if (!key || hashDeviceKey(key) !== device.deviceKeyHash) {
      console.warn(`[iot-mqtt] từ chối ${deviceId}/${kind}: thiếu/sai device key`);
      return;
    }
    const { key: _omit, ...rest } = obj as Record<string, unknown>;
    payload = rest;
  }

  if (kind === "telemetry") {
    await insertTelemetry(device, [{ channel: tail, payload }]);
    return;
  }
  if (kind === "ack") {
    const body = (payload && typeof payload === "object" ? payload : {}) as {
      status?: string;
      result?: unknown;
    };
    const status = body.status === "error" ? "error" : "ack";
    await db
      .update(iotCommands)
      .set({
        status,
        result: (body.result ?? null) as Record<string, unknown> | null,
        ackedAt: new Date(),
      })
      .where(and(eq(iotCommands.id, tail), eq(iotCommands.deviceId, deviceId)));
  }
}

/** Gửi lệnh xuống thiết bị qua MQTT. No-op nếu MQTT chưa kết nối. */
export function publishCommand(deviceId: string, commandId: string, payload: unknown): void {
  if (!client || !client.connected) return;
  const topic = `iot/${deviceId}/cmd/${commandId}`;
  client.publish(topic, JSON.stringify(payload), { qos: 1 });
}
