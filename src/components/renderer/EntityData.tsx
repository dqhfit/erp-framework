/* ==========================================================
   EntityData — màn hình DỮ LIỆU của một entity (chế độ người
   dùng). Xem danh sách record thật trong DataGrid, thêm record
   mới qua form, xoá record. Tất cả qua ApiDataSource → backend.
   entities/$id render component này khi mode = "consumer".
   ========================================================== */
import { useState, useEffect, useCallback } from "react";
import { I } from "@/components/Icons";
import { Button, Input, Select, FormField, Drawer, Chip } from "@/components/ui";
import { DataGrid } from "@/components/renderer/DataGrid";
import { useUserObjects } from "@/stores/userObjects";
import { createApiDataSource } from "@erp-framework/client";
import { formatVND } from "@/lib/format";
import type { MockEntity } from "@/lib/object-types";
import { dialog } from "@/lib/dialog";

const api = createApiDataSource("");

type Row = Record<string, unknown> & { __id: string };

export function EntityData({ entityId }: { entityId: string }) {
  const entities = useUserObjects((s) => s.entities);
  const ent: MockEntity | undefined = entities.find((e) => e.id === entityId);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const reload = useCallback(() => {
    setLoading(true); setErr("");
    api.getRecords(entityId, { limit: 200 })
      .then((res) => {
        setRows(res.rows.map((r) => ({ ...r.data, __id: r.id })));
        setLoading(false);
      })
      .catch((e) => { setErr((e as Error).message); setLoading(false); });
  }, [entityId]);

  useEffect(() => { reload(); }, [reload]);

  const fields = ent?.fields ?? [];

  const openAdd = () => {
    setForm(Object.fromEntries(fields.map((f) => [f.name, ""])));
    setSaveErr("");
    setAdding(true);
  };

  const submit = async () => {
    setSaving(true); setSaveErr("");
    try {
      // Bỏ field rỗng — để server validate-on-write tự ép kiểu phần còn lại.
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
      title: "Xoá bản ghi", confirmText: "Xoá", danger: true,
    });
    if (!ok) return;
    try { await api.deleteRecord(id); reload(); }
    catch (e) { setErr((e as Error).message); }
  };

  const columns = [
    ...fields.slice(0, 7).map((f) => ({
      accessorKey: f.name,
      header: f.label,
      cell: (c: { getValue: () => unknown }) => {
        const v = c.getValue();
        if (f.type === "currency") return formatVND(Number(v ?? 0));
        return v == null ? "" : String(v);
      },
    })),
    {
      id: "__actions",
      header: "",
      cell: (c: { row: { original: Row } }) => (
        <button
          onClick={() => del(c.row.original.__id)}
          className="text-danger hover:underline text-xs"
        >Xoá</button>
      ),
    },
  ];

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
          <Button variant="primary" icon={<I.Plus size={14} />}
            disabled={fields.length === 0} onClick={openAdd}>
            Thêm bản ghi
          </Button>
        </div>

        {fields.length === 0 && (
          <Chip variant="warning">
            Entity chưa có field — chuyển sang chế độ thiết kế để thêm field trước.
          </Chip>
        )}

        {err && <Chip variant="danger">Lỗi: {err}</Chip>}

        <div className="card p-0 overflow-hidden mt-3">
          <div className="h-[560px]">
            <DataGrid data={rows} columns={columns}
              emptyText="Chưa có bản ghi nào — bấm “Thêm bản ghi”." />
          </div>
        </div>
      </div>

      <Drawer open={adding} onClose={() => setAdding(false)}
        title={`Thêm ${ent.name}`}>
        <div className="p-4 space-y-3">
          {fields.map((f) => (
            <FormField key={f.id} label={f.label + (f.required ? " *" : "")}>
              {f.type === "select" && f.options?.length ? (
                <Select value={form[f.name] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}>
                  <option value="">— chọn —</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              ) : (
                <Input
                  type={f.type === "number" || f.type === "currency" ? "number"
                    : f.type === "date" ? "date"
                    : f.type === "email" ? "email" : "text"}
                  value={form[f.name] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                />
              )}
            </FormField>
          ))}
          {saveErr && <Chip variant="danger">{saveErr}</Chip>}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" onClick={() => setAdding(false)}>Hủy</Button>
            <Button variant="primary" disabled={saving}
              icon={<I.Save size={13} />} onClick={submit}>
              {saving ? "Đang lưu…" : "Lưu"}
            </Button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
