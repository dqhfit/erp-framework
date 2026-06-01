/* ==========================================================
   AgentSearchableToggle — bật/tắt cho phép agent tra cứu entity này
   qua tool records_search (Agentic RAG P3). Deny-by-default: tắt =
   agent KHÔNG truy được dữ liệu entity.

   Tự chứa: đọc trạng thái qua entities.get + ghi qua
   entities.setAgentSearchable, KHÔNG đi qua store/save của EntityDesigner
   (tránh phụ thuộc ánh xạ meta của MockEntity).
   ========================================================== */
import { createObjectsClient } from "@erp-framework/client";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const api = createObjectsClient("");

export function AgentSearchableToggle({ entityId }: { entityId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null); // null = đang tải
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.entities
      .get(entityId)
      .then((row) => {
        if (!alive) return;
        const meta = (row?.meta ?? {}) as { agentSearchable?: boolean };
        setEnabled(meta.agentSearchable === true);
      })
      .catch(() => alive && setEnabled(false));
    return () => {
      alive = false;
    };
  }, [entityId]);

  const toggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    const prev = enabled;
    setEnabled(next); // optimistic
    try {
      await api.entities.setAgentSearchable(entityId, next);
    } catch (e) {
      setEnabled(prev ?? false); // rollback
      dialog.alert(`Không cập nhật được: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-md border border-border p-3">
      <Switch
        checked={enabled === true}
        onChange={toggle}
        disabled={enabled === null || busy}
        label="Cho phép agent tra cứu (records_search)"
      />
      <p className="mt-1 text-[11px] text-muted">
        Khi bật, trợ lý AI được phép tìm bản ghi của entity này để trả lời. Mặc định tắt — dữ liệu
        nhạy cảm nên chỉ bật khi cần.
      </p>
    </div>
  );
}
