/* ==========================================================
   ws-hub.ts — Pub/sub + WebSocket hub.
   Mỗi connection subscribe theo channel string vd:
     "notifications:<userId>" — push notification mới cho user.
     "presence:<recordId>"    — broadcast presence update.
   Server code publish event qua publish(channel, payload).

   Multi-node (v5): nếu REDIS_URL env set, fan out qua Redis Pub/Sub
   channel "erp:ws" — mọi node receive event và broadcast cho client
   local. Single-node fallback giữ nguyên in-process.
   ========================================================== */
import Redis from "ioredis";
/** Minimal WebSocket-like type — chỉ method/prop chúng ta dùng. Tránh
 *  phụ thuộc @types/ws (peer của @fastify/websocket nhưng không cần
 *  riêng vì plugin tự re-export interface). */
interface WsLike {
  readyState: number;
  send(data: string): void;
  on(event: "close", cb: () => void): void;
}

interface Connection {
  ws: WsLike;
  channels: Set<string>;
  userId: string;
  companyId: string;
}

const connections = new Set<Connection>();

/** Đăng ký 1 connection mới — caller tự set userId từ session auth. */
export function registerConnection(ws: WsLike, userId: string, companyId: string): Connection {
  const conn: Connection = { ws, userId, companyId, channels: new Set() };
  connections.add(conn);
  ws.on("close", () => {
    connections.delete(conn);
  });
  return conn;
}

/** Subscribe connection vào channel. */
export function subscribe(conn: Connection, channel: string): void {
  conn.channels.add(channel);
}
export function unsubscribe(conn: Connection, channel: string): void {
  conn.channels.delete(channel);
}

/** Broadcast cho mọi local conn subscribe channel (không qua Redis). */
function broadcastLocal(channel: string, msg: string): void {
  for (const c of connections) {
    if (!c.channels.has(channel)) continue;
    if (c.ws.readyState !== 1 /* OPEN */) continue;
    try {
      c.ws.send(msg);
    } catch {
      /* dead conn — close event sẽ xoá */
    }
  }
}

/* Redis Pub/Sub bridge — 2 client (pub + sub) vì ioredis subscribe mode
   không gửi command khác được. Channel cố định "erp:ws"; message format
   { channel, payload, ts } JSON. Mọi node receive → broadcast local. */
const REDIS_URL = process.env.REDIS_URL;
const REDIS_CHANNEL = "erp:ws";
let pubClient: Redis | null = null;
let subClient: Redis | null = null;
if (REDIS_URL) {
  try {
    pubClient = new Redis(REDIS_URL, { lazyConnect: false });
    subClient = new Redis(REDIS_URL, { lazyConnect: false });
    subClient
      .subscribe(REDIS_CHANNEL)
      .catch((e) => console.error("[ws-hub] Redis subscribe lỗi:", e.message));
    subClient.on("message", (_ch, raw) => {
      try {
        const { channel } = JSON.parse(raw) as { channel: string };
        // Broadcast local — message đã serialized sẵn.
        broadcastLocal(channel, raw);
      } catch {
        /* malformed — ignore */
      }
    });
    pubClient.on("error", (e) => console.error("[ws-hub] Redis pub lỗi:", e.message));
    subClient.on("error", (e) => console.error("[ws-hub] Redis sub lỗi:", e.message));
    console.log("[ws-hub] Redis pub/sub enabled →", REDIS_URL);
  } catch (e) {
    console.error("[ws-hub] Redis init lỗi, fallback single-node:", (e as Error).message);
    pubClient = null;
    subClient = null;
  }
}

/* ─── Internal subscribers (server-side, cùng process) ──
   Cho phép GraphQL subscriptions / workflow triggers bind vào event
   channel mà không qua WebSocket. Callback chạy đồng bộ trong publish. */
const internalSubs = new Map<string, Set<(payload: unknown) => void>>();
export function subscribeChannel(channel: string, cb: (payload: unknown) => void): void {
  let set = internalSubs.get(channel);
  if (!set) {
    set = new Set();
    internalSubs.set(channel, set);
  }
  set.add(cb);
}
export function unsubscribeChannel(channel: string, cb: (payload: unknown) => void): void {
  const set = internalSubs.get(channel);
  if (set) {
    set.delete(cb);
    if (set.size === 0) internalSubs.delete(channel);
  }
}

/** Publish event lên 1 channel. Nếu Redis enabled, broadcast qua Redis
 *  (mọi node receive); ngược lại chỉ broadcast local. Cũng dispatch cho
 *  internal subscribers (GraphQL subscriptions, workflow triggers). */
export function publish(channel: string, payload: unknown): void {
  const msg = JSON.stringify({ channel, payload, ts: Date.now() });
  if (pubClient) {
    pubClient
      .publish(REDIS_CHANNEL, msg)
      .catch((e) => console.error("[ws-hub] Redis publish lỗi:", e.message));
  } else {
    broadcastLocal(channel, msg);
  }
  const subs = internalSubs.get(channel);
  if (subs) {
    for (const cb of subs) {
      try {
        cb(payload);
      } catch (e) {
        console.error("[ws-hub] internal sub cb lỗi:", (e as Error).message);
      }
    }
  }
}

/** userId đang online (có ít nhất 1 connection) trong 1 công ty. Dùng cho
 *  presence chat. LƯU Ý: chỉ thấy connection của NODE NÀY — multi-node
 *  (Redis) mỗi node giữ set riêng; presence dạng poll vẫn chấp nhận được
 *  cho MVP (single-node là use case chính). */
export function getOnlineUserIds(companyId: string): string[] {
  const set = new Set<string>();
  for (const c of connections) if (c.companyId === companyId) set.add(c.userId);
  return [...set];
}

/** Số conn hiện tại cho debug/health. */
export function getConnectionStats(): { total: number; channels: number } {
  let totalChannels = 0;
  for (const c of connections) totalChannels += c.channels.size;
  return { total: connections.size, channels: totalChannels };
}
