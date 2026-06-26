/* ==========================================================
   realtime.ts — 1 ket noi WebSocket dung chung cho ca app.
   Server /ws xac thuc qua cookie phien (sid). Client subscribe theo
   channel string (vd "chat:<id>", "chat-inbox:<userId>", "notifications:
   <userId>") va nhan payload qua callback. Tu re-subscribe khi reconnect.

   Dung singleton (module-level) vi chi can 1 socket / tab — moi noi goi
   subscribe() chia se chung ket noi. Server tu reject channel khong hop le.
   ========================================================== */

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();
let ws: WebSocket | null = null;
let isOpen = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false;

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function sendRaw(obj: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function scheduleReconnect(): void {
  if (reconnectTimer != null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (listeners.size > 0) ensureConnected();
  }, 3000);
}

function ensureConnected(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  intentionalClose = false;
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    isOpen = true;
    // Re-subscribe moi channel dang co listener (sau reconnect).
    for (const ch of listeners.keys()) sendRaw({ action: "subscribe", channel: ch });
  };
  ws.onmessage = (ev) => {
    try {
      const { channel, payload } = JSON.parse(ev.data as string) as {
        channel: string;
        payload: unknown;
      };
      const set = listeners.get(channel);
      if (set) {
        for (const cb of set) {
          try {
            cb(payload);
          } catch {
            /* listener loi — bo qua, khong vo cac listener khac */
          }
        }
      }
    } catch {
      /* message khong phai JSON hop le — bo qua */
    }
  };
  ws.onclose = () => {
    isOpen = false;
    ws = null;
    if (!intentionalClose) scheduleReconnect();
  };
  ws.onerror = () => {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  };
}

/** Subscribe vao 1 channel. Tra ve ham unsubscribe. */
export function subscribe(channel: string, cb: Listener): () => void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(cb);
  ensureConnected();
  if (isOpen) sendRaw({ action: "subscribe", channel });
  return () => {
    const s = listeners.get(channel);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) {
      listeners.delete(channel);
      if (isOpen) sendRaw({ action: "unsubscribe", channel });
    }
  };
}

/** Dong ket noi + xoa listener (vd khi logout). */
export function closeRealtime(): void {
  intentionalClose = true;
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  ws = null;
  isOpen = false;
  listeners.clear();
}
