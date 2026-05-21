import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { handleCallback } from "@/core/llm/oauth";
import { Card, Button } from "@/components/ui";
import { I } from "@/components/Icons";

function OAuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    const error = url.searchParams.get("error");
    if (error) {
      setStatus("error");
      setErr(`OAuth lỗi: ${error} — ${url.searchParams.get("error_description") ?? ""}`);
      return;
    }
    if (!code) {
      setStatus("error");
      setErr("Thiếu authorization code trong callback URL");
      return;
    }
    handleCallback(code, state)
      .then(() => {
        setStatus("success");
        setTimeout(() => navigate({ to: "/settings/llm" }), 1500);
      })
      .catch((e) => {
        setStatus("error");
        setErr((e as Error).message);
      });
  }, [navigate]);

  return (
    <div className="flex items-center justify-center h-full p-6">
      <Card className="max-w-md w-full text-center">
        {status === "loading" && (
          <>
            <I.Loader size={32} className="mx-auto text-accent animate-spin mb-3" />
            <div className="font-semibold">Đang xác thực với Anthropic...</div>
            <div className="text-sm text-muted mt-1">Vui lòng đợi.</div>
          </>
        )}
        {status === "success" && (
          <>
            <div className="w-12 h-12 rounded-full bg-success/15 text-success flex items-center justify-center mx-auto mb-3">
              <I.Check size={24} />
            </div>
            <div className="font-semibold text-lg">Đăng nhập thành công!</div>
            <div className="text-sm text-muted mt-1">Đang chuyển về cài đặt...</div>
          </>
        )}
        {status === "error" && (
          <>
            <div className="w-12 h-12 rounded-full bg-danger/15 text-danger flex items-center justify-center mx-auto mb-3">
              <I.AlertCircle size={24} />
            </div>
            <div className="font-semibold text-lg">Đăng nhập thất bại</div>
            <div className="text-sm text-danger mt-2 font-mono text-left bg-bg-soft p-2 rounded">{err}</div>
            <Button variant="default" className="mt-4" onClick={() => navigate({ to: "/settings/llm" })}>
              Về cài đặt
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/oauth/callback")({ component: OAuthCallback });
