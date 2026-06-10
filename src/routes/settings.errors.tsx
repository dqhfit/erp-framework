/* ==========================================================
   settings.errors — Giao diện ADMIN theo dõi lỗi runtime phía client.
   App tự gửi lỗi về (errors.report); ở đây admin xem, lọc, xem stack,
   đổi trạng thái (resolved/ignored/open) và xoá. Cùng nguồn dữ liệu với
   MCP server /mcp/errors (AI đọc + xoá qua scope errors:read|write).
   ========================================================== */

import {
  createErrorsClient,
  type ErrorDetail,
  type ErrorListItem,
  type ErrorStats,
} from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, Input, Select } from "@/components/ui";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { dialog } from "@/lib/dialog";
import { useAuth } from "@/stores/auth";

const errorsApi = createErrorsClient("");

type StatusFilter = "all" | "open" | "resolved" | "ignored";
type LevelFilter = "all" | "error" | "warn";

const STATUS_CHIP: Record<string, "success" | "warning" | "danger" | "default"> = {
  open: "danger",
  resolved: "success",
  ignored: "default",
};
const STATUS_LABEL: Record<string, string> = {
  open: "Đang mở",
  resolved: "Đã xử lý",
  ignored: "Bỏ qua",
};

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "—";
}

function ErrorsSettings() {
  useDocumentTitle("Giám sát lỗi");
  const role = useAuth((s) => s.user?.role ?? "viewer");
  const isAdmin = role === "admin";

  const [list, setList] = useState<ErrorListItem[]>([]);
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  // Chi tiết đã mở (lazy-load stack qua get) — id → ErrorDetail.
  const [expanded, setExpanded] = useState<Record<string, ErrorDetail | "loading" | undefined>>({});

  const load = useCallback(() => {
    if (!isAdmin) return;
    errorsApi
      .list({
        status: status === "all" ? undefined : status,
        level: level === "all" ? undefined : level,
        q: q.trim() || undefined,
        limit: 300,
      })
      .then(setList)
      .catch((e) => setErr((e as Error).message));
    errorsApi
      .stats()
      .then(setStats)
      .catch(() => {});
  }, [isAdmin, status, level, q]);

  useEffect(() => {
    load();
  }, [load]);

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

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      if (prev[id]) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      // Lazy-load chi tiết (stack đầy đủ).
      void errorsApi
        .get(id)
        .then((d) => setExpanded((p) => ({ ...p, [id]: d })))
        .catch(() => setExpanded((p) => ({ ...p, [id]: undefined })));
      return { ...prev, [id]: "loading" };
    });
  };

  const setOne = (id: string, s: "open" | "resolved" | "ignored", label: string) =>
    void run(() => errorsApi.setStatus({ ids: [id], status: s }).then(() => {}), label);

  const deleteOne = async (e: ErrorListItem) => {
    const ok = await dialog.confirm(`Xoá hẳn lỗi này? "${e.message.slice(0, 80)}"`, {
      title: "Xoá lỗi",
      confirmText: "Xoá",
      danger: true,
    });
    if (ok) void run(() => errorsApi.delete({ ids: [e.id] }).then(() => {}), "✓ Đã xoá lỗi.");
  };

  const clearResolved = async () => {
    const ok = await dialog.confirm("Xoá hẳn tất cả lỗi đã ở trạng thái 'Đã xử lý'?", {
      title: "Dọn lỗi đã xử lý",
      confirmText: "Xoá hết",
      danger: true,
    });
    if (ok) void run(() => errorsApi.clearResolved().then(() => {}), "✓ Đã dọn các lỗi đã xử lý.");
  };

  if (!isAdmin) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <Card className="max-w-md text-center space-y-2">
          <I.AlertOctagon size={28} className="mx-auto text-warning" />
          <div className="font-semibold">Chỉ quản trị viên</div>
          <div className="text-sm text-muted">
            Trang giám sát lỗi chỉ dành cho admin. Liên hệ quản trị viên nếu bạn cần truy cập.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-3 sm:p-8">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-semibold flex-1">Giám sát lỗi</h1>
          <Button size="sm" icon={<I.RefreshCw size={13} />} disabled={busy} onClick={load}>
            Tải lại
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<I.Trash size={13} />}
            disabled={busy || !stats?.resolved}
            onClick={() => void clearResolved()}
            title="Xoá hẳn các lỗi đã xử lý"
          >
            Dọn đã xử lý
          </Button>
        </div>
        <div className="text-sm text-muted mb-4">
          App tự gửi lỗi runtime (uncaught / promise / React) về đây. Lỗi trùng được gom theo chữ ký
          (tăng số lần lặp). AI có thể đọc + xử lý qua MCP <code>/mcp/errors</code> (scope{" "}
          <code>errors:read|write</code> ở Khoá API).
        </div>

        {/* Thống kê nhanh */}
        {stats && (
          <div className="flex flex-wrap gap-2 mb-4">
            <Chip variant="danger">Đang mở: {stats.open}</Chip>
            <Chip variant="success">Đã xử lý: {stats.resolved}</Chip>
            <Chip variant="default">Bỏ qua: {stats.ignored}</Chip>
            <Chip variant="default">Tổng: {stats.total}</Chip>
          </div>
        )}

        {/* Bộ lọc */}
        <Card className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted flex flex-col gap-1">
            Trạng thái
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="w-36"
            >
              <option value="all">Tất cả</option>
              <option value="open">Đang mở</option>
              <option value="resolved">Đã xử lý</option>
              <option value="ignored">Bỏ qua</option>
            </Select>
          </label>
          <label className="text-xs text-muted flex flex-col gap-1">
            Mức
            <Select
              value={level}
              onChange={(e) => setLevel(e.target.value as LevelFilter)}
              className="w-32"
            >
              <option value="all">Tất cả</option>
              <option value="error">error</option>
              <option value="warn">warn</option>
            </Select>
          </label>
          <label className="text-xs text-muted flex flex-col gap-1 flex-1 min-w-[180px]">
            Tìm trong nội dung
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="vd: Cannot read properties…"
            />
          </label>
        </Card>

        <Card className="space-y-2">
          <div className="font-semibold">Lỗi ({list.length})</div>
          {list.length === 0 && (
            <div className="text-sm text-muted py-4 text-center">
              Không có lỗi nào khớp bộ lọc. 🎉
            </div>
          )}
          {list.map((e) => {
            const det = expanded[e.id];
            const open = det !== undefined;
            return (
              <div key={e.id} className="rounded-md border border-border">
                <button
                  type="button"
                  className="w-full p-3 cursor-pointer hover:bg-hover/40 flex items-start gap-2 text-left"
                  onClick={() => toggleExpand(e.id)}
                >
                  <I.ChevronDown
                    size={14}
                    className={`mt-0.5 text-muted transition-transform shrink-0 ${open ? "" : "-rotate-90"}`}
                  />
                  <Chip variant={e.level === "error" ? "danger" : "warning"}>{e.level}</Chip>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium break-words">{e.message}</div>
                    <div className="text-[11px] text-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>{e.source}</span>
                      {e.count > 1 && <span>×{e.count} lần</span>}
                      <span>Gần nhất: {fmt(e.lastSeenAt)}</span>
                      {e.url && <span className="truncate max-w-[260px]">{e.url}</span>}
                    </div>
                  </div>
                  <Chip variant={STATUS_CHIP[e.status] ?? "default"}>
                    {STATUS_LABEL[e.status] ?? e.status}
                  </Chip>
                </button>

                {open && (
                  <div className="border-t border-border p-3 space-y-2 bg-bg-soft/40">
                    {det === "loading" ? (
                      <div className="text-xs text-muted">Đang tải chi tiết…</div>
                    ) : det ? (
                      <>
                        <div className="text-[11px] text-muted">
                          Lần đầu: {fmt(det.firstSeenAt)} · Gần nhất: {fmt(det.lastSeenAt)} ·{" "}
                          {det.count} lần
                        </div>
                        {det.stack && (
                          <pre className="text-[11px] bg-panel border border-border rounded-md p-2 overflow-auto max-h-60 whitespace-pre-wrap break-words">
                            {det.stack}
                          </pre>
                        )}
                        {det.componentStack && (
                          <div>
                            <div className="text-[11px] font-semibold text-muted mb-1">
                              Component stack (React)
                            </div>
                            <pre className="text-[11px] bg-panel border border-border rounded-md p-2 overflow-auto max-h-40 whitespace-pre-wrap break-words">
                              {det.componentStack}
                            </pre>
                          </div>
                        )}
                        {det.userAgent && (
                          <div className="text-[11px] text-muted break-words">
                            UA: {det.userAgent}
                          </div>
                        )}
                        {det.meta && (
                          <pre className="text-[11px] bg-panel border border-border rounded-md p-2 overflow-auto max-h-32">
                            {JSON.stringify(det.meta, null, 2)}
                          </pre>
                        )}
                      </>
                    ) : (
                      <div className="text-xs text-danger">Không tải được chi tiết.</div>
                    )}

                    <div className="flex flex-wrap gap-1 pt-1">
                      {e.status !== "resolved" && (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<I.Check size={12} />}
                          disabled={busy}
                          onClick={() => setOne(e.id, "resolved", "✓ Đã đánh dấu xử lý.")}
                        >
                          Đã xử lý
                        </Button>
                      )}
                      {e.status !== "ignored" && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => setOne(e.id, "ignored", "✓ Đã bỏ qua.")}
                        >
                          Bỏ qua
                        </Button>
                      )}
                      {e.status !== "open" && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => setOne(e.id, "open", "✓ Đã mở lại.")}
                        >
                          Mở lại
                        </Button>
                      )}
                      <div className="flex-1" />
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<I.Trash size={12} />}
                        disabled={busy}
                        onClick={() => void deleteOne(e)}
                      >
                        Xoá
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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

export const Route = createFileRoute("/settings/errors")({ component: ErrorsSettings });
