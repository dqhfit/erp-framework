import { useEffect } from "react";
import type { AgentObjectContext } from "@/stores/ui";
import { useUI } from "@/stores/ui";

/**
 * Route gọi hook này để thông báo AgentPanel đang xem đối tượng nào.
 * Tự xoá context khi route unmount.
 */
export function useSetAgentContext(ctx: AgentObjectContext | null) {
  const set = useUI((s) => s.setAgentContext);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy lại khi nhận dạng context (type/id/label) đổi; set là stable, ctx object thay đổi ref mỗi render nên không đưa vào deps
  useEffect(() => {
    set(ctx);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.type, ctx?.id, ctx?.label]);
}
