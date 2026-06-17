/* ==========================================================
   settings.api-keys — Quản lý REST API key (sk_xxx) cho mobile
   /external/3rd-party. Scope deny-by-default (P1.3).
   Format scope: "*" | "entity:<name>:read|write" | "entity:*:read|write"
                 | "feedback:read|propose|apply|*" (MCP /mcp — module Phản hồi)
                 | "errors:read|write|*" (MCP /mcp/errors — module Lỗi)
                 | "migration:read|*" (MCP /mcp/migration — module Migration)
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
import { Button, Card, Chip, Input, Select } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { dialog } from "@/lib/dialog";
import { useAuth } from "@/stores/auth";

const apiKeys = createApiKeysClient("");

/* `a` có BAO TRÙM `b` không (b thừa nếu đã có a)? Khớp đúng logic kiểm tra
   scope phía server: hasScope (rest-api) + hasFeedbackScope (mcp-feedback).
   - "*" bao mọi thứ.
   - entity:*:<act> bao entity:<tên>:<act> (cùng action).
   - feedback:* bao read+propose+apply; feedback:propose bao read; feedback:apply bao read. */
function scopeCovers(a: string, b: string): boolean {
  if (a === b) return true;
  if (a === "*") return true;
  const pa = a.split(":");
  const pb = b.split(":");
  if (pa[0] === "entity" && pb[0] === "entity") {
    // entity:<name>:<action> — action phải khớp, name "*" bao mọi tên.
    return pa[2] === pb[2] && (pa[1] === "*" || pa[1] === pb[1]);
  }
  if (pa[0] === "feedback" && pb[0] === "feedback") {
    if (pa[1] === "*") return true;
    if (pa[1] === "propose") return pb[1] === "read" || pb[1] === "propose";
    // apply (áp trạng thái trực tiếp) bao luôn read — khớp hasFeedbackScope.
    if (pa[1] === "apply") return pb[1] === "read" || pb[1] === "apply";
    return false; // feedback:read chỉ bao chính nó (đã xử lý a===b)
  }
  if (pa[0] === "errors" && pb[0] === "errors") {
    if (pa[1] === "*") return true;
    // write (đổi trạng thái / xoá) bao luôn read — khớp hasErrorScope.
    if (pa[1] === "write") return pb[1] === "read" || pb[1] === "write";
    return false; // errors:read chỉ bao chính nó
  }
  if (pa[0] === "migration" && pb[0] === "migration") {
    if (pa[1] === "*") return true;
    // apply (tool ghi) bao luôn read — khớp hasMigrationScope.
    if (pa[1] === "apply") return pb[1] === "read" || pb[1] === "apply";
    return false; // migration:read chỉ bao chính nó
  }
  if (pa[0] === "backup" && pb[0] === "backup") {
    if (pa[1] === "*") return true;
    // full (tải dump toàn hệ thống) bao luôn read — khớp hasBackupScope.
    if (pa[1] === "full") return pb[1] === "read" || pb[1] === "full";
    return false; // backup:read / backup:run chỉ bao chính nó
  }
  return false;
}

/** Khử trùng + bỏ scope thừa (đã được scope rộng hơn bao). Giữ tập tối giản. */
function normalizeScopes(list: string[]): string[] {
  const uniq = [...new Set(list.filter(Boolean))];
  return uniq.filter((b) => !uniq.some((a) => a !== b && scopeCovers(a, b)));
}

/* Bộ dựng scope trực quan — chọn loại → điền → "Thêm quyền". Sinh đúng
   định dạng SCOPE_RE phía server, tránh gõ tay sai (vd feedback:*:propose).
   Quyền đã chọn hiện dạng chip xoá được. Dùng chung cho tạo mới + sửa. */
