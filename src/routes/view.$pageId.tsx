/* ==========================================================
   view.$pageId.tsx — URL công khai cho trang đã xuất bản.
   - Không cần auth để truy cập route này (thêm /view vào
     PUBLIC_ROUTE_PREFIXES trong AuthGate).
   - Nếu đã đăng nhập → render ConsumerPage với dữ liệu thật.
   - Nếu chưa đăng nhập → hiện màn login tối giản, sau khi
     đăng nhập redirect lại URL này.
   - Trang chưa publish → thông báo lỗi.
   ========================================================== */
import { createObjectsClient } from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { I } from "@/components/Icons";
import { ConsumerPage } from "@/components/renderer/ConsumerPage";
import { Button, Card, FormField, Input } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { useAuth } from "@/stores/auth";
import { useUserObjects } from "@/stores/userObjects";

const api = createObjectsClient("");

/* Màn login tối giản dành cho đối tác — chỉ login, không đăng ký */
function ViewerLoginScreen({ pageId }: { pageId: string }) {
  const t = useT();
  const login = useAuth((s) => s.login);
  const error = useAuth((s) => s.error);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    await login(email, password);
    setBusy(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg text-text p-4">
      <div className="mb-6 flex flex-col items-center gap-2">
        <span className="w-12 h-12 rounded-xl bg-accent/15 text-accent flex items-center justify-center">
          <I.Layout size={22} />
        </span>
        <p className="text-xs text-muted">{t("view.login_sub", { pageId })}</p>
      </div>
      <Card className="w-[360px] space-y-4">
        <div>
          <h1 className="text-base font-semibold">{t("view.login_title")}</h1>
          <p className="text-xs text-muted mt-0.5">{t("view.login_desc")}</p>
        </div>

        <FormField label={t("auth.email")}>
          <Input
            type="email"
            value={email}
            placeholder={t("auth.email_ph")}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        <FormField label={t("auth.password")}>
          <Input
            type="password"
            value={password}
            placeholder="••••••••"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void submit();
            }}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}

        <Button
          variant="primary"
          className="w-full justify-center"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? t("auth.processing") : t("auth.submit_login")}
        </Button>
      </Card>
    </div>
  );
}

/* Header tối giản cho trang xem công khai */
function ViewHeader({ name, onLogout }: { name: string; onLogout?: () => void }) {
  const t = useT();
  return (
    <header className="h-11 shrink-0 flex items-center px-4 gap-3 border-b border-border bg-panel">
      <span className="w-6 h-6 rounded bg-accent/20 text-accent flex items-center justify-center">
        <I.Layout size={13} />
      </span>
      <span className="font-medium text-sm truncate">{name}</span>
      <I.Globe size={12} className="text-muted" />
      <div className="flex-1" />
      {onLogout && (
        <Button variant="ghost" size="sm" icon={<I.LogOut size={13} />} onClick={onLogout}>
          {t("portal.logout")}
        </Button>
      )}
    </header>
  );
}

function ViewRoute() {
  const { pageId } = Route.useParams();
  const t = useT();
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  // Kiểm tra trang có published=true không (dùng endpoint getPublic — không cần auth)
  const [pageOk, setPageOk] = useState<"checking" | "ok" | "not_found">("checking");
  const [pageName, setPageName] = useState<string>("");

  useEffect(() => {
    api.pages
      .getPublic(pageId)
      .then((row) => {
        const r = row as { label?: string; name?: string; published?: boolean };
        setPageName((r.label as string) || (r.name as string) || "");
        setPageOk("ok");
      })
      .catch(() => setPageOk("not_found"));
  }, [pageId]);

  // Sau khi đăng nhập thành công, hydrate userObjects để ConsumerPage có dữ liệu
  const hydrate = useUserObjects((s) => s.hydrate);
  const ready = useUserObjects((s) => s.ready);
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status === "in" && prev !== "in") {
      useUserObjects.setState({ ready: false });
      void hydrate();
    }
  }, [status, hydrate]);

  if (pageOk === "checking" || status === "checking" || (status === "in" && !ready)) {
    return (
      <div className="h-screen flex items-center justify-center bg-bg text-muted text-sm">
        {t("common.loading")}
      </div>
    );
  }

  if (pageOk === "not_found") {
    return (
      <div className="h-screen flex items-center justify-center bg-bg text-text p-6">
        <Card className="max-w-sm text-center space-y-3 p-6">
          <I.AlertCircle size={32} className="mx-auto text-muted" />
          <p className="font-semibold">{t("view.not_published_title")}</p>
          <p className="text-sm text-muted">{t("view.not_published_desc")}</p>
        </Card>
      </div>
    );
  }

  // Trang OK nhưng chưa đăng nhập → màn login tối giản
  if (status === "out") {
    return <ViewerLoginScreen pageId={pageId} />;
  }

  // Đã đăng nhập + trang ok → render ConsumerPage
  return (
    <div className="h-screen flex flex-col bg-bg text-text">
      <ViewHeader name={pageName} onLogout={user ? () => void logout() : undefined} />
      <main className="flex-1 overflow-hidden">
        <ConsumerPage pageId={pageId} />
      </main>
    </div>
  );
}

export const Route = createFileRoute("/view/$pageId")({ component: ViewRoute });
