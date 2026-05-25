import { I } from "@/components/Icons";
import { Button, Card, Chip, Input, Select } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { type EmbedScope, createEmbedClient } from "@erp-framework/client";
/* ==========================================================
   settings.embed — Token nhúng builder vào sản phẩm khác.
   Tạo token + lấy đoạn mã iframe. Trang mở kèm ?embed=1 sẽ ẩn
   chrome (topbar/sidebar) — chế độ nhúng gọn.
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

const embed = createEmbedClient("");

interface EmbedToken {
  id: string;
  token: string;
  label: string;
  scope: string;
}

const SCOPES: EmbedScope[] = ["all", "page", "workflow", "entity"];

function EmbedSettings() {
  const [list, setList] = useState<EmbedToken[]>([]);
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<EmbedScope>("all");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const load = () => {
    embed
      .list()
      .then((r) => setList(r as EmbedToken[]))
      .catch(() => {
        /* chưa đăng nhập */
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
      if (ok) setMsg(ok);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    void run(async () => {
      await embed.create(label.trim() || undefined, scope);
      setLabel("");
    }, "✓ Đã tạo token nhúng.");

  const doRevoke = async (t: EmbedToken) => {
    const ok = await dialog.confirm("Thu hồi token này?", {
      title: "Thu hồi token",
      confirmText: "Thu hồi",
    });
    if (ok) void run(() => embed.revoke(t.id), "✓ Đã thu hồi.");
  };

  const snippet = (t: EmbedToken) =>
    `<iframe src="${origin}/pages/PAGE_ID?embed=1&embed_token=${t.token}"\n  width="100%" height="640" frameborder="0"></iframe>`;

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setMsg("✓ Đã chép vào clipboard.");
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[760px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Nhúng builder (Embed)</h1>
        <div className="text-sm text-muted mb-6">
          Tạo token để nhúng trang designer vào sản phẩm khác qua iframe. Thêm{" "}
          <code className="bg-bg-soft px-1 rounded-sm">?embed=1</code> vào URL để ẩn thanh điều hướng —
          chỉ hiện nội dung.
        </div>

        <Card className="mb-4 space-y-2">
          <div className="font-semibold">Tạo token nhúng</div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Nhãn (vd: Cổng khách hàng)"
              value={label}
              disabled={busy}
              onChange={(e) => setLabel(e.target.value)}
              className="flex-1"
            />
            <Select
              value={scope}
              disabled={busy}
              onChange={(e) => setScope(e.target.value as EmbedScope)}
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Button variant="primary" icon={<I.Plus size={14} />} disabled={busy} onClick={create}>
              Tạo token
            </Button>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="font-semibold">Token nhúng ({list.length})</div>
          {list.length === 0 && <div className="text-sm text-muted">Chưa có token nào.</div>}
          {list.map((t) => (
            <div key={t.id} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <I.Link size={14} className="text-muted shrink-0" />
                <span className="font-medium">{t.label || "(không nhãn)"}</span>
                <Chip className="text-[10px]!">{t.scope}</Chip>
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="danger"
                  icon={<I.Trash size={12} />}
                  disabled={busy}
                  onClick={() => void doRevoke(t)}
                >
                  Thu hồi
                </Button>
              </div>
              <code className="block text-xs bg-bg-soft rounded-sm p-2 break-all">{t.token}</code>
              <pre className="text-[11px] bg-bg-soft rounded-sm p-2 overflow-x-auto whitespace-pre-wrap">
                {snippet(t)}
              </pre>
              <Button
                size="sm"
                variant="default"
                icon={<I.Copy size={12} />}
                onClick={() => copy(snippet(t))}
              >
                Chép đoạn mã
              </Button>
            </div>
          ))}
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

export const Route = createFileRoute("/settings/embed")({
  component: EmbedSettings,
});
