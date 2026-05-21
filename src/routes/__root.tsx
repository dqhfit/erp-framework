import { Outlet, createRootRoute } from "@tanstack/react-router";
import { Topbar } from "@/components/Topbar";
import { Sidebar } from "@/components/Sidebar";
import { AgentPanel } from "@/components/AgentPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { TweaksPanel } from "@/components/TweaksPanel";
import { GlobalAiCreateDrawer } from "@/components/GlobalAiCreateDrawer";
import { DialogHost } from "@/components/DialogHost";
import { AuthGate } from "@/components/AuthGate";
import { useApplyTheme } from "@/hooks/useApplyTheme";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useScheduler } from "@/hooks/useScheduler";
import { useUI } from "@/stores/ui";

/* Phần thân app — chỉ mount khi đã đăng nhập (sau AuthGate). */
function AppShell() {
  useGlobalShortcuts();
  useScheduler();
  const agentOpen = useUI((s) => s.agentOpen);
  return (
    <div className="h-screen flex flex-col bg-bg text-text">
      <Topbar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main
          className="flex-1 overflow-hidden flex flex-col"
          style={{ marginRight: agentOpen ? 400 : 0, transition: "margin 200ms ease" }}
        >
          <Outlet />
        </main>
      </div>
      <AgentPanel />
      <CommandPalette />
      <TweaksPanel />
      <GlobalAiCreateDrawer />
      <DialogHost />
    </div>
  );
}

function Root() {
  useApplyTheme();
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}

export const Route = createRootRoute({ component: Root });
