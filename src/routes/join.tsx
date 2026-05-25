import { I } from "@/components/Icons";
import { Button, Card, Chip, FormField, Input } from "@/components/ui";
import { useAuth } from "@/stores/auth";
import { useUserObjects } from "@/stores/userObjects";
import { createAuthClient } from "@erp-framework/client";
/* ==========================================================
   /join?token=... — Trang công khai đăng ký qua invite link.
   ────────────────────────────────────────────────────────────
   1. Đọc token từ query, gọi auth.inviteLinkPreview → hiện tên công ty + role.
   2. User tự điền: họ tên, email, mật khẩu mới, xác nhận mật khẩu.
   3. Submit → auth.acceptInviteLink → server tạo user mới + cấp session.
   4. Link hết hiệu lực sau khi dùng (dùng 1 lần).
   ========================================================== */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

const auth = createAuthClient("");

interface PreviewState {
  valid: boolean;
  reason?: "not_found" | "used" | "expired";
  companyName?: string;
  role?: string;
  expiresAt?: string;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Quản trị",
  editor: "Biên tập",
  viewer: "Xem",
};

function JoinRoute() {
  const navigate = useNavigate();
  const token =
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("token") ?? "")
      : "";
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
      .inviteLinkPreview(token)
      .then((r) => setPreview(r as PreviewState))
      .catch((e) => setErr((e as Error).message));
  }, [token]);

  const submit = async () => {
    setErr("");
    if (!name.trim()) { setErr("Vui lòng nhập họ tên."); return; }
    if (!email.trim()) { setErr("Vui lòng nhập email."); return; }
    if (password.length < 8) { setErr("Mật khẩu phải có ít nhất 8 ký tự."); return; }
    if (password !== confirm) { setErr("Mật khẩu xác nhận không khớp."); return; }
    setBusy(true);
    try {
      const u = await auth.acceptInviteLink(token, name.trim(), email.trim(), password);
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
      <Card className="w-[440px] space-y-4">
        <div className="flex items-center gap-3">
          <span
            className="w-10 h-10 rounded-md flex items-center justify-center text-white"
            style={{
              background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent-2)))",
            }}
          >
            <I.Users size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold">Tạo tài khoản</h1>
            <div className="text-sm text-muted truncate">
              {preview?.valid
                ? `Tham gia công ty ${preview.companyName}`
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
              {preview.reason === "used" && "Link này đã được sử dụng. Mỗi link chỉ dùng được 1 lần."}
              {preview.reason === "expired" && "Link đã hết hạn. Hãy yêu cầu admin tạo link mới."}
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
            <div className="flex items-center gap-2 text-sm p-2.5 rounded-md bg-accent/8 border border-accent/20">
              <I.Briefcase size={14} className="text-accent shrink-0" />
              <span>
                Bạn được mời vào <strong>{preview.companyName}</strong> với vai trò{" "}
                <strong>{ROLE_LABEL[preview.role ?? ""] ?? preview.role}</strong>.
              </span>
            </div>

            <FormField label="Họ và tên">
              <Input
                value={name}
                placeholder="Nguyễn Văn A"
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>

            <FormField label="Email">
              <Input
                type="email"
                value={email}
                placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>

            <FormField label="Mật khẩu" hint="Tối thiểu 8 ký tự">
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
              disabled={busy || !name || !email || !password || !confirm}
              onClick={() => void submit()}
            >
              {busy ? "Đang tạo tài khoản…" : "Tạo tài khoản + vào app"}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/join")({ component: JoinRoute });
