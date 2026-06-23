/* ==========================================================
   settings.pages-trash — Thùng rác trang (xoá mềm). Liệt kê trang đã xoá
   (deleted_at != null), cho KHÔI PHỤC (deleted_at=null) hoặc XOÁ VĨNH VIỄN
   (hard delete). Backend: pages.listTrash / restore / purge.
   ========================================================== */
import { createObjectsClient } from "@erp-framework/client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, EmptyState, Input } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { toast } from "@/lib/toast";
import { useUserObjects } from "@/stores/userObjects";

const api = createObjectsClient("");

interface TrashPage {
  id: string;
  name: string;
  label: string;
  icon: string | null;
  deletedAt: string | null;
  updatedAt: string | null;
}

function PagesTrashPage() {
  const hydrate = useUserObjects((s) => s.hydrate);
  const [rows, setRows] = useState<TrashPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.pages.listTrash());
    } catch (e) {
      await dialog.alert(`Lỗi tải thùng rác: ${(e as Error)?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter(
      (r) => !ql || r.label.toLowerCase().includes(ql) || r.name.toLowerCase().includes(ql),
    );
  }, [rows, q]);

  const restore = async (p: TrashPage) => {
    setBusy(p.id);
    try {
      await api.pages.restore(p.id);
      toast.success(`Đã khôi phục “${p.label || p.name}”`);
      setRows((rs) => rs.filter((r) => r.id !== p.id));
      hydrate(); // làm tươi store → trang trở lại sidebar/danh sách + cây menu
    } catch (e) {
      await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  const purge = async (p: TrashPage) => {
    const ok = await dialog.confirm(`Xoá VĨNH VIỄN “${p.label || p.name}”? Không thể hoàn tác.`, {
      title: "Xoá vĩnh viễn",
      danger: true,
      confirmText: "Xoá vĩnh viễn",
    });
    if (!ok) return;
    setBusy(p.id);
    try {
      await api.pages.purge(p.id);
      toast.success("Đã xoá vĩnh viễn");
      setRows((rs) => rs.filter((r) => r.id !== p.id));
    } catch (e) {
      await dialog.alert(`Lỗi: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  const fmt = (s: string | null) => {
    if (!s) return "—";
    try {
      return new Date(s).toLocaleString("vi-VN");
    } catch {
      return s;
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-4 p-4">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-sm font-semibold text-text">
            <I.Trash size={18} className="text-danger" />
            Thùng rác trang
          </h1>
          <p className="text-sm text-muted">
            Trang đã xoá (mềm) — khôi phục lại hoặc xoá vĩnh viễn. Trang trong thùng rác không hiện
            ở menu, sidebar hay danh sách.
          </p>
        </header>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <I.Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm trang đã xoá…"
              className="pl-8"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={load}
            icon={<I.RefreshCw size={14} />}
            title="Tải lại"
          />
        </div>

        <Card className="p-1.5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted">
              <I.Loader size={16} className="animate-spin" />
              Đang tải…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<I.Trash size={28} />}
              title={rows.length === 0 ? "Thùng rác trống" : "Không khớp"}
              hint={
                rows.length === 0
                  ? "Chưa có trang nào bị xoá."
                  : "Không có trang đã xoá nào khớp từ khoá."
              }
            />
          ) : (
            <div className="space-y-0.5">
              {filtered.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
                >
                  <I.File size={15} className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-text">{p.label || p.name}</div>
                    <div className="truncate text-xs text-muted">
                      {p.name} · xoá lúc {fmt(p.deletedAt)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === p.id}
                    onClick={() => restore(p)}
                    icon={<I.Undo size={14} />}
                  >
                    Khôi phục
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === p.id}
                    onClick={() => purge(p)}
                    icon={<I.Trash size={14} />}
                    title="Xoá vĩnh viễn"
                  />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/settings/pages-trash")({
  component: PagesTrashPage,
});
