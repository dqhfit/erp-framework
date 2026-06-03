/* ==========================================================
   settings.api-keys — Quản lý REST API key (sk_xxx) cho mobile
   /external/3rd-party. Scope deny-by-default (P1.3).
   Format scope: "*" | "entity:<name>:read|write" | "entity:*:read|write"
   ========================================================== */

import {
  type ApiKeyCreateResult,
  type ApiKeyListItem,
  createApiKeysClient,
} from "@erp-framework/client";
import { type Role, roleCan } from "@erp-framework/core";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, Input } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { dialog } from "@/lib/dialog";
import { useAuth } from "@/stores/auth";

const apiKeys = createApiKeysClient("");

const SCOPE_HINTS = [
  "*",
  "entity:*:read",
  "entity:*:write",
  "entity:orders:read",
  "entity:orders:write",
];

function ApiKeysSettings() {
  const userRole = useAuth((s) => (s.user?.role ?? "viewer") as Role);
  const canEdit = roleCan(userRole, "edit", "settings");
  const [list, setList] = useState<ApiKeyListItem[]>([]);
  const [label, setLabel] = useState("");
  const [scopesInput, setScopesInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  /** Plaintext key vừa tạo — hiển thị 1 lần trong modal rồi clear. */
  const [createdKey, setCreatedKey] = useState<ApiKeyCreateResult | null>(null);
  /** Key đang ở chế độ edit scope (id) */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editScopes, setEditScopes] = useState("");

  const load = () => {
    apiKeys
      .list()
      .then(setList)
      .catch(() => {
        /* chưa đăng nhập */
      });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: load có closure rỗng
  useEffect(() => {
    load();
  }, []);

  const parseScopes = (s: string): string[] =>
    s
      .split(/[,\n\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);

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

  const create = () => {
    const scopes = parseScopes(scopesInput);
    if (!label.trim()) {
      setErr("Nhãn không được rỗng");
      return;
    }
    if (scopes.length === 0) {
      setErr('Phải chỉ định ít nhất 1 scope (vd "*" hoặc "entity:orders:read")');
      return;
    }
    void run(async () => {
      const r = await apiKeys.create(label.trim(), scopes);
      setCreatedKey(r);
      setLabel("");
      setScopesInput("");
    }, "✓ Đã tạo key. Sao chép plaintext ngay — sẽ không hiện lại.");
  };

  const toggleEnabled = (k: ApiKeyListItem) =>
    void run(
      async () => {
        await apiKeys.setEnabled(k.id, !k.enabled);
      },
      k.enabled ? "✓ Đã vô hiệu hoá key." : "✓ Đã bật key.",
    );

  const doDelete = async (k: ApiKeyListItem) => {
    const ok = await dialog.confirm(
      `Xoá key "${k.label}"? Hành động này không thể hoàn tác — ứng dụng/script dùng key này sẽ bị từ chối.`,
      { title: "Xoá API key", confirmText: "Xoá", danger: true },
    );
    if (ok) void run(() => apiKeys.delete(k.id), "✓ Đã xoá key.");
  };

  const startEditScopes = (k: ApiKeyListItem) => {
    setEditingId(k.id);
    setEditScopes(k.scopes.join("\n"));
  };
  const saveEditScopes = () => {
    if (!editingId) return;
    const id = editingId;
    const scopes = parseScopes(editScopes);
    if (scopes.length === 0) {
      setErr('Phải chỉ định ít nhất 1 scope (vd "*").');
      return;
    }
    void run(async () => {
      await apiKeys.updateScopes(id, scopes);
      setEditingId(null);
      setEditScopes("");
    }, "✓ Đã cập nhật scope.");
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setMsg("✓ Đã chép vào clipboard.");
  };

  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "—";

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[820px] mx-auto p-3 sm:p-8">
        <h1 className="text-xl font-semibold mb-1">Khoá API (REST)</h1>
        <div className="text-sm text-muted mb-6">
          Tạo khoá API (sk_xxx) cho mobile / external / 3rd-party gọi{" "}
          <code className="bg-bg-soft px-1 rounded-sm">/api/v1/entities/:name/*</code> qua header{" "}
          <code className="bg-bg-soft px-1 rounded-sm">X-API-Key</code>. Scope{" "}
          <b>deny-by-default</b> — phải chỉ định ít nhất 1 quyền. Plaintext key chỉ hiện 1 lần khi
          tạo.
        </div>

        <Card className="mb-4 space-y-2">
          <div className="font-semibold">Tạo khoá mới</div>
          <Input
            placeholder="Nhãn (vd: Mobile app iOS)"
            value={label}
            disabled={busy || !canEdit}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="text-xs text-muted">Scope — mỗi dòng 1 quyền:</div>
          <textarea
            className="w-full min-h-[80px] rounded-md border border-border bg-bg-soft p-2 text-sm font-mono"
            placeholder={"vd:\nentity:orders:read\nentity:orders:write"}
            value={scopesInput}
            disabled={busy || !canEdit}
            onChange={(e) => setScopesInput(e.target.value)}
          />
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-muted">Gợi ý:</span>
            {SCOPE_HINTS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy || !canEdit}
                onClick={() => setScopesInput((prev) => (prev ? `${prev}\n${s}` : s))}
                className="text-[11px] px-2 py-0.5 rounded-md border border-border hover:bg-bg-soft font-mono"
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button
              variant="primary"
              icon={<I.Plus size={14} />}
              disabled={busy || !canEdit}
              onClick={create}
            >
              Tạo khoá
            </Button>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="font-semibold">Khoá đã có ({list.length})</div>
          {list.length === 0 && <div className="text-sm text-muted">Chưa có khoá API nào.</div>}
          {list.map((k) => (
            <div key={k.id} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <I.Key size={14} className="text-muted shrink-0" />
                <span className="font-medium">{k.label}</span>
                {!k.enabled && <Chip variant="warning">Đã tắt</Chip>}
                {k.scopes.length === 0 && (
                  <Chip variant="danger" title="Scope rỗng — mọi request sẽ bị từ chối">
                    ⚠ Scope rỗng
                  </Chip>
                )}
                <div className="flex-1" />
                <span className="text-[11px] text-muted">Lần dùng cuối: {fmt(k.lastUsedAt)}</span>
              </div>
              <div className="text-xs font-mono text-muted">
                {k.prefix}… · client_id: {k.clientId}
              </div>
              {editingId === k.id ? (
                <div className="space-y-1">
                  <textarea
                    className="w-full min-h-[60px] rounded-md border border-border bg-bg-soft p-2 text-xs font-mono"
                    value={editScopes}
                    onChange={(e) => setEditScopes(e.target.value)}
                  />
                  <div className="flex gap-1">
                    <Button size="sm" variant="primary" disabled={busy} onClick={saveEditScopes}>
                      Lưu
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingId(null);
                        setEditScopes("");
                      }}
                    >
                      Huỷ
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1 flex-wrap">
                  {k.scopes.map((s) => (
                    <code key={s} className="text-[11px] bg-bg-soft px-1.5 py-0.5 rounded-sm">
                      {s}
                    </code>
                  ))}
                </div>
              )}
              <div className="flex gap-1 pt-1 border-t border-border">
                <Button
                  size="sm"
                  icon={<I.Edit size={12} />}
                  disabled={busy || !canEdit || editingId === k.id}
                  onClick={() => startEditScopes(k)}
                >
                  Sửa scope
                </Button>
                <Button
                  size="sm"
                  variant={k.enabled ? "default" : "primary"}
                  disabled={busy || !canEdit}
                  onClick={() => toggleEnabled(k)}
                >
                  {k.enabled ? "Tắt" : "Bật"}
                </Button>
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="danger"
                  icon={<I.Trash size={12} />}
                  disabled={busy || !canEdit}
                  onClick={() => void doDelete(k)}
                >
                  Xoá
                </Button>
              </div>
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

      {/* Modal hiện plaintext key 1 lần sau khi tạo. */}
      <Modal open={createdKey !== null} onClose={() => setCreatedKey(null)} title="Khoá API mới">
        {createdKey && (
          <div className="space-y-3 text-sm">
            <div>
              <b>Plaintext key</b> — sao chép NGAY, sẽ không hiển thị lại:
            </div>
            <code className="block text-xs bg-bg-soft rounded-sm p-2 break-all">
              {createdKey.plaintext}
            </code>
            <Button
              size="sm"
              variant="primary"
              icon={<I.Copy size={12} />}
              onClick={() => copy(createdKey.plaintext)}
            >
              Chép plaintext
            </Button>
            <div className="border-t border-border pt-3 text-xs text-muted">
              Dùng qua header <code>X-API-Key: {createdKey.plaintext.slice(0, 12)}…</code>.
              <br />
              Ví dụ curl:
              <pre className="bg-bg-soft rounded-sm p-2 mt-1 overflow-x-auto">
                {`curl -H "X-API-Key: ${createdKey.plaintext}" \\
  https://<host>/api/v1/entities/orders/records`}
              </pre>
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => setCreatedKey(null)}>Đã chép, đóng</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export const Route = createFileRoute("/settings/api-keys")({
  component: ApiKeysSettings,
});
