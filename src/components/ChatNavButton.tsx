/* ==========================================================
   ChatNavButton — nut mo /chat tren topbar + badge tong tin chua doc.
   Cap nhat real-time qua kenh "chat-inbox:<me>" (fallback poll 60s).
   ========================================================== */
import { createChatClient } from "@erp-framework/client";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { useChannel } from "@/hooks/useRealtime";
import { useAuth } from "@/stores/auth";

const chat = createChatClient("");

export function ChatNavButton() {
  const me = useAuth((s) => s.user?.id) ?? "";
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  const load = useCallback(() => {
    chat
      .unreadTotal()
      .then((r) => setCount(r.count))
      .catch(() => {
        /* chua dang nhap / loi mang — giu count cu */
      });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Tin moi / hoi thoai moi → cap nhat badge ngay.
  useChannel(me ? `chat-inbox:${me}` : null, () => load());

  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/chat" })}
      title="Tin nhắn nội bộ"
      className="relative w-8 h-8 rounded flex items-center justify-center text-muted hover:text-text hover:bg-hover/60 transition-colors"
    >
      <I.MessageSquare size={15} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
