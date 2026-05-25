import { I } from "@/components/Icons";
import { Button, Card, Chip, Input, Switch } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { useT } from "@/hooks/useT";
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
  const t = useT();
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
        throw new Error(t("settings.plugins.invalid_json"));
      }
      await plugins.save({ name: name.trim(), version: version.trim(), manifest });
      setName("");
    }, t("settings.plugins.register_ok"));

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
      setMsg(t("settings.plugins.exported_ok", { name: p.name }));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const doDelete = async (p: PluginReg) => {
    const ok = await dialog.confirm(t("settings.plugins.remove_confirm", { name: p.name }), {
      title: t("settings.plugins.remove_title"),
      confirmText: t("settings.plugins.remove_confirm_btn"),
    });
    if (ok) void run(() => plugins.delete(p.id), t("settings.plugins.removed_ok"));
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[760px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">{t("settings.plugins.title")}</h1>
        <div className="text-sm text-muted mb-6">
          {t("settings.plugins.subtitle")}
        </div>

        <Card className="mb-4 space-y-2">
          <div className="font-semibold">{t("settings.plugins.registered_title")}</div>
          {list.length === 0 && <div className="text-sm text-muted">{t("settings.plugins.empty")}</div>}
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-2 p-2 rounded-md border border-border">
              <I.Folder size={15} className="text-muted shrink-0" />
              <span className="font-medium">{p.name}</span>
              <Chip className="!text-[10px]">v{p.version}</Chip>
              <Chip variant={p.enabled ? "success" : "default"}>{p.enabled ? t("settings.plugins.enabled_chip") : t("settings.plugins.disabled_chip")}</Chip>
              <div className="flex-1" />
              <Switch
                checked={p.enabled}
                onChange={(v) =>
                  void run(() => plugins.setEnabled(p.id, v).then(() => {}), t("settings.plugins.toggle_ok"))
                }
              />
              <Button
                size="sm"
                variant="default"
                icon={<I.Save size={12} />}
                disabled={busy}
                onClick={() => void doExport(p)}
              >
                {t("settings.plugins.export_btn")}
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
          <div className="font-semibold">{t("settings.plugins.register_title")}</div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder={t("settings.plugins.name_ph")}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder={t("settings.plugins.version_ph")}
              value={version}
              disabled={busy}
              onChange={(e) => setVersion(e.target.value)}
            />
          </div>
          <textarea
            className="input w-full font-mono text-xs"
            rows={6}
            placeholder={t("settings.plugins.manifest_ph")}
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
            {t("settings.plugins.register_btn")}
          </Button>
          <div className="text-xs text-muted">
            {t("settings.plugins.register_hint")}
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