function ScopeEditor({
  scopes,
  onChange,
  disabled,
}: {
  scopes: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [kind, setKind] = useState<
    "entity" | "feedback" | "errors" | "migration" | "backup" | "all"
  >("entity");
  const [entityName, setEntityName] = useState("*");
  const [read, setRead] = useState(true);
  const [write, setWrite] = useState(false);
  const [fbLevel, setFbLevel] = useState<"read" | "propose" | "apply">("propose");
  const [errLevel, setErrLevel] = useState<"read" | "write">("read");
  const [migLevel, setMigLevel] = useState<"read" | "apply">("read");
  const [backupLevel, setBackupLevel] = useState<"read" | "run" | "full">("full");

  // Thêm + chuẩn hoá: bỏ trùng VÀ bỏ scope bị scope rộng hơn bao (vd thêm
  // "*" sẽ gom hết; thêm feedback:propose loại bỏ feedback:read thừa).
  const addScopes = (vals: string[]) => {
    onChange(normalizeScopes([...scopes, ...vals]));
  };
  const remove = (s: string) => onChange(scopes.filter((x) => x !== s));

  const addCurrent = () => {
    if (kind === "all") return addScopes(["*"]);
    if (kind === "feedback") return addScopes([`feedback:${fbLevel}`]);
    if (kind === "errors") return addScopes([`errors:${errLevel}`]);
    if (kind === "migration") return addScopes([`migration:${migLevel}`]);
    if (kind === "backup") return addScopes([`backup:${backupLevel}`]);
    const name = entityName.trim() || "*";
    const out: string[] = [];
    if (read) out.push(`entity:${name}:read`);
    if (write) out.push(`entity:${name}:write`);
    addScopes(out.length ? out : [`entity:${name}:read`]);
  };

  return (
    <div className="space-y-2">
      {scopes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {scopes.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 text-[11px] font-mono bg-bg-soft border border-border rounded-md px-1.5 py-0.5"
            >
              {s}
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(s)}
                className="text-muted hover:text-danger"
                title="Xoá quyền"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted">
          Chưa có quyền nào — thêm bên dưới (deny-by-default).
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-bg-soft p-2">
        <label className="text-xs text-muted flex flex-col gap-1">
          Loại quyền
          <Select
            value={kind}
            disabled={disabled}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="w-40"
          >
            <option value="entity">Dữ liệu (entity)</option>
            <option value="feedback">Phản hồi (MCP)</option>
            <option value="errors">Lỗi (MCP)</option>
            <option value="migration">Migration (MCP)</option>
            <option value="backup">Sao lưu (MCP)</option>
            <option value="all">Toàn quyền (*)</option>
          </Select>
        </label>

        {kind === "entity" && (
          <>
            <label className="text-xs text-muted flex flex-col gap-1">
              Entity
              <Input
                value={entityName}
                disabled={disabled}
                onChange={(e) => setEntityName(e.target.value)}
                placeholder="* hoặc tên, vd orders"
                className="w-44"
              />
            </label>
            <div className="flex gap-1 pb-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => setRead((v) => !v)}
                className={`chip cursor-pointer ${read ? "chip-accent" : ""}`}
              >
                {read ? "✓ " : ""}read
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setWrite((v) => !v)}
                className={`chip cursor-pointer ${write ? "chip-accent" : ""}`}
              >
                {write ? "✓ " : ""}write
              </button>
            </div>
          </>
        )}

        {kind === "feedback" && (
          <label className="text-xs text-muted flex flex-col gap-1">
            Mức
            <Select
              value={fbLevel}
              disabled={disabled}
              onChange={(e) => setFbLevel(e.target.value as typeof fbLevel)}
              className="w-56"
            >
              <option value="read">read — chỉ đọc</option>
              <option value="propose">propose — đọc + tạo đề xuất</option>
              <option value="apply">apply — đọc + áp trạng thái trực tiếp (AI tự set)</option>
            </Select>
          </label>
        )}

        {kind === "errors" && (
          <label className="text-xs text-muted flex flex-col gap-1">
            Mức
            <Select
              value={errLevel}
              disabled={disabled}
              onChange={(e) => setErrLevel(e.target.value as typeof errLevel)}
              className="w-64"
            >
              <option value="read">read — chỉ đọc lỗi</option>
              <option value="write">write — đọc + đổi trạng thái / xoá lỗi (AI tự xử lý)</option>
            </Select>
          </label>
        )}

        {kind === "migration" && (
          <label className="text-xs text-muted flex flex-col gap-1">
            Mức
            <Select
              value={migLevel}
              disabled={disabled}
              onChange={(e) => setMigLevel(e.target.value as typeof migLevel)}
              className="w-72"
            >
              <option value="read">read — đọc trạng thái sync / job / entity</option>
              <option value="apply">apply — đọc + bật agentSearchable, rename bảng</option>
            </Select>
          </label>
        )}

        {kind === "backup" && (
          <label className="text-xs text-muted flex flex-col gap-1">
            Mức
            <Select
              value={backupLevel}
              disabled={disabled}
              onChange={(e) => setBackupLevel(e.target.value as typeof backupLevel)}
              className="w-80"
            >
              <option value="read">read — xem dung lượng DB / uploads (backup_info)</option>
              <option value="run">run — kích hoạt backup push-Drive</option>
              <option value="full">full — TẢI dump DB + uploads toàn hệ thống (máy offsite)</option>
            </Select>
          </label>
        )}

        <Button
          size="sm"
          variant="default"
          icon={<I.Plus size={12} />}
          disabled={disabled}
          onClick={addCurrent}
        >
          Thêm quyền
        </Button>
      </div>
    </div>
  );
}

function ApiKeysSettings() {
  const userRole = useAuth((s) => (s.user?.role ?? "viewer") as Role);
  const canEdit = roleCan(userRole, "edit", "settings");
  const [list, setList] = useState<ApiKeyListItem[]>([]);
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  /** Plaintext key vừa tạo — hiển thị 1 lần trong modal rồi clear. */
  const [createdKey, setCreatedKey] = useState<ApiKeyCreateResult | null>(null);
  /** Key đang ở chế độ edit scope (id) */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editScopesArr, setEditScopesArr] = useState<string[]>([]);

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
    if (!label.trim()) {
      setErr("Nhãn không được rỗng");
      return;
    }
    if (scopes.length === 0) {
      setErr("Phải thêm ít nhất 1 quyền.");
      return;
    }
    void run(async () => {
      const r = await apiKeys.create(label.trim(), normalizeScopes(scopes));
      setCreatedKey(r);
      setLabel("");
      setScopes([]);
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
    setEditScopesArr(k.scopes);
  };
  const saveEditScopes = () => {
    if (!editingId) return;
    const id = editingId;
    if (editScopesArr.length === 0) {
      setErr("Phải thêm ít nhất 1 quyền.");
      return;
    }
    void run(async () => {
      await apiKeys.updateScopes(id, normalizeScopes(editScopesArr));
      setEditingId(null);
      setEditScopesArr([]);
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
          <div className="text-xs text-muted">Quyền (scope):</div>
          <ScopeEditor scopes={scopes} onChange={setScopes} disabled={busy || !canEdit} />
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
                  <ScopeEditor scopes={editScopesArr} onChange={setEditScopesArr} disabled={busy} />
                  <div className="flex gap-1">
                    <Button size="sm" variant="primary" disabled={busy} onClick={saveEditScopes}>
                      Lưu
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingId(null);
                        setEditScopesArr([]);
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
