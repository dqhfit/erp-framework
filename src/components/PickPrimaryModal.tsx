import { I } from "@/components/Icons";
import { Button, Chip } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useUserObjects } from "@/stores/userObjects";
/* ==========================================================
   PickPrimaryModal — Chọn "Agent chính" của user hiện tại.
   ────────────────────────────────────────────────────────────
   - KHÔNG tự bung onboarding; chỉ mở khi user click Topbar chip
     "Chưa chọn Agent chính" hoặc nút "Đổi agent chính" trong
     Settings → Agent của tôi.
   - List agent của công ty đang chọn (qua useUserObjects). CEO
     được pin lên đầu (recommended).
   - 1-click chọn → gọi useAuth.setPrimary → đóng modal.
   - "Bỏ chọn" hiển thị khi user đang có primary — xoá liên kết.
   ========================================================== */
import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PickPrimaryModal({ open, onClose }: Props) {
  const allAgents = useUserObjects((s) => s.agents);
  const primaryAgentId = useAuth((s) => s.primaryAgentId);
  const myAgentRoles = useAuth((s) => s.myAgentRoles);
  const setPrimary = useAuth((s) => s.setPrimary);
  const [busy, setBusy] = useState<string | null>(null);

  // Sắp CEO trước, sau đó my-agent, rồi rest.
  const ordered = [...allAgents].sort((a, b) => {
    const aIsCeo = a.name.toLowerCase() === "ceo" ? 0 : 1;
    const bIsCeo = b.name.toLowerCase() === "ceo" ? 0 : 1;
    if (aIsCeo !== bIsCeo) return aIsCeo - bIsCeo;
    const aMine = myAgentRoles[a.id] ? 0 : 1;
    const bMine = myAgentRoles[b.id] ? 0 : 1;
    return aMine - bMine;
  });

  const pick = async (id: string | null) => {
    setBusy(id ?? "__clear__");
    try {
      await setPrimary(id);
      onClose();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Chọn Agent chính của bạn" width={520}>
      <div className="text-sm text-muted mb-3">
        Agent chính sẽ tự động được mở khi bạn vào ô chat (Cmd-K hoặc Topbar). Bạn có thể đổi bất cứ
        lúc nào.
      </div>
      <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
        {ordered.length === 0 && (
          <div className="text-sm text-muted text-center py-6">
            Công ty chưa có agent nào. Tạo một agent từ Sidebar → Agents trước.
          </div>
        )}
        {ordered.map((a) => {
          const isCeo = a.name.toLowerCase() === "ceo";
          const isPrimary = a.id === primaryAgentId;
          const role = myAgentRoles[a.id];
          return (
            <button
              key={a.id}
              type="button"
              disabled={busy !== null}
              onClick={() => pick(a.id)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-md border text-left transition-colors",
                isPrimary ? "border-accent bg-accent/10" : "border-border hover:bg-hover/40",
                busy === a.id && "opacity-60",
              )}
            >
              <span className="w-7 h-7 rounded-md flex items-center justify-center bg-bg-soft text-accent shrink-0">
                <I.Bot size={14} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-1.5">
                  {a.name}
                  {isCeo && (
                    <Chip className="!h-[16px] !text-[9px]" variant="accent">
                      CEO
                    </Chip>
                  )}
                  {isPrimary && (
                    <Chip className="!h-[16px] !text-[9px]" variant="success">
                      đang chọn
                    </Chip>
                  )}
                  {role && !isPrimary && <Chip className="!h-[16px] !text-[9px]">{role}</Chip>}
                </div>
                <div className="text-xs text-muted truncate font-mono">{a.model}</div>
              </div>
              {isPrimary ? (
                <I.Check size={14} className="text-accent shrink-0" />
              ) : (
                <I.ChevronRight size={14} className="text-muted shrink-0" />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        {primaryAgentId ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => pick(null)}
            icon={
              busy === "__clear__" ? (
                <I.Loader size={11} className="animate-spin" />
              ) : (
                <I.X size={11} />
              )
            }
          >
            Bỏ chọn agent chính
          </Button>
        ) : (
          <span />
        )}
        <Button variant="default" size="sm" onClick={onClose}>
          Đóng
        </Button>
      </div>
    </Modal>
  );
}
