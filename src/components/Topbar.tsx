import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { SubmitFeedbackModal } from "@/components/feedback/SubmitFeedbackModal";
import { I } from "@/components/Icons";
import { LanguagePicker } from "@/components/LanguagePicker";
import { PickPrimaryModal } from "@/components/PickPrimaryModal";
import { Button, Kbd } from "@/components/ui";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useT } from "@/hooks/useT";
import { useAuth } from "@/stores/auth";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

export function Topbar() {
  const t = useT();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const {
    theme,
    setTheme,
    sidebarCollapsed,
    setSidebarCollapsed,
    agentOpen,
    setAgentOpen,
    setCmdOpen,
    tweaksOpen,
    setTweaksOpen,
    setMobileNavOpen,
  } = useUI();

  // Chip "Agent chính": có primary → avatar + tên; chưa có → chip dashed.
  const primaryAgentId = useAuth((s) => s.primaryAgentId);
  const allAgents = useUserObjects((s) => s.agents);
  const primaryAgent = primaryAgentId
    ? (allAgents.find((a) => a.id === primaryAgentId) ?? null)
    : null;
  const [primaryPickOpen, setPrimaryPickOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!userMenuRef.current?.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  const initials =
    user?.name
      ?.split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() ?? "?";

  // Tách brand "ERP Framework" → "ERP" (chính) + "Framework" (phụ, nhỏ)
  // để hiển thị 2 dòng gọn trên mobile.
  const brand = t("topbar.brand");
  const brandSpace = brand.indexOf(" ");
  const brandMain = brandSpace === -1 ? brand : brand.slice(0, brandSpace);
  const brandSub = brandSpace === -1 ? "" : brand.slice(brandSpace + 1);

  return (
    <div className="h-12 shrink-0 flex items-center px-1 gap-0.5 sm:px-3 sm:gap-2 border-b border-border bg-panel/70 backdrop-blur-sm sticky top-0 z-50 whitespace-nowrap">
      {/* Hamburger mở off-canvas nav — chỉ mobile, nằm bên trái logo */}
      {isMobile && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMobileNavOpen(true)}
          icon={<I.Menu size={16} />}
          title={t("topbar.toggle_sidebar")}
        />
      )}

      {/* Brand */}
      <button
        type="button"
        onClick={() => navigate({ to: "/" })}
        className="flex items-center gap-1 px-1 h-8 rounded-md hover:bg-hover/50 sm:gap-2 sm:px-1.5"
      >
        <span
          className="w-6 h-6 rounded-md flex items-center justify-center text-white shrink-0"
          style={{
            background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
          }}
        >
          <I.Bolt size={14} strokeWidth={2.5} />
        </span>
        {isMobile ? (
          // Mobile: "ERP" gọn + "Framework" nhỏ ngay dưới.
          <span className="flex flex-col items-start leading-none">
            <span className="font-semibold text-[13px] tracking-tight">{brandMain}</span>
            {brandSub && <span className="text-[8px] text-muted leading-none">{brandSub}</span>}
          </span>
        ) : (
          <span className="font-semibold tracking-tight">{brand}</span>
        )}
      </button>

      {!isMobile && <div className="w-px h-5 bg-border mx-1" />}

      {/* Toggle collapse sidebar — chỉ desktop (mobile dùng hamburger trái logo) */}
      {!isMobile && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          icon={<I.PanelLeft size={14} />}
          title={t("topbar.toggle_sidebar")}
        />
      )}

      {/* Search / Command */}
      <button
        type="button"
        onClick={() => setCmdOpen(true)}
        className="flex items-center gap-2 h-8 px-2.5 rounded-md bg-bg-soft border border-border text-muted hover:text-text hover:border-hover transition-colors min-w-0 flex-1 max-w-[420px] mx-0.5 sm:mx-2 whitespace-nowrap overflow-hidden"
      >
        <I.Search size={14} className="shrink-0" />
        <span className="text-sm truncate hidden sm:inline">{t("topbar.search_placeholder")}</span>
        <span className="ml-auto flex items-center gap-1 shrink-0">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex-1 min-w-0" />

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

      {/* User avatar + dropdown menu */}
      <div ref={userMenuRef} className="relative ml-0.5 sm:ml-1 shrink-0">
        <button
          type="button"
          onClick={() => setUserMenuOpen((o) => !o)}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 ring-transparent hover:ring-accent/40 transition-all"
          style={{
            background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
          }}
          title={user?.name ?? ""}
        >
          {initials}
        </button>

        {userMenuOpen && (
          <div className="absolute right-0 top-full mt-2 w-60 rounded-lg border border-border bg-panel shadow-lg z-[200] overflow-hidden">
            {/* User info header */}
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
                  }}
                >
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{user?.name}</div>
                  <div className="text-xs text-muted truncate">{user?.email}</div>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div className="py-1">
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-hover/40 transition-colors text-left"
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate({ to: "/settings/companies" });
                }}
              >
                <I.Briefcase size={14} className="text-muted shrink-0" />
                {t("topbar.user_menu_companies")}
              </button>
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-hover/40 transition-colors text-left"
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate({ to: "/settings/llm" });
                }}
              >
                <I.Sparkles size={14} className="text-muted shrink-0" />
                {t("topbar.user_menu_llm")}
              </button>
            </div>

            <div className="border-t border-border py-1">
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-danger/10 text-danger transition-colors text-left"
                onClick={() => {
                  setUserMenuOpen(false);
                  void logout();
                }}
              >
                <I.LogOut size={14} className="shrink-0" />
                {t("sidebar.logout")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
