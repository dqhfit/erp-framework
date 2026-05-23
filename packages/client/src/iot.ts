/* ==========================================================
   iot.ts — Client cho module IoT. Bọc router iot.* của
   @erp-framework/server (admin/quản trị).
   ========================================================== */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@erp-framework/server";

function makeTrpc(baseUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: baseUrl.replace(/\/$/, "") + "/trpc",
      fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
    })],
  });
}

export interface IotDevice {
  id: string;
  name: string;
  label: string | null;
  meta: Record<string, unknown>;
  lastSeenAt: string | Date | null;
  createdAt: string | Date;
}

export interface IotTelemetryRow {
  id: string;
  deviceId: string;
  channel: string;
  payload: Record<string, unknown>;
  ts: string | Date;
}

export interface IotCommandRow {
  id: string;
  deviceId: string;
  payload: Record<string, unknown>;
  status: "pending" | "sent" | "ack" | "error";
  result: Record<string, unknown> | null;
  sentAt: string | Date | null;
  ackedAt: string | Date | null;
  createdAt: string | Date;
}

export function createIotClient(baseUrl: string) {
  const trpc = makeTrpc(baseUrl);
  return {
    devices: {
      list: () => trpc.iot.devices.list.query(),
      // Tạo thiết bị — server trả về cả `device` và `key` (raw, hiện 1 lần).
      create: (input: { name: string; label?: string; meta?: Record<string, unknown> }) =>
        trpc.iot.devices.create.mutate(input),
      delete: (id: string) => trpc.iot.devices.delete.mutate(id),
      rotateKey: (id: string) => trpc.iot.devices.rotateKey.mutate(id),
    },
    telemetry: {
      list: (input: {
        deviceId?: string;
        channel?: string;
        from?: string;
        to?: string;
        limit?: number;
      }) => trpc.iot.telemetry.list.query(input),
      summary: (deviceId: string) =>
        trpc.iot.telemetry.summary.query({ deviceId }),
    },
    commands: {
      queue: (deviceId: string, payload: Record<string, unknown>) =>
        trpc.iot.commands.queue.mutate({ deviceId, payload }),
      list: (deviceId: string, limit?: number) =>
        trpc.iot.commands.list.query({ deviceId, limit: limit ?? 50 }),
      cancel: (id: string) => trpc.iot.commands.cancel.mutate(id),
    },
  };
}

export type IotClient = ReturnType<typeof createIotClient>;
