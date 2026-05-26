import { createAuthClient } from "@erp-framework/client";
/* ==========================================================
   /invite?token=... — Trang công khai (ngoài AuthGate).
   ────────────────────────────────────────────────────────────
   1. Đọc token từ query, gọi auth.invitePreview → hiện email + công ty.
   2. User nhập mật khẩu mới (≥8 ký tự) + xác nhận.
   3. Submit → auth.acceptInvite → server đặt password + tự cấp session
      qua cookie + return user info → store enter(user) → navigate("/").
   4. Trường hợp link invalid/expired/đã dùng → màn báo lỗi với link
      về trang chủ.
   ========================================================== */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, FormField, Input } from "@/components/ui";
import { useAuth } from "@/stores/auth";
import { useUserObjects } from "@/stores/userObjects";

const auth = createAuthClient("");

interface PreviewState {
  valid: boolean;
  reason?: "not_found" | "accepted" | "expired";
  email?: string;
  name?: string;
  companyName?: string;
  expiresAt?: string;
}

function InviteRoute() {
  const navigate = useNavigate();
  const token =
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("token") ?? "")
      : "";
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!token) {
      setPreview({ valid: false, reason: "not_found" });
      return;
    }
    auth
      .invitePreview(token)
      .then((r) => setPreview(r as PreviewState))
      .catch((e) => setErr((e as Error).message));
  }, [token]);

  const submit = async () => {
    setErr("");
    if (password.length < 8) {
      setErr("Mật khẩu phải có ít nhất 8 ký tự.");
      return;
    }
    if (password !== confirm) {
      setErr("Mật khẩu xác nhận không khớp.");
      return;
    }
    setBusy(true);
    try {
      const u = await auth.acceptInvite(token, password);
      // Server đã set cookie session — đồng bộ vào store rồi đi tới home.
      useAuth.setState({ status: "in", user: u as never, error: "", errorCode: null });
      void useUserObjects.getState().hydrate();
      void useAuth.getState().refreshMyAgents();
      navigate({ to: "/" });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-bg text-text p-4">
      <Card className="w-[420px] space-y-4">
        <div className="flex items-center gap-3">
          <span
            className="w-10 h-10 rounded-md flex items-center justify-center text-white"
            style={{
              background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
            }}
          >
            <I.User size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold">Hoàn tất thiết lập tài khoản</h1>
            <div className="text-sm text-muted truncate">
              {preview?.valid
                ? `${preview.email} · công ty ${preview.companyName}`
                : "Đang xác thực link…"}
            </div>
          </div>
        </div>

        {preview === null && (
          <div className="flex items-center gap-2 text-sm text-muted py-4">
            <I.Loader size={14} className="animate-spin" /> Đang kiểm tra link…
          </div>
        )}

        {preview && !preview.valid && (
          <div className="space-y-3 py-2">
            <Chip variant="danger">
              {preview.reason === "not_found" && "Link không hợp lệ hoặc đã bị thu hồi."}
              {preview.reason === "expired" && "Link đã hết hạn. Hãy yêu cầu admin gửi lại."}
              {preview.reason === "accepted" && "Link này đã được sử dụng. Vui lòng đăng nhập."}
            </Chip>
            <Button
              variant="default"
              className="w-full justify-center"
              onClick={() => navigate({ to: "/" })}
            >
              Về trang đăng nhập
            </Button>
          </div>
        )}

        {preview?.valid && (
          <>
            <div className="text-xs text-muted">
              Đặt mật khẩu lần đầu để hoàn tất tài khoản. Mật khẩu sẽ dùng cho các lần đăng nhập
              sau.
            </div>

            <FormField label="Mật khẩu mới" hint="Tối thiểu 8 ký tự">
              <Input
                type="password"
                value={password}
                placeholder="••••••••"
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>

            <FormField label="Nhập lại mật khẩu">
              <Input
                type="password"
                value={confirm}
                placeholder="••••••••"
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) void submit();
                }}
              />
            </FormField>

            {err && <Chip variant="danger">{err}</Chip>}

            <Button
              variant="primary"
              className="w-full justify-center"
              disabled={busy || !password || !confirm}
              onClick={() => void submit()}
            >
              {busy ? "Đang xử lý…" : "Hoàn tất + vào app"}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/invite")({ component: InviteRoute });
