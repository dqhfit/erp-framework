/* ==========================================================
   useRealtime — Hook subscribe 1 WS channel trong vong doi component.
   `channel` = null → khong subscribe (vd chua chon hoi thoai).
   Callback luon goi ban moi nhat (qua ref) ma KHONG re-subscribe khi
   callback doi identity → tranh huy/lap subscribe moi render.
   ========================================================== */
import { useEffect, useRef } from "react";
import { subscribe } from "@/lib/realtime";

export function useChannel(
  channel: string | null | undefined,
  onMessage: (payload: unknown) => void,
): void {
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage;
  useEffect(() => {
    if (!channel) return;
    const unsub = subscribe(channel, (p) => cbRef.current(p));
    return unsub;
  }, [channel]);
}
