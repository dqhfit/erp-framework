import { createToolsClient, type ToolListItem } from "@erp-framework/client";
import { type Role, roleCan } from "@erp-framework/core";
/* ==========================================================
   /settings/tools — Admin Tool registry.
   3 Tab: Installed | Discovery (scan) | Remote.
   ========================================================== */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, Input, Switch, Tabs } from "@/components/ui";
import { useAuth } from "@/stores/auth";

const tools = createToolsClient("");

function ToolsAdmin() {
  const userRole = useAuth((s) => (s.user?.role ?? "viewer") as Role);
  const canEdit = roleCan(userRole, "edit", "settings");
  const [tab, setTab] = useState<"installed" | "scan" | "remote">("installed");
  const [list, setList] = useState<ToolListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [scanResult, setScanResult] = useState<{
    added: string[];
    updated: string[];
    errors: { path: string; message: string }[];
    total: number;
  } | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");

  const load = () => {
    tools
      .list()
      .then(setList)
      .catch((e) => setErr((e as Error).message));
  };
  useEffect(load, []);

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

  const toggleEnable = (t: ToolListItem, v: boolean) =>
    void run(
      () => tools.enableForCompany(t.id, v).then(() => {}),
      v ? "✓ Đã bật cho công ty." : "✓ Đã tắt.",
    );

  const doSpawn = (t: ToolListItem) =>
    void run(() => tools.spawn(t.id).then(() => {}), "✓ Đã spawn.");
  const doStop = (t: ToolListItem) => void run(() => tools.stop(t.id).then(() => {}), "✓ Đã dừng.");

  const doRescan = () =>
    void run(async () => {
      const r = await tools.rescan();
      setScanResult(r);
    }, "✓ Đã quét xong.");

  const doRegisterRemote = () =>
    void run(async () => {
      if (!remoteUrl.trim()) throw new Error("Thiếu URL manifest");
      await tools.registerRemote(remoteUrl.trim());
      setRemoteUrl("");
    }, "✓ Đã đăng ký tool remote.");

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1100px] mx-auto p-6">
        <h1 className="text-xl font-semibold mb-1">Quản lý Tools</h1>
        <div className="text-sm text-muted mb-4">
          Tools = artifact ngoài monorepo (vd <code>D:\code\cowok\Tools\*</code>). Discover qua
          auto-scan thư mục local hoặc đăng ký URL manifest remote. Bật/tắt riêng cho từng công ty.
        </div>

        <Tabs<"installed" | "scan" | "remote">
          options={[
            { value: "installed", label: "Đã cài" },
            { value: "scan", label: "Discovery" },
            { value: "remote", label: "Remote" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "installed" && (
          <Card className="mt-3 space-y-2">
            {list.length === 0 && (
              <div className="text-sm text-muted">
                Chưa có tool nào — sang tab <strong>Discovery</strong> để quét.
              </div>
            )}
            {list.map((t) => (
              <ToolRow
                key={t.id}
                t={t}
                busy={busy}
                canEdit={canEdit}
                onToggle={(v) => toggleEnable(t, v)}
                onSpawn={() => doSpawn(t)}
                onStop={() => doStop(t)}
              />
            ))}
          </Card>
        )}

        {tab === "scan" && (
          <Card className="mt-3 space-y-3">
            <div className="text-sm text-muted">
              Quét thư mục <code>TOOLS_DIR</code> (env, mặc định
              <code> D:\code\cowok\Tools</code>) tìm
              <code> paperclip.manifest.json</code> + sibling
              <code> erp.tool.json</code> rồi upsert.
            </div>
            <Button
              variant="primary"
              icon={<I.Bolt size={14} />}
              disabled={busy || !canEdit}
              onClick={doRescan}
            >
              Quét ngay
            </Button>
            {scanResult && (
              <div className="text-xs space-y-1">
                <div>
                  Tổng: <strong>{scanResult.total}</strong> manifest
                </div>
                <div className="text-success">
                  Thêm mới ({scanResult.added.length}): {scanResult.added.join(", ") || "—"}
                </div>
                <div className="text-muted">
                  Cập nhật ({scanResult.updated.length}): {scanResult.updated.join(", ") || "—"}
                </div>
                {scanResult.errors.length > 0 && (
                  <div className="text-danger">
                    Lỗi ({scanResult.errors.length}):
                    <ul className="ml-4 list-disc">
                      {scanResult.errors.map((e, i) => (
                        <li key={i}>
                          <code>{e.path}</code>: {e.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}

        {tab === "remote" && (
          <Card className="mt-3 space-y-3">
            <div className="text-sm text-muted">
              Đăng ký tool từ URL manifest public (paperclip.manifest.json). Chặn private/loopback
              IP để tránh SSRF — set
              <code> TOOLS_ALLOW_PRIVATE_REMOTE=1</code> để bỏ chặn.
            </div>
            <div className="flex gap-2">
              <Input
                className="flex-1"
                placeholder="https://…/paperclip.manifest.json"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
              />
              <Button
                variant="primary"
                icon={<I.Plus size={14} />}
                disabled={busy || !remoteUrl.trim() || !canEdit}
                onClick={doRegisterRemote}
              >
                Đăng ký
              </Button>
            </div>
          </Card>
        )}

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

function ToolRow({
  t,
  busy,
  canEdit,
  onToggle,
  onSpawn,
  onStop,
}: {
  t: ToolListItem;
  busy: boolean;
  canEdit: boolean;
  onToggle: (v: boolean) => void;
  onSpawn: () => void;
  onStop: () => void;
}) {
  const nav = useNavigate();
  const canSpawn = t.runtime === "spawn";
  return (
    <div className="flex items-center gap-2 p-2 rounded-md border border-border">
      <I.Wand size={15} className="text-muted shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{t.displayName ?? t.name}</div>
        <div className="text-xs text-muted truncate">
          <code>{t.slug}</code> · v{t.manifest.version}
        </div>
      </div>
      <Chip className="text-[10px]!">{t.kind}</Chip>
      <Chip className="text-[10px]!">{t.runtime}</Chip>
      <Chip
        variant={
          t.status === "running" || t.status === "mounted"
            ? "success"
            : t.status === "error"
              ? "danger"
              : "default"
        }
        className="text-[10px]!"
      >
        {t.status}
      </Chip>
      <Switch checked={t.enabledForCompany} disabled={!canEdit} onChange={onToggle} />
      {canSpawn &&
        (t.status === "running" ? (
          <Button
            size="sm"
            variant="default"
            icon={<I.Power size={12} />}
            disabled={busy || !canEdit}
            onClick={onStop}
          >
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant="default"
            icon={<I.Play size={12} />}
            disabled={busy || !canEdit}
            onClick={onSpawn}
          >
            Spawn
          </Button>
        ))}
      <Button
        size="sm"
        variant="default"
        icon={<I.ArrowRight size={12} />}
        onClick={() => void nav({ to: "/tools/$slug", params: { slug: t.id } })}
      >
        Mở
      </Button>
    </div>
  );
}

export const Route = createFileRoute("/settings/tools")({
  component: ToolsAdmin,
});
