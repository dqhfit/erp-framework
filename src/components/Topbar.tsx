import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Button, Chip, Kbd } from "@/components/ui";
import { I } from "@/components/Icons";
import { useUI } from "@/stores/ui";
import { useSettings } from "@/stores/settings";
import { llmRegistry } from "@/core/llm";
import { useT } from "@/hooks/useT";
import { LanguagePicker } from "@/components/LanguagePicker";

export function Topbar() {
  const t = useT();
  const navigate = useNavigate();
  const matches = useRouterState({ select: (s) => s.location.pathname });
  const { theme, setTheme, mode, setMode, sidebarCollapsed, setSidebarCollapsed,
    agentOpen, setAgentOpen, setCmdOpen, tweaksOpen, setTweaksOpen } = useUI();

  const isDesignerRoute = /^\/(entities|pages|workflows)\//.test(matches);

  // Hiển thị model active đầu tiên — ưu tiên profile usable
  const llmProfiles = useSettings((s) => s.llmProfiles);
  const activeProfile = (() => {
    const list = Object.values(llmProfiles);
    return list.find((p) => llmRegistry.isUsable(p)) ?? list[0];
  })();
  const activeModel = activeProfile?.model;
  const activeProfileName = activeProfile?.name;

  return (
    <div className="h-12 shrink-0 flex items-center px-3 gap-1.5 sm:gap-2 border-b border-border bg-panel/70 backdrop-blur sticky top-0 z-50 whitespace-nowrap">
      {/* Brand */}
      <button
        onClick={() => navigate({ to: "/" })}
        className="flex items-center gap-2 px-1.5 h-8 rounded-md hover:bg-hover/50"
      >
        <span
          className="w-6 h-6 rounded-md flex items-center justify-center text-white"
          style={{ background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))" }}
        >
          <I.Bolt size={14} strokeWidth={2.5} />
        </span>
        <span className="font-semibold tracking-tight">{t("topbar.brand")}</span>
        <Chip className="!h-[18px] !text-[10px]">v1.0</Chip>
      </button>

      <div className="w-px h-5 bg-border mx-1" />

      <Button
        variant="ghost" size="sm"
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
          <Kbd>⌘</Kbd><Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex-1 min-w-0" />

      {/* Mode toggle */}
      {isDesignerRoute && (
        <div className="mode-toggle shrink-0">
          <button className={mode === "designer" ? "on" : ""} onClick={() => setMode("designer")}>
            <span className="inline-flex items-center gap-1.5"><I.Edit size={11} /> {t("topbar.edit")}</span>
          </button>
          <button className={mode === "consumer" ? "on" : ""} onClick={() => setMode("consumer")}>
            <span className="inline-flex items-center gap-1.5"><I.Eye size={11} /> {t("topbar.preview")}</span>
          </button>
        </div>
      )}

      {/* MCP status */}
      <Link
        to="/settings/mcp"
        className="hidden md:flex items-center gap-1.5 h-8 px-2 rounded-md hover:bg-hover/50 text-sm shrink-0"
        title="MCP connected"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-success" />
        <I.Server size={14} className="text-muted" />
        <span className="text-muted">{t("topbar.mcp")}</span>
      </Link>

      {/* LLM profile */}
      <Link
        to="/settings/llm"
        className="hidden lg:flex items-center gap-1.5 h-8 px-2 rounded-md hover:bg-hover/50 text-sm shrink-0"
        title={activeProfileName ? `Profile: ${activeProfileName}` : "Chưa có LLM profile"}
      >
        <I.Sparkles size={14} className="text-accent" />
        <span className="text-muted">{activeModel ?? t("topbar.no_llm")}</span>
      </Link>

      <Button
        variant="ghost" size="sm"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        icon={theme === "dark" ? <I.Sun size={14} /> : <I.Moon size={14} />}
        title={t("topbar.toggle_theme")}
      />
      <LanguagePicker />

      <Button
        variant="ghost" size="sm"
        icon={<I.Bell size={14} />}
        title={t("topbar.notifications")}
        className="hidden md:inline-flex"
      />

      <Button
        variant={agentOpen ? "primary" : "default"} size="sm"
        onClick={() => setAgentOpen(!agentOpen)}
        icon={<I.Sparkles size={14} />}
        className="shrink-0"
      >
        <span className="hidden sm:inline">{t("topbar.ask_agent")}</span>
      </Button>

      <Button
        variant={tweaksOpen ? "primary" : "ghost"} size="sm"
        onClick={() => setTweaksOpen(!tweaksOpen)}
        icon={<I.Wand size={14} />}
        title="Tweaks (theme/density/accent)"
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
