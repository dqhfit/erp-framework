/* ==========================================================
   NotificationBell — chuông thông báo in-app (per-user).
   Badge số chưa đọc (poll 30s) + dropdown danh sách; click item ->
   markRead + đi tới targetUrl (nếu có); nút "đánh dấu đã đọc tất cả".
   Tự chứa (createObjectsClient) — dùng được ở portal lẫn topbar.
   ========================================================== */
import { createObjectsClient } from "@erp-framework/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { useChannel } from "@/hooks/useRealtime";
import { useT } from "@/hooks/useT";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";

const api = createObjectsClient("");

interface NotiRow {
  id: string;
  kind: string;
  body: string;
  targetUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

/** CHỈ điều hướng tới đường dẫn NỘI BỘ same-origin (bắt đầu "/" nhưng không
 *  "//"). Notification targetUrl trong hệ thống luôn là link nội bộ → chặn MỌI
 *  URL tuyệt đối: diệt open-redirect (http(s) ngoài miền, "//host" protocol-
 *  relative) lẫn XSS (javascript:/data:/vbscript:). targetUrl có thể bắt nguồn
 *  từ nội dung người dùng (vd @mention) nên không tin tuyệt đối. */
function safeNavigate(url: string): void {
  if (url.startsWith("/") && !url.startsWith("//")) window.location.assign(url);
}

export function NotificationBell() {
  const t = useT();
  const me = useAuth((s) => s.user?.id) ?? "";
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<NotiRow[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const loadCount = useCallback(() => {
    api.notifications
      .unreadCount()
      .then((r) => setCount((r as { count: number }).count))
      .catch(() => {
        /* chưa đăng nhập / lỗi mạng — giữ count cũ */
      });
  }, []);
  const loadList = useCallback(() => {
    api.notifications
      .list({ limit: 30 })
      .then((rows) => setItems(rows as NotiRow[]))
      .catch(() => {
        /* bỏ qua */
      });
  }, []);

  // Poll số chưa đọc mỗi 30s (fallback khi WS rớt / chưa kết nối).
  useEffect(() => {
    loadCount();
    const id = setInterval(loadCount, 30_000);
    return () => clearInterval(id);
  }, [loadCount]);

  // Realtime: server push notification mới → tăng badge ngay (prepend nếu đang mở).
  useChannel(me ? `notifications:${me}` : null, (payload) => {
    const p = payload as { type?: string; notification?: NotiRow };
    if (p.type !== "new" || !p.notification) return;
    setCount((c) => c + 1);
    setItems((xs) =>
      xs.some((x) => x.id === p.notification?.id) ? xs : [p.notification as NotiRow, ...xs],
    );
  });

  // Đóng dropdown khi click ra ngoài.
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadList();
  };

  const onItem = async (n: NotiRow) => {
    if (!n.readAt) {
      try {
        await api.notifications.markRead(n.id);
      } catch {
        /* best-effort */
      }
      setItems((xs) =>
        xs.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
      );
      loadCount();
    }
    if (n.targetUrl) safeNavigate(n.targetUrl);
  };

  const markAll = async () => {
    try {
      await api.notifications.markAllRead();
    } catch {
      /* best-effort */
    }
    setItems((xs) => xs.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
    setCount(0);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        title={t("topbar.notifications")}
        className="relative w-8 h-8 rounded flex items-center justify-center text-muted hover:text-text hover:bg-hover/60 transition-colors"
      >
        <I.Bell size={15} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-danger text-white text-[9px] font-bold flex items-center justify-center">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] rounded-lg border border-border bg-panel shadow-lg z-[700] overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <span className="text-sm font-semibold flex-1">Thông báo</span>
            {items.some((x) => !x.readAt) && (
              <button
                type="button"
                onClick={markAll}
                className="text-[11px] text-accent hover:underline"
              >
                Đánh dấu đã đọc tất cả
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted">Chưa có thông báo</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItem(n)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 flex gap-2 hover:bg-hover/40 transition-colors",
                    !n.readAt && "bg-accent/5",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1 w-1.5 h-1.5 rounded-full shrink-0",
                      n.readAt ? "bg-transparent" : "bg-accent",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs leading-snug">{n.body}</div>
                    <div className="text-[10px] text-muted mt-0.5">{timeAgo(n.createdAt)}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
