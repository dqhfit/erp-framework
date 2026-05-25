import { I } from "@/components/Icons";
import { Button, Card, Chip, Input, Switch } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { createPluginsClient } from "@erp-framework/client";
/* ==========================================================
   settings.plugins — Plugin registry: đăng ký plugin (manifest),
   bật/tắt lúc chạy (không cần build lại), xuất manifest chia sẻ.
   ========================================================== */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

const plugins = createPluginsClient("");

interface PluginReg {
  id: string;
  name: string;
  version: string;
  manifest: Record<string, unknown>;
  enabled: boolean;
}

function PluginsSettings() {
  const [list, setList] = useState<PluginReg[]>([]);
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [manifestText, setManifestText] = useState('{\n  "description": ""\n}');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = () => {
    plugins
      .list()
      .then((r) => setList(r as PluginReg[]))
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

  const register = () =>
    void run(async () => {
      let manifest: Record<string, unknown> = {};
      try {
        manifest = JSON.parse(manifestText) as Record<string, unknown>;
      } catch {
        throw new Error("Manifest không phải JSON hợp lệ");
      }
      await plugins.save({ name: name.trim(), version: version.trim(), manifest });
      setName("");
    }, "✓ Đã đăng ký plugin.");

  const doExport = async (p: PluginReg) => {
    setErr("");
    setMsg("");
    try {
      const bundle = await plugins.export(p.id);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `plugin-${p.name}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`✓ Đã xuất manifest "${p.name}".`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const doDelete = async (p: PluginReg) => {
    const ok = await dialog.confirm(`Gỡ plugin "${p.name}"?`, {
      title: "Gỡ plugin",
      confirmText: "Gỡ",
    });
    if (ok) void run(() => plugins.delete(p.id), "✓ Đã gỡ plugin.");
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[760px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Plugin</h1>
        <div className="text-sm text-muted mb-6">
          Đăng ký plugin theo manifest, bật/tắt ngay lúc chạy mà không cần build lại, và xuất
          manifest để chia sẻ giữa các bản triển khai.
        </div>

        <Card className="mb-4 space-y-2">
          <div className="font-semibold">Plugin đã đăng ký</div>
          {list.length === 0 && <div className="text-sm text-muted">Chưa có plugin nào.</div>}
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-2 p-2 rounded-md border border-border">
              <I.Folder size={15} className="text-muted shrink-0" />
              <span className="font-medium">{p.name}</span>
              <Chip className="!text-[10px]">v{p.version}</Chip>
              <Chip variant={p.enabled ? "success" : "default"}>{p.enabled ? "Bật" : "Tắt"}</Chip>
              <div className="flex-1" />
              <Switch
                checked={p.enabled}
                onChange={(v) =>
                  void run(() => plugins.setEnabled(p.id, v).then(() => {}), "✓ Đã cập nhật.")
                }
              />
              <Button
                size="sm"
                variant="default"
                icon={<I.Save size={12} />}
                disabled={busy}
                onClick={() => void doExport(p)}
              >
                Xuất
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<I.Trash size={12} />}
                disabled={busy}
                onClick={() => void doDelete(p)}
              />
            </div>
          ))}
        </Card>

        <Card className="space-y-2">
          <div className="font-semibold">Đăng ký / nhập plugin</div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Tên plugin"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder="Phiên bản"
              value={version}
              disabled={busy}
              onChange={(e) => setVersion(e.target.value)}
            />
          </div>
          <textarea
            className="input w-full font-mono text-xs"
            rows={6}
            placeholder="Manifest (JSON)"
            value={manifestText}
            disabled={busy}
            onChange={(e) => setManifestText(e.target.value)}
          />
          <Button
            variant="primary"
            icon={<I.Plus size={14} />}
            disabled={busy || !name.trim()}
            onClick={register}
          >
            Đăng ký plugin
          </Button>
          <div className="text-xs text-muted">
            Đăng ký lại cùng tên = cập nhật. Bật/tắt áp dụng ngay, không cần build lại.
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

export const Route = createFileRoute("/settings/plugins")({
  component: PluginsSettings,
});
