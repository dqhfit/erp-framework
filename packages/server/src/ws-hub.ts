/* ==========================================================
   ws-hub.ts — In-process pub/sub + WebSocket hub.
   Mỗi connection subscribe theo channel string vd:
     "notifications:<userId>" — push notification mới cho user.
     "presence:<recordId>"    — broadcast presence update.
   Server code publish event qua publish(channel, payload).

   Hạn chế: single-process. Multi-node deploy cần Redis pub/sub
   (TODO v5). Đủ cho self-host hiện tại.
   ========================================================== */
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
export function registerConnection(
  ws: WsLike, userId: string, companyId: string,
): Connection {
  const conn: Connection = { ws, userId, companyId, channels: new Set() };
  connections.add(conn);
  ws.on("close", () => { connections.delete(conn); });
  return conn;
}

/** Subscribe connection vào channel. */
export function subscribe(conn: Connection, channel: string): void {
  conn.channels.add(channel);
}
export function unsubscribe(conn: Connection, channel: string): void {
  conn.channels.delete(channel);
}

/** Publish event lên 1 channel — broadcast cho mọi conn subscribe. */
export function publish(channel: string, payload: unknown): void {
  const msg = JSON.stringify({ channel, payload, ts: Date.now() });
  for (const c of connections) {
    if (!c.channels.has(channel)) continue;
    if (c.ws.readyState !== 1 /* OPEN */) continue;
    try { c.ws.send(msg); } catch { /* dead conn — sẽ close event xoá */ }
  }
}

/** Số conn hiện tại cho debug/health. */
export function getConnectionStats(): { total: number; channels: number } {
  let totalChannels = 0;
  for (const c of connections) totalChannels += c.channels.size;
  return { total: connections.size, channels: totalChannels };
}
