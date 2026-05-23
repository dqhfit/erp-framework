/* ==========================================================
   /settings/agents — "Agent của tôi" tập trung tại đây.
   ────────────────────────────────────────────────────────────
   - Card 1: Agent chính (primary) + nút đổi (mở PickPrimaryModal).
   - Card 2: Bảng các agent user đang là thành viên + role + link mở.
   - Card 3: Tạo agent mới (link sang Sidebar action).
   ========================================================== */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Chip, EmptyState } from "@/components/ui";
import { I } from "@/components/Icons";
import { useAuth } from "@/stores/auth";
import { useUserObjects } from "@/stores/userObjects";
import { PickPrimaryModal } from "@/components/PickPrimaryModal";

function SettingsAgents() {
  const primaryAgentId = useAuth((s) => s.primaryAgentId);
  const myAgentRoles = useAuth((s) => s.myAgentRoles);
  const setPrimary = useAuth((s) => s.setPrimary);
  const allAgents = useUserObjects((s) => s.agents);
  const navigate = useNavigate();
  const [pickOpen, setPickOpen] = useState(false);

  const primaryAgent = primaryAgentId
    ? allAgents.find((a) => a.id === primaryAgentId) ?? null
    : null;

  const myAgents = allAgents
    .filter((a) => myAgentRoles[a.id])
    .map((a) => ({ ...a, role: myAgentRoles[a.id]! }));

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-8 space-y-4">
        <h1 className="text-xl font-semibold mb-1">Agent của tôi</h1>
        <div className="text-sm text-muted mb-6">
          Đặt agent chính bạn hay làm việc cùng và quản lý các agent mà bạn là thành viên.
          Khi chưa đặt, app vẫn dùng được — Topbar/AgentPanel sẽ ưu tiên CEO mặc định của công ty.
        </div>

        {/* === Card Agent chính === */}
        <Card>
          <div className="flex items-center gap-3">
            {primaryAgent ? (
              <>
                <span className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0"
                  style={{ background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))" }}>
                  <I.Bot size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted">Agent chính</div>
                  <div className="font-semibold truncate">{primaryAgent.name}</div>
                  <div className="text-xs text-muted font-mono truncate">{primaryAgent.model}</div>
                </div>
                <Button variant="default" size="sm"
                  onClick={() => navigate({ to: "/agents/$id", params: { id: primaryAgent.id } })}>
                  Mở
                </Button>
                <Button variant="ghost" size="sm" icon={<I.Edit size={12} />}
                  onClick={() => setPickOpen(true)}>
                  Đổi
                </Button>
                <Button variant="ghost" size="sm" icon={<I.X size={12} />}
                  onClick={() => { void setPrimary(null); }}
                  title="Bỏ chọn">
                  Bỏ chọn
                </Button>
              </>
            ) : (
              <>
                <span className="w-10 h-10 rounded-lg flex items-center justify-center bg-bg-soft text-muted border border-dashed border-border shrink-0">
                  <I.Bot size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted">Agent chính</div>
                  <div className="text-sm text-muted">Chưa chọn — app dùng CEO của công ty làm assistant mặc định.</div>
                </div>
                <Button variant="primary" size="sm" icon={<I.Sparkles size={12} />}
                  onClick={() => setPickOpen(true)}>
                  Chọn Agent chính
                </Button>
              </>
            )}
          </div>
        </Card>

        {/* === Card Agent đang quản === */}
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">
              Agent tôi quản ({myAgents.length})
            </div>
            <span className="text-xs text-muted">Mở từng agent qua Sidebar →</span>
          </div>
          {myAgents.length === 0 ? (
            <EmptyState
              title="Bạn chưa được gán làm thành viên của agent nào"
              hint="Khi bạn tạo agent mới, bạn tự động trở thành owner. Nhờ admin thêm bạn vào các agent có sẵn."
              icon={<I.Users size={28} className="text-muted" />}
            />
          ) : (
            <div className="space-y-1">
              {myAgents.map((a) => (
                <div key={a.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded border border-border hover:bg-hover/40 transition-colors">
                  <span className="w-7 h-7 rounded-md flex items-center justify-center bg-bg-soft text-accent shrink-0">
                    <I.Bot size={12} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-1.5">
                      {a.name}
                      {a.id === primaryAgentId && (
                        <Chip className="!h-[16px] !text-[9px]" variant="success">chính</Chip>
                      )}
                    </div>
                    <div className="text-xs text-muted truncate font-mono">{a.model}</div>
                  </div>
                  <Chip className="!text-[10px]">{a.role}</Chip>
                  <Button variant="ghost" size="sm"
                    onClick={() => navigate({ to: "/agents/$id", params: { id: a.id } })}
                    icon={<I.ChevronRight size={12} />}
                    title="Mở agent" />
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="text-[11px] text-muted">
          Quyền chi tiết: <strong>owner</strong> = toàn quyền + quản thành viên + xoá; <strong>operator</strong> = chat + edit cấu hình; <strong>observer</strong> = chỉ xem + chat. Có thể đổi/gỡ ở tab "Thành viên" của trang agent (chỉ owner).
        </div>

        <PickPrimaryModal open={pickOpen} onClose={() => setPickOpen(false)} />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/agents")({ component: SettingsAgents });
