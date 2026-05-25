import { CompanySwitcher } from "@/components/CompanySwitcher";
import { I } from "@/components/Icons";
import { LanguagePicker } from "@/components/LanguagePicker";
import { PickPrimaryModal } from "@/components/PickPrimaryModal";
import { SubmitFeedbackModal } from "@/components/feedback/SubmitFeedbackModal";
import { Button, Chip, Kbd } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";

export function Topbar() {
  const t = useT();
  const navigate = useNavigate();
  const matches = useRouterState({ select: (s) => s.location.pathname });
  const {
    theme,
    setTheme,
    mode,
    setMode,
    sidebarCollapsed,
    setSidebarCollapsed,
    agentOpen,
    setAgentOpen,
    setCmdOpen,
    tweaksOpen,
    setTweaksOpen,
  } = useUI();

  const isDesignerRoute = /^\/(entities|pages|workflows)\//.test(matches);

  // Chip "Agent chính": có primary → avatar + tên; chưa có → chip dashed.
  const primaryAgentId = useAuth((s) => s.primaryAgentId);
  const allAgents = useUserObjects((s) => s.agents);
  const primaryAgent = primaryAgentId
    ? (allAgents.find((a) => a.id === primaryAgentId) ?? null)
    : null;
  const [primaryPickOpen, setPrimaryPickOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <div className="h-12 shrink-0 flex items-center px-3 gap-1.5 sm:gap-2 border-b border-border bg-panel/70 backdrop-blur sticky top-0 z-50 whitespace-nowrap">
      {/* Brand */}
      <button
        onClick={() => navigate({ to: "/" })}
        className="flex items-center gap-2 px-1.5 h-8 rounded-md hover:bg-hover/50"
      >
        <span
          className="w-6 h-6 rounded-md flex items-center justify-center text-white"
          style={{
            background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
          }}
        >
          <I.Bolt size={14} strokeWidth={2.5} />
        </span>
        <span className="font-semibold tracking-tight">{t("topbar.brand")}</span>
        <Chip className="!h-[18px] !text-[10px]">v1.0</Chip>
      </button>

      <div className="w-px h-5 bg-border mx-1" />

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        icon={<I.PanelLeft size={14} />}
        title={t("topbar.toggle_sidebar")}
      />

      {/* Search / Command */}
      <button
        onClick={() => setCmdOpen(true)}
        className="flex items-center gap-2 h-8 px-2.5 rounded-md bg-bg-soft border border-border text-muted hover:text-text hover:border-hover transition-colors min-w-0 flex-1 max-w-[420px] mx-2 whitespace-nowrap overflow-hidden"
      >
        <I.Search size={14} className="shrink-0" />
        <span className="text-sm truncate hidden sm:inline">{t("topbar.search_placeholder")}</span>
        <span className="ml-auto flex items-center gap-1 shrink-0">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex-1 min-w-0" />

      {/* Mode toggle */}
      {isDesignerRoute && (
        <div className="mode-toggle shrink-0">
          <button className={mode === "designer" ? "on" : ""} onClick={() => setMode("designer")}>
            <span className="inline-flex items-center gap-1.5">
              <I.Edit size={11} /> {t("topbar.edit")}
            </span>
          </button>
          <button className={mode === "consumer" ? "on" : ""} onClick={() => setMode("consumer")}>
            <span className="inline-flex items-center gap-1.5">
              <I.Eye size={11} /> {t("topbar.preview")}
            </span>
          </button>
        </div>
      )}

      {/* Công ty đang làm việc (đa công ty) */}
      <CompanySwitcher />

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        icon={theme === "dark" ? <I.Sun size={14} /> : <I.Moon size={14} />}
        title={t("topbar.toggle_theme")}
      />
      <LanguagePicker />

      <Button
        variant="ghost"
        size="sm"
        icon={<I.HelpCircle size={14} />}
        title="Gửi phản hồi / đề xuất cải thiện"
        className="hidden md:inline-flex"
        onClick={() => setFeedbackOpen(true)}
      />

      <Button
        variant="ghost"
        size="sm"
        icon={<I.Bell size={14} />}
        title={t("topbar.notifications")}
        className="hidden md:inline-flex"
      />

      {/* Agent chính — chip avatar nếu có, chip dashed nếu chưa setup.
          Click → mở PickPrimaryModal hoặc đi thẳng tới /agents/$id. */}
      {primaryAgent ? (
        <Link
          to="/agents/$id"
          params={{ id: primaryAgent.id }}
          className="hidden md:flex items-center gap-1.5 h-8 px-2 rounded-md hover:bg-hover/50 text-sm shrink-0 border border-border bg-bg-soft/30"
          title={`Agent chính: ${primaryAgent.name} (click để mở)`}
        >
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
            style={{
              background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
            }}
          >
            <I.Bot size={11} />
          </span>
          <span className="truncate max-w-[120px]">{primaryAgent.name}</span>
        </Link>
      ) : (
        allAgents.length > 0 && (
          <button
            type="button"
            onClick={() => setPrimaryPickOpen(true)}
            className="hidden md:flex items-center gap-1.5 h-8 px-2 rounded-md hover:bg-hover/50 text-xs shrink-0 border border-dashed border-border text-muted hover:text-text"
            title="Chọn Agent chính của bạn"
          >
            <I.Bot size={12} />
            <span>Chưa chọn Agent chính</span>
          </button>
        )
      )}
      <PickPrimaryModal open={primaryPickOpen} onClose={() => setPrimaryPickOpen(false)} />
      <SubmitFeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      <Button
        variant={agentOpen ? "primary" : "default"}
        size="sm"
        onClick={() => setAgentOpen(!agentOpen)}
        icon={<I.Sparkles size={14} />}
        className="shrink-0"
      >
        <span className="hidden sm:inline">{t("topbar.ask_agent")}</span>
      </Button>

      <Button
        variant={tweaksOpen ? "primary" : "ghost"}
        size="sm"
        onClick={() => setTweaksOpen(!tweaksOpen)}
        icon={<I.Wand size={14} />}
        title={t("topbar.tweaks")}
      />

      <button
        className="ml-1 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
        style={{ background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))" }}
        title="Toàn Vũ — Admin"
      >
        TV
      </button>
    </div>
  );
}
