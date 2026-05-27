import { createEmbedClient } from "@erp-framework/client";
import { createRootRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { AgentPanel } from "@/components/AgentPanel";
import { AuthGate } from "@/components/AuthGate";
import { CommandPalette } from "@/components/CommandPalette";
import { DialogHost } from "@/components/DialogHost";
import { GlobalAiCreateDrawer } from "@/components/GlobalAiCreateDrawer";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { TweaksPanel } from "@/components/TweaksPanel";
import { useApplyTheme } from "@/hooks/useApplyTheme";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useUI } from "@/stores/ui";
import { useUserObjects } from "@/stores/userObjects";

/* Phần thân app — chỉ mount khi đã đăng nhập (sau AuthGate).
   Scheduler chạy phía server (pg-boss) — không còn scheduler client. */
/** Chế độ nhúng (?embed=1): ẩn chrome (topbar/sidebar/panel) để
   nhúng trang designer vào sản phẩm khác qua iframe. */
function isEmbedMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("embed") === "1";
}

function embedToken(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("token");
}

const embedClient = createEmbedClient("");

/** Cổng nhúng — yêu cầu token nhúng hợp lệ trước khi hiển thị giao
   diện ?embed. Token bị thu hồi (embed.revoke) → chặn ngay. Đây là
   cổng GIAO DIỆN; API dữ liệu vẫn cần phiên đăng nhập như thường. */
function EmbedGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "ok" | "bad">("checking");
  useEffect(() => {
    const token = embedToken();
    if (!token) {
      setState("bad");
      return;
    }
    embedClient
      .verify(token)
      .then((r) => setState(r.valid ? "ok" : "bad"))
      .catch(() => setState("bad"));
  }, []);

  if (state === "checking") {
    return (
      <div className="h-screen flex items-center justify-center bg-bg text-muted text-sm">
        Đang kiểm tra token nhúng…
      </div>
    );
  }
  if (state === "bad") {
    return (
      <div className="h-screen flex items-center justify-center bg-bg text-text p-6">
        <div className="card p-6 max-w-md text-center space-y-2">
          <div className="font-semibold text-danger">Không thể nhúng</div>
          <div className="text-sm text-muted">
            Token nhúng thiếu, không hợp lệ hoặc đã bị thu hồi. Liên hệ quản trị viên để lấy liên
            kết nhúng mới.
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function AppShell() {
  useGlobalShortcuts();
  const agentOpen = useUI((s) => s.agentOpen);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // /view/* renders its own full-screen layout — skip AppShell chrome.
  if (pathname.startsWith("/view/")) return <Outlet />;

  /* Nạp store dùng chung (entity/page/workflow/agent) ngay khi vào
     app — và nạp lại mỗi khi quay lại tab. Nhờ vậy sidebar luôn
     phản ánh backend, không cần ghé trang "Dữ liệu Server". */
  useEffect(() => {
    const hydrate = () => void useUserObjects.getState().hydrate();
    hydrate();
    const onFocus = () => {
      if (document.visibilityState === "visible") hydrate();
    };
    window.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (isEmbedMode()) {
    return (
      <EmbedGate>
        <div className="h-screen flex flex-col bg-bg text-text">
          <main className="flex-1 overflow-hidden flex flex-col">
            <Outlet />
          </main>
          <DialogHost />
        </div>
      </EmbedGate>
    );
  }

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

function NotFoundPage() {
  return (
    <div className="h-screen flex items-center justify-center bg-bg text-text">
      <div className="text-center space-y-3 max-w-sm">
        <div className="text-4xl font-bold text-muted">404</div>
        <div className="font-semibold">Không tìm thấy trang</div>
        <div className="text-sm text-muted">Trang này không tồn tại hoặc đã bị xóa.</div>
        <Link
          to="/"
          className="inline-block mt-2 px-4 py-2 rounded-md bg-accent text-white text-sm hover:opacity-90 transition-opacity"
        >
          Về trang chủ
        </Link>
      </div>
    </div>
  );
}

function ErrorPage({ error }: { error: Error }) {
  const msg = error?.message ?? String(error);
  const is404 = msg.includes("404") || msg.includes("not found") || msg.includes("Not Found");
  return (
    <div className="h-screen flex items-center justify-center bg-bg text-text p-6">
      <div className="text-center space-y-3 max-w-md">
        <div className={`text-4xl font-bold ${is404 ? "text-muted" : "text-danger"}`}>
          {is404 ? "404" : "Lỗi"}
        </div>
        <div className="font-semibold">{is404 ? "Không tìm thấy" : "Đã xảy ra lỗi"}</div>
        <div className="text-xs text-muted font-mono bg-bg-soft border border-border rounded px-3 py-2 text-left break-all max-h-32 overflow-y-auto">
          {msg}
        </div>
        <Link
          to="/"
          className="inline-block mt-2 px-4 py-2 rounded-md bg-accent text-white text-sm hover:opacity-90 transition-opacity"
        >
          Về trang chủ
        </Link>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: Root,
  notFoundComponent: NotFoundPage,
  errorComponent: ({ error }) => <ErrorPage error={error as Error} />,
});
