import { createApiDataSource, createSavedViewsClient, type SavedView } from "@erp-framework/client";
/* ==========================================================
   EntityData — màn hình DỮ LIỆU của một entity (chế độ người
   dùng). Xem danh sách record thật trong DataGrid, thêm record
   mới qua form, xoá record. Tất cả qua ApiDataSource → backend.
   entities/$id render component này khi mode = "consumer".

   S5 features:
   - Tab Active / Đã xoá (toggle includeDeleted).
   - Bulk select + toolbar (Xoá N / Xuất CSV).
   - History drawer per record (version list + diff + revert).
   - Search bar FTS — server-side q param qua records.list.
   ========================================================== */
import { useCallback, useEffect, useMemo, useState } from "react";
import { I } from "@/components/Icons";
import { DataGrid } from "@/components/renderer/DataGrid";
import { Button, Chip, Drawer, FormField, Input, Select } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { pickFieldLabel } from "@/lib/enum-label";
import { applyFieldFormat } from "@/lib/format";
import type { MockEntity } from "@/lib/object-types";
import { useLocale } from "@/stores/locale";
import { useUserObjects } from "@/stores/userObjects";

const api = createApiDataSource("");
const savedViewsApi = createSavedViewsClient("");

type Row = Record<string, unknown> & {
  __id: string;
  __version?: number;
  __deletedAt?: string | null;
};

type Tab = "active" | "deleted";

