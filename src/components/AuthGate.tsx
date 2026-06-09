/* ==========================================================
   AuthGate — cổng đăng nhập toàn app. Chưa đăng nhập → màn hình
   login/đăng ký; đã đăng nhập → render children. Backend RBAC
   yêu cầu phiên nên mọi trang đều nằm sau cổng này.
   ========================================================== */
import { type ReactNode, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, FormField, Input } from "@/components/ui";
import { useT } from "@/hooks/useT";
import { useAuth } from "@/stores/auth";

function Splash({ text }: { text: string }) {
  return (
    <div className="h-screen flex items-center justify-center bg-bg text-muted text-sm">{text}</div>
  );
}

function LoginScreen() {
  const t = useT();
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const error = useAuth((s) => s.error);
  const errorCode = useAuth((s) => s.errorCode);
  const clearError = useAuth((s) => s.clearError);
  // Đăng ký chỉ mở khi hệ thống chưa có admin. Đã có admin → ẩn nút đăng ký.
  const registrationOpen = useAuth((s) => s.registrationOpen);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  /** Banner thông báo "admin đã được khởi tạo" — bật khi register bị FORBIDDEN. */
  const [firstAdminBanner, setFirstAdminBanner] = useState(false);

  const submit = async () => {
    setBusy(true);
    if (mode === "login") await login(email, password);
    else await register(email, name, password);
    setBusy(false);
    // Đăng nhập thất bại → xoá ô mật khẩu. Tránh user bấm "Đăng nhập"
    // liên tiếp với cùng mật khẩu sai → chạm rate-limit khoá 15 phút.
    // (login/register nuốt lỗi vào store; status vẫn "out" nếu thất bại.)
    if (mode === "login" && useAuth.getState().status !== "in") setPassword("");
  };

  // Khi register thất bại do first-admin-only (FORBIDDEN) → tự đổi về
  // login + show banner. User thấy ngay là chỉ cần đăng nhập, không
  // tốn click "Đã có tài khoản? Đăng nhập".
  useEffect(() => {
    if (mode === "register" && errorCode === "FORBIDDEN") {
      setMode("login");
      setFirstAdminBanner(true);
      clearError();
    }
  }, [mode, errorCode, clearError]);

  // Đã có admin (đăng ký đóng) → luôn ở chế độ đăng nhập (phòng khi đang dở
  // chế độ đăng ký lúc trạng thái về false).
  useEffect(() => {
    if (registrationOpen === false && mode === "register") setMode("login");
  }, [registrationOpen, mode]);

  // Friendly text cho TOO_MANY_REQUESTS — server đã kèm số giây cụ thể
  // trong message; chỉ thay khi rỗng.
  const displayError =
    errorCode === "TOO_MANY_REQUESTS" && !error ? t("auth.error_rate_limit") : error;

  return (
    <div className="h-screen flex items-center justify-center bg-bg text-text p-4">
      <Card className="w-[380px] max-w-full space-y-4">
        <div>
          <h1 className="text-lg font-semibold">
            {mode === "login" ? t("auth.login_title") : t("auth.register_title")}
          </h1>
          <div className="text-sm text-muted mt-0.5">
            {mode === "login" ? t("auth.login_sub") : t("auth.register_sub")}
          </div>
        </div>

        {firstAdminBanner && (
          <div className="px-2.5 py-2 rounded-md border border-accent/40 bg-accent/5 text-xs">
            {t("auth.banner_first_admin_existed")}
          </div>
        )}

        <FormField label={t("auth.email")}>
          <Input
            type="email"
            value={email}
            placeholder={t("auth.email_ph")}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>

        {mode === "register" && (
          <FormField label={t("auth.name")}>
            <Input
              value={name}
              placeholder={t("auth.name_ph")}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
        )}

        <FormField
          label={t("auth.password")}
          hint={mode === "register" ? t("auth.password_hint") : undefined}
        >
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

        {displayError && <Chip variant="danger">{displayError}</Chip>}

        <Button
          variant="primary"
          className="w-full justify-center"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy
            ? t("auth.processing")
            : mode === "login"
              ? t("auth.submit_login")
              : t("auth.submit_register")}
        </Button>

        {registrationOpen === true && (
          <button
            type="button"
            className="text-xs text-muted hover:text-text w-full text-center"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setFirstAdminBanner(false);
              clearError();
            }}
          >
            {mode === "login" ? t("auth.to_register") : t("auth.to_login")}
          </button>
        )}
      </Card>
    </div>
  );
}

/** Các route public không cần đăng nhập — bỏ qua AuthGate. */
const PUBLIC_ROUTE_PREFIXES = ["/invite", "/join", "/oauth/callback", "/view"];

function PendingApprovalScreen() {
  const t = useT();
  const logout = useAuth((s) => s.logout);
  return (
    <div className="h-screen flex items-center justify-center bg-bg text-text p-4">
      <Card className="w-[420px] max-w-full space-y-4 text-center">
        <div className="flex justify-center">
          <span className="w-14 h-14 rounded-full bg-warning/15 flex items-center justify-center">
            <I.Clock size={28} className="text-warning" />
          </span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">{t("auth.pending_title")}</h2>
          <p className="text-sm text-muted mt-1">{t("auth.pending_desc")}</p>
        </div>
        <Button variant="ghost" className="w-full justify-center" onClick={() => void logout()}>
          {t("sidebar.logout")}
        </Button>
      </Card>
    </div>
  );
}

function DisabledScreen() {
  const t = useT();
  const logout = useAuth((s) => s.logout);
  return (
    <div className="h-screen flex items-center justify-center bg-bg text-text p-4">
      <Card className="w-[420px] max-w-full space-y-4 text-center">
        <div className="flex justify-center">
          <span className="w-14 h-14 rounded-full bg-danger/15 flex items-center justify-center">
            <I.Ban size={28} className="text-danger" />
          </span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">{t("auth.disabled_title")}</h2>
          <p className="text-sm text-muted mt-1">{t("auth.disabled_desc")}</p>
        </div>
        <Button variant="ghost" className="w-full justify-center" onClick={() => void logout()}>
          {t("sidebar.logout")}
        </Button>
      </Card>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const t = useT();
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);
  const check = useAuth((s) => s.check);
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const isPublicRoute = PUBLIC_ROUTE_PREFIXES.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (status === "checking") void check();
  }, [status, check]);

  if (status === "checking") return <Splash text={t("auth.checking")} />;
  if (status === "out" && !isPublicRoute) return <LoginScreen />;
  // Tài khoản bị vô hiệu hoá — ưu tiên kiểm tra trước pending.
  if (status === "in" && user?.companyDisabled === true && !isPublicRoute) {
    return <DisabledScreen />;
  }
  // Đã đăng nhập nhưng đang chờ admin phê duyệt.
  if (status === "in" && user?.companyApproved === false && !isPublicRoute) {
    return <PendingApprovalScreen />;
  }
  return <>{children}</>;
}
