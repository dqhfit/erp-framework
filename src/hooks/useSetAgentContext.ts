import { useEffect } from "react";
import type { AgentObjectContext } from "@/stores/ui";
import { useUI } from "@/stores/ui";

/**
 * Route gọi hook này để thông báo AgentPanel đang xem đối tượng nào.
 * Tự xoá context khi route unmount.
 */
export function useSetAgentContext(ctx: AgentObjectContext | null) {
  const set = useUI((s) => s.setAgentContext);
  useEffect(() => {
    set(ctx);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.type, ctx?.id, ctx?.label]);
}