export function EntityData({ entityId }: { entityId: string }) {
  const entities = useUserObjects((s) => s.entities);
  const ent: MockEntity | undefined = entities.find((e) => e.id === entityId);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("active");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [currentViewId, setCurrentViewId] = useState<string>("");

  // Load saved views per entity; auto-apply view default lần đầu mount.
  useEffect(() => {
    savedViewsApi
      .list(entityId)
      .then((vs) => {
        const list = vs as unknown as SavedView[];
        setViews(list);
        const def = list.find((v) => v.isDefault);
        if (def) {
          setCurrentViewId(def.id);
          const qv = def.query as { q?: string; tab?: Tab } | undefined;
          if (qv?.q) setQ(qv.q);
          if (qv?.tab) setTab(qv.tab);
        }
      })
      .catch(() => {
        /* chưa migrate hoặc chưa đăng nhập */
      });
  }, [entityId]);

  const applyView = (v: SavedView) => {
    setCurrentViewId(v.id);
    const qv = v.query as { q?: string; tab?: Tab };
    setQ(qv?.q ?? "");
    setTab((qv?.tab as Tab) ?? "active");
  };

  const saveCurrentView = async () => {
    const name = (
      await dialog.prompt("Tên view mới?", "View 1", {
        title: "Lưu view",
        confirmText: "Lưu",
      })
    )?.trim();
    if (!name) return;
    try {
      const v = (await savedViewsApi.save({
        entityId,
        name,
        query: { q, tab },
      })) as SavedView | null;
      const fresh = (await savedViewsApi.list(entityId)) as unknown as SavedView[];
      setViews(fresh);
      if (v) setCurrentViewId(v.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const reload = useCallback(() => {
    setLoading(true);
    setErr("");
    api
      .getRecords(entityId, {
        limit: 200,
        includeDeleted: tab === "deleted",
        q: q.trim() || undefined,
      })
      .then((res) => {
        const filtered =
          tab === "deleted"
            ? res.rows.filter((r) => (r as { deletedAt?: unknown }).deletedAt != null)
            : res.rows;
        setRows(
          filtered.map((r) => ({
            ...r.data,
            __id: r.id,
            __version: (r as { version?: number }).version,
            __deletedAt: (r as { deletedAt?: string | null }).deletedAt ?? null,
          })),
        );
        setSelected(new Set());
        setLoading(false);
      })
      .catch((e) => {
        setErr((e as Error).message);
        setLoading(false);
      });
  }, [entityId, tab, q]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: closure ổn định mount-only
  useEffect(() => {
    reload();
  }, []);

  const fields = ent?.fields ?? [];
  const lang = useLocale((s) => s.lang);

  const openAdd = () => {
    setForm(Object.fromEntries(fields.map((f) => [f.name, ""])));
    setSaveErr("");
    setAdding(true);
  };

  const submit = async () => {
    setSaving(true);
    setSaveErr("");
    try {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) if (v !== "") data[k] = v;
      await api.createRecord(entityId, data);
      setAdding(false);
      reload();
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    const ok = await dialog.confirm("Xoá bản ghi này?", {
      title: "Xoá bản ghi",
      confirmText: "Xoá",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteRecord(id);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const restore = async (id: string) => {
    try {
      await api.restoreRecord(id);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    const ok = await dialog.confirm(`Xoá ${selected.size} bản ghi?`, {
      title: "Xoá hàng loạt",
      confirmText: "Xoá",
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.bulkDeleteRecords(entityId, Array.from(selected));
      if (r.errors.length > 0) {
        setErr(`Đã xoá ${r.deleted}; ${r.errors.length} lỗi: ${r.errors[0]?.message}`);
      }
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const exportCsv = async () => {
    try {
      const r = await api.exportRecords(entityId, "csv");
      const blob = new Blob([r.content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ent?.name ?? "records"}-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const toggleRow = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.__id))));

  // biome-ignore lint/correctness/useExhaustiveDependencies: callback refs ổn định trong scope
  const columns = useMemo(
    () => [
      {
        id: "__select",
        header: () => (
          <input
            type="checkbox"
            checked={rows.length > 0 && selected.size === rows.length}
            onChange={toggleAll}
          />
        ),
        cell: (c: { row: { original: Row } }) => (
          <input
            type="checkbox"
            checked={selected.has(c.row.original.__id)}
            onChange={() => toggleRow(c.row.original.__id)}
          />
        ),
      },
      ...fields
        .filter((f) => f.defaultVisible !== false)
        .map((f) => ({
          accessorKey: f.name,
          header: pickFieldLabel(f, lang),
          cell: (c: { getValue: () => unknown }) => applyFieldFormat(f, c.getValue()),
        })),
      {
        id: "__actions",
        header: "",
        cell: (c: { row: { original: Row } }) => (
          <div className="flex items-center gap-2 text-xs">
            {tab === "active" ? (
              <>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(c.row.original.__id)}
                  className="text-accent hover:underline"
                >
                  Lịch sử
                </button>
                <button
                  type="button"
                  onClick={() => del(c.row.original.__id)}
                  className="text-danger hover:underline"
                >
                  Xoá
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => restore(c.row.original.__id)}
                className="text-success hover:underline"
              >
                Khôi phục
              </button>
            )}
          </div>
        ),
      },
    ],
    [fields, selected, rows.length, tab, lang],
  );

  if (!ent) {
    return (
      <div className="p-8 text-center text-muted text-sm">
        Không tìm thấy entity. Có thể đang tải hoặc đã bị xoá.
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1100px] mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold">{ent.name}</h1>
            <div className="text-sm text-muted">
              Dữ liệu — {loading ? "đang tải…" : `${rows.length} bản ghi`}
            </div>
          </div>
          <Button
            variant="primary"
            icon={<I.Plus size={14} />}
            disabled={fields.length === 0 || tab === "deleted"}
            onClick={openAdd}
          >
            Thêm bản ghi
          </Button>
        </div>

        {/* Tabs Active / Đã xoá */}
        <div className="flex items-center gap-2 mb-3">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={`chip ${tab === "active" ? "chip-accent" : ""}`}
          >
            Đang dùng
          </button>
          <button
            type="button"
            onClick={() => setTab("deleted")}
            className={`chip ${tab === "deleted" ? "chip-accent" : ""}`}
          >
            <I.Trash size={11} className="inline mr-1" /> Đã xoá
          </button>
          <div className="flex-1" />
          <div className="relative w-[280px]">
            <I.Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <Input
              className="pl-7"
              placeholder="Tìm kiếm full-text..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {/* Saved views dropdown */}
          <Select
            value={currentViewId}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) {
                setCurrentViewId("");
                return;
              }
              const v = views.find((vv) => vv.id === id);
              if (v) applyView(v);
            }}
            className="w-[160px]"
          >
            <option value="">— View —</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.isDefault ? " ★" : ""}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="default" icon={<I.Save size={11} />} onClick={saveCurrentView}>
            Lưu view
          </Button>
        </div>

        {/* Bulk actions toolbar — chỉ hiện khi có row được chọn */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 mb-3 p-2 rounded-md border border-accent/40 bg-accent/10">
            <Chip variant="accent">{selected.size} đã chọn</Chip>
            <div className="flex-1" />
            {tab === "active" && (
              <Button size="sm" variant="danger" icon={<I.Trash size={11} />} onClick={bulkDelete}>
                Xoá {selected.size}
              </Button>
            )}
            <Button size="sm" variant="default" icon={<I.Save size={11} />} onClick={exportCsv}>
              Xuất CSV
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<I.X size={11} />}
              onClick={() => setSelected(new Set())}
            >
              Bỏ chọn
            </Button>
          </div>
        )}

        {fields.length === 0 && (
          <Chip variant="warning">
            Entity chưa có field — chuyển sang chế độ thiết kế để thêm field trước.
          </Chip>
        )}

        {err && <Chip variant="danger">Lỗi: {err}</Chip>}

        <div className="card p-0 overflow-hidden mt-3">
          <div className="h-[560px]">
            <DataGrid
              data={rows}
              columns={columns}
              toolbar={false}
              emptyText={
                tab === "deleted"
                  ? "Không có bản ghi đã xoá."
                  : q.trim()
                    ? `Không tìm thấy "${q}" — kiểm tra field đã bật Searchable trong EntityDesigner chưa.`
                    : "Chưa có bản ghi nào — bấm Thêm bản ghi."
              }
            />
          </div>
        </div>
      </div>

      {/* Add drawer */}
      <Drawer open={adding} onClose={() => setAdding(false)} title={`Thêm ${ent.name}`}>
        <div className="p-4 space-y-3">
          {fields.map((f) => (
            <FormField key={f.id} label={pickFieldLabel(f, lang) + (f.required ? " *" : "")}>
              {f.type === "select" && f.options?.length ? (
                <Select
                  value={form[f.name] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                >
                  <option value="">— chọn —</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              ) : f.type === "sequence" ? (
                <Input value={form[f.name] ?? ""} readOnly placeholder="(server tự sinh)" />
              ) : (
                <Input
                  type={
                    f.type === "number" || f.type === "currency"
                      ? "number"
                      : f.type === "date"
                        ? "date"
                        : f.type === "email"
                          ? "email"
                          : "text"
                  }
                  value={form[f.name] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                />
              )}
            </FormField>
          ))}
          {saveErr && <Chip variant="danger">{saveErr}</Chip>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Hủy
            </Button>
            <Button
              variant="primary"
              disabled={saving}
              icon={<I.Save size={13} />}
              onClick={submit}
            >
              {saving ? "Đang lưu…" : "Lưu"}
            </Button>
          </div>
        </div>
      </Drawer>

      {/* History drawer */}
      {historyOpen && (
        <HistoryDrawer
          recordId={historyOpen}
          onClose={() => setHistoryOpen(null)}
          onReverted={() => {
            setHistoryOpen(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

/* ─── History drawer (per record) ─────────────────────── */

interface HistoryDrawerProps {
  recordId: string;
  onClose: () => void;
  onReverted: () => void;
}
function HistoryDrawer({ recordId, onClose, onReverted }: HistoryDrawerProps) {
  const [items, setItems] = useState<
    Array<{
      id: string;
      version: number;
      diff: Record<string, { old: unknown; new: unknown }>;
      actorUserId: string | null;
      createdAt: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    setLoading(true);
    setErr("");
    api
      .getRecordHistory(recordId)
      .then((rs) => {
        setItems(rs);
        setLoading(false);
      })
      .catch((e) => {
        setErr((e as Error).message);
        setLoading(false);
      });
  }, [recordId]);

  const revert = async (targetVersion: number) => {
    const ok = await dialog.confirm(
      `Khôi phục về version ${targetVersion}? Sẽ tạo version mới ghi lại sự thay đổi.`,
      { title: "Khôi phục version", confirmText: "Khôi phục" },
    );
    if (!ok) return;
    try {
      await api.revertRecord(recordId, targetVersion);
      onReverted();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Drawer open={true} onClose={onClose} title="Lịch sử bản ghi">
      <div className="p-4 space-y-3">
        {loading && <div className="text-sm text-muted">Đang tải...</div>}
        {err && <Chip variant="danger">{err}</Chip>}
        {!loading && items.length === 0 && (
          <div className="text-sm text-muted italic">Chưa có lịch sử thay đổi.</div>
        )}
        {items.map((v) => (
          <div key={v.id} className="border border-border rounded-md p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Chip variant="accent">v{v.version}</Chip>
              <span className="text-xs text-muted">
                {new Date(v.createdAt).toLocaleString("vi-VN")}
              </span>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                icon={<I.Undo size={11} />}
                onClick={() => revert(v.version)}
              >
                Revert về đây
              </Button>
            </div>
            <div className="space-y-1">
              {Object.entries(v.diff).length === 0 && (
                <div className="text-xs text-muted italic">(không thay đổi field nào)</div>
              )}
              {Object.entries(v.diff).map(([field, d]) => (
                <div key={field} className="text-xs flex gap-2 items-baseline">
                  <span className="font-mono font-semibold min-w-[100px]">{field}:</span>
                  <span className="line-through text-danger">{stringify(d.old)}</span>
                  <I.ArrowRight size={9} className="text-muted" />
                  <span className="text-success">{stringify(d.new)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

function stringify(v: unknown): string {
  if (v == null) return "∅";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
