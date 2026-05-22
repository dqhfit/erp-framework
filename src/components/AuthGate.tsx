/* ==========================================================
   AuthGate — cổng đăng nhập toàn app. Chưa đăng nhập → màn hình
   login/đăng ký; đã đăng nhập → render children. Backend RBAC
   yêu cầu phiên nên mọi trang đều nằm sau cổng này.
   ========================================================== */
import { useEffect, useState, type ReactNode } from "react";
import { Button, Input, FormField, Card, Chip } from "@/components/ui";
import { useAuth } from "@/stores/auth";
import { useT } from "@/hooks/useT";

function Splash({ text }: { text: string }) {
  return (
    <div className="h-screen flex items-center justify-center bg-bg text-muted text-sm">
      {text}
    </div>
  );
}

function LoginScreen() {
  const t = useT();
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const error = useAuth((s) => s.error);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    if (mode === "login") await login(email, password);
    else await register(email, name, password);
    setBusy(false);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-bg text-text">
      <Card className="w-[380px] space-y-4">
        <div>
          <h1 className="text-lg font-semibold">
            {mode === "login" ? t("auth.login_title") : t("auth.register_title")}
          </h1>
          <div className="text-sm text-muted mt-0.5">
            {mode === "login" ? t("auth.login_sub") : t("auth.register_sub")}
          </div>
        </div>

        <FormField label={t("auth.email")}>
          <Input type="email" value={email} placeholder={t("auth.email_ph")}
            onChange={(e) => setEmail(e.target.value)} />
        </FormField>

        {mode === "register" && (
          <FormField label={t("auth.name")}>
            <Input value={name} placeholder={t("auth.name_ph")}
              onChange={(e) => setName(e.target.value)} />
          </FormField>
        )}

        <FormField label={t("auth.password")} hint={mode === "register" ? t("auth.password_hint") : undefined}>
          <Input type="password" value={password} placeholder="••••••••"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) void submit(); }} />
        </FormField>

        {error && <Chip variant="danger">{error}</Chip>}

        <Button variant="primary" className="w-full justify-center"
          disabled={busy} onClick={() => void submit()}>
          {busy
            ? t("auth.processing")
            : mode === "login" ? t("auth.submit_login") : t("auth.submit_register")}
        </Button>

        <button type="button"
          className="text-xs text-muted hover:text-text w-full text-center"
          onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? t("auth.to_register") : t("auth.to_login")}
        </button>
      </Card>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const t = useT();
  const status = useAuth((s) => s.status);
  const check = useAuth((s) => s.check);

  useEffect(() => {
    if (status === "checking") void check();
  }, [status, check]);

  if (status === "checking") return <Splash text={t("auth.checking")} />;
  if (status === "out") return <LoginScreen />;
  return <>{children}</>;
}
