import { I } from "@/components/Icons";
import { PickPrimaryModal } from "@/components/PickPrimaryModal";
import { Button, Card, Chip, EmptyState } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { useAuth } from "@/stores/auth";
import { useUserObjects } from "@/stores/userObjects";
/* ==========================================================
   /settings/agents — "Agent của tôi" tập trung tại đây.
   ────────────────────────────────────────────────────────────
   - Card 1: Agent chính (primary) + nút đổi (mở PickPrimaryModal).
   - Card 2: Bảng các agent user đang là thành viên + role + link mở.
   - Card 3: Tạo agent mới (link sang Sidebar action).
   ========================================================== */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

function SettingsAgents() {
  const t = useT();
  const primaryAgentId = useAuth((s) => s.primaryAgentId);
  const myAgentRoles = useAuth((s) => s.myAgentRoles);
  const setPrimary = useAuth((s) => s.setPrimary);
  const allAgents = useUserObjects((s) => s.agents);
  const navigate = useNavigate();
  const [pickOpen, setPickOpen] = useState(false);

  const primaryAgent = primaryAgentId
    ? (allAgents.find((a) => a.id === primaryAgentId) ?? null)
    : null;

  const myAgents = allAgents
    .filter((a) => myAgentRoles[a.id])
    .map((a) => ({ ...a, role: myAgentRoles[a.id]! }));

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-8 space-y-4">
        <h1 className="text-xl font-semibold mb-1">{t("settings.agents.title")}</h1>
        <div className="text-sm text-muted mb-6">
          {t("settings.agents.subtitle")}
        </div>

        {/* === Card Agent chính === */}
        <Card>
          <div className="flex items-center gap-3">
            {primaryAgent ? (
              <>
                <span
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
                  }}
                >
                  <I.Bot size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted">{t("settings.agents.primary_label")}</div>
                  <div className="font-semibold truncate">{primaryAgent.name}</div>
                  <div className="text-xs text-muted font-mono truncate">{primaryAgent.model}</div>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => navigate({ to: "/agents/$id", params: { id: primaryAgent.id } })}
                >
                  {t("settings.agents.open_btn")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<I.Edit size={12} />}
                  onClick={() => setPickOpen(true)}
                >
                  {t("settings.agents.change_btn")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<I.X size={12} />}
                  onClick={() => {
                    void setPrimary(null);
                  }}
                  title={t("settings.agents.deselect_btn")}
                >
                  {t("settings.agents.deselect_btn")}
                </Button>
              </>
            ) : (
              <>
                <span className="w-10 h-10 rounded-lg flex items-center justify-center bg-bg-soft text-muted border border-dashed border-border shrink-0">
                  <I.Bot size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted">{t("settings.agents.primary_label")}</div>
                  <div className="text-sm text-muted">
                    {t("settings.agents.primary_unset")}
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<I.Sparkles size={12} />}
                  onClick={() => setPickOpen(true)}
                >
                  {t("settings.agents.pick_btn")}
                </Button>
              </>
            )}
          </div>
        </Card>

        {/* === Card Agent đang quản === */}
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">
              {t("settings.agents.my_agents_title", { count: String(myAgents.length) })}
            </div>
            <span className="text-xs text-muted">{t("settings.agents.sidebar_hint")}</span>
          </div>
          {myAgents.length === 0 ? (
            <EmptyState
              title={t("settings.agents.empty_title")}
              hint={t("settings.agents.empty_hint")}
              icon={<I.Users size={28} className="text-muted" />}
            />
          ) : (
            <div className="space-y-1">
              {myAgents.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded border border-border hover:bg-hover/40 transition-colors"
                >
                  <span className="w-7 h-7 rounded-md flex items-center justify-center bg-bg-soft text-accent shrink-0">
                    <I.Bot size={12} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-1.5">
                      {a.name}
                      {a.id === primaryAgentId && (
                        <Chip className="!h-[16px] !text-[9px]" variant="success">
                          {t("settings.agents.primary_chip")}
                        </Chip>
                      )}
                    </div>
                    <div className="text-xs text-muted truncate font-mono">{a.model}</div>
                  </div>
                  <Chip className="!text-[10px]">{a.role}</Chip>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate({ to: "/agents/$id", params: { id: a.id } })}
                    icon={<I.ChevronRight size={12} />}
                    title="Mở agent"
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="text-[11px] text-muted">
          {t("settings.agents.role_note")}
        </div>

        <PickPrimaryModal open={pickOpen} onClose={() => setPickOpen(false)} />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/agents")({ component: SettingsAgents });
