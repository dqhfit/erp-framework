import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card } from "@/components/ui";
import { handleCallback } from "@/core/llm/oauth";
import { useT } from "@/hooks/useT";

function OAuthCallback() {
  const t = useT();
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
      setErr(
        t("oauth.err_code", {
          error,
          desc: url.searchParams.get("error_description") ?? "",
        }),
      );
      return;
    }
    if (!code) {
      setStatus("error");
      setErr(t("oauth.err_no_code"));
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
  }, [navigate, t]);

  return (
    <div className="flex items-center justify-center h-full p-6">
      <Card className="max-w-md w-full text-center">
        {status === "loading" && (
          <>
            <I.Loader size={32} className="mx-auto text-accent animate-spin mb-3" />
            <div className="font-semibold">{t("oauth.verifying")}</div>
            <div className="text-sm text-muted mt-1">{t("oauth.please_wait")}</div>
          </>
        )}
        {status === "success" && (
          <>
            <div className="w-12 h-12 rounded-full bg-success/15 text-success flex items-center justify-center mx-auto mb-3">
              <I.Check size={24} />
            </div>
            <div className="font-semibold text-lg">{t("oauth.success")}</div>
            <div className="text-sm text-muted mt-1">{t("oauth.redirecting")}</div>
          </>
        )}
        {status === "error" && (
          <>
            <div className="w-12 h-12 rounded-full bg-danger/15 text-danger flex items-center justify-center mx-auto mb-3">
              <I.AlertCircle size={24} />
            </div>
            <div className="font-semibold text-lg">{t("oauth.failed")}</div>
            <div className="text-sm text-danger mt-2 font-mono text-left bg-bg-soft p-2 rounded-sm">
              {err}
            </div>
            <Button
              variant="default"
              className="mt-4"
              onClick={() => navigate({ to: "/settings/llm" })}
            >
              {t("oauth.back_to_settings")}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

export const Route = createFileRoute("/oauth/callback")({ component: OAuthCallback });
