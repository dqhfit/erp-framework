import { createIntegrationsClient, type WebSearchConfigView } from "@erp-framework/client";
import { type Role, roleCan } from "@erp-framework/core";
/* ==========================================================
   settings.web-search — Cấu hình SearXNG cho web search (agent tool
   web_search, workflow node "Web Search", web fallback của Tìm sâu).
   Mỗi công ty 1 URL (mã hoá DB); fallback env SEARXNG_URL.
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, FormField, Input } from "@/components/ui";
import { useAuth } from "@/stores/auth";

const ig = createIntegrationsClient("");

function WebSearchPage() {
  const userRole = useAuth((s) => (s.user?.role ?? "viewer") as Role);
  const canEdit = roleCan(userRole, "edit", "settings");

  const [cfg, setCfg] = useState<WebSearchConfigView | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const loadConfig = useCallback(async () => {
    try {
      const c = (await ig.webSearch.get()) as WebSearchConfigView;
      setCfg(c);
    } catch {
      /* chưa đăng nhập */
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = () =>
    wrap(async () => {
      const r = await ig.webSearch.test(url.trim() || undefined);
      setMsg(`✓ Kết nối được — ${r.count} kết quả thử`);
    });

  const save = () =>
    wrap(async () => {
      if (!url.trim()) throw new Error("Nhập URL SearXNG trước.");
      await ig.webSearch.save(url.trim());
      setUrl("");
      await loadConfig();
      setMsg("Đã lưu cấu hình.");
    });

  const sourceLabel =
    cfg?.source === "company"
      ? "Cấu hình công ty"
      : cfg?.source === "env"
        ? "Biến môi trường"
        : "Chưa cấu hình";

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[800px] mx-auto p-3 sm:p-5">
        <h1 className="text-sm font-semibold mb-1">Tìm kiếm web (SearXNG)</h1>
        <div className="text-sm text-muted mb-3">
          Cấu hình SearXNG để bật công cụ <code>web_search</code> cho agent, node workflow "Web
          Search", và web fallback của Tìm sâu (Deep RAG).
        </div>

        <Card className="mb-4 space-y-3">
          <div className="font-semibold">Cấu hình</div>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Trạng thái:</span>
            <Chip variant={cfg?.configured ? "success" : "danger"}>
              {cfg?.configured ? "Đã cấu hình" : "Chưa cấu hình"}
            </Chip>
            <span className="text-muted text-xs">
              {sourceLabel}
              {cfg?.configured ? ` · ${cfg.endpointMasked}` : ""}
            </span>
          </div>

          <details className="rounded-md border border-border bg-surface-2/40 text-sm group">
            <summary className="cursor-pointer select-none px-3 py-2 font-medium flex items-center gap-2 hover:bg-surface-2/70">
              <I.HelpCircle size={14} />
              <span>Hướng dẫn dựng SearXNG</span>
            </summary>
            <div className="px-3 pb-3 pt-1 space-y-2 text-[13px] leading-relaxed">
              <p>
                SearXNG là metasearch engine tự host — không gửi truy vấn ra bên thứ ba và không cần
                API key.
              </p>
              <ol className="list-decimal pl-5 space-y-1.5">
                <li>
                  Dựng SearXNG (vd <code>docker run -d -p 8080:8080 searxng/searxng</code>).
                </li>
                <li>
                  Bật JSON format: trong <code>settings.yml</code> mục <code>search.formats</code>{" "}
                  thêm <code>json</code> (mặc định chỉ có <code>html</code>).
                </li>
                <li>
                  Nhập URL SearXNG bên dưới (vd <code>http://127.0.0.1:8080</code>). Nếu đặt sau
                  reverse-proxy basic-auth, dùng dạng <code>https://user:pass@host</code>.
                </li>
                <li>
                  Bấm <b>Kiểm tra</b> (phải hiện ✓) → <b>Lưu cấu hình</b>.
                </li>
              </ol>
              <div className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs">
                ⚠ Bắt buộc bật <code>json</code> trong <code>search.formats</code> của SearXNG —
                thiếu thì API trả HTML/403 và Kiểm tra sẽ lỗi.
              </div>
            </div>
          </details>

          <FormField
            label="URL SearXNG"
            hint={
              cfg?.configured
                ? "Đã lưu URL (mã hoá). Để trống nếu giữ nguyên; nhập URL mới để thay."
                : "Vd http://127.0.0.1:8080 hoặc https://user:pass@searxng.example.com"
            }
          >
            <Input
              placeholder={
                cfg?.configured ? "Đã có URL — nhập URL mới để thay…" : "http://127.0.0.1:8080"
              }
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
            />
          </FormField>

          <div className="flex gap-2 pt-1">
            <Button
              variant="default"
              icon={<I.Power size={13} />}
              disabled={busy || !canEdit}
              onClick={test}
            >
              Kiểm tra
            </Button>
            <Button
              variant="primary"
              icon={<I.Save size={13} />}
              disabled={busy || !url.trim() || !canEdit}
              onClick={save}
            >
              Lưu cấu hình
            </Button>
          </div>
        </Card>

        {msg && (
          <div className="mt-4">
            <Chip variant="success">{msg}</Chip>
          </div>
        )}
        {err && (
          <div className="mt-4">
            <Chip variant="danger">{err}</Chip>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/web-search")({ component: WebSearchPage });
