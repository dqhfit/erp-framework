/* ==========================================================
   /enums — Danh sách enum (option set) tái sử dụng đa ngôn ngữ.
   Field type "enum"/"multi-enum" tham chiếu qua id để chia chung
   danh sách giá trị giữa nhiều entity.
   ========================================================== */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Card, Chip, Input, Switch } from "@/components/ui";
import { I } from "@/components/Icons";
import { createEnumsClient } from "@erp-framework/client";
import { dialog } from "@/lib/dialog";

const ec = createEnumsClient("");

interface EnumRow {
  id: string;
  name: string;
  label: string;
  labelEn: string | null;
  description: string | null;
  enabled: boolean;
  values: Array<{ value: string; label: string; labelEn?: string }>;
}

function EnumsList() {
  const [list, setList] = useState<EnumRow[]>([]);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = () => {
    ec.list().then((r) => setList(r as EnumRow[])).catch(() => { /* ignore */ });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setErr(""); setMsg("");
    try { await fn(); if (ok) setMsg(ok); load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const create = () => void run(async () => {
    const n = name.trim();
    if (!/^[a-z][a-z0-9_]*$/.test(n)) {
      throw new Error("Tên phải snake_case bắt đầu bằng chữ.");
    }
    await ec.save({
      name: n,
      label: label.trim() || n,
      values: [],
    });
    setName(""); setLabel("");
  }, "✓ Đã tạo enum.");

  const doDelete = async (e: EnumRow) => {
    const ok = await dialog.confirm(`Xoá enum "${e.name}"?`, {
      title: "Xoá enum", confirmText: "Xoá",
    });
    if (ok) void run(() => ec.delete(e.id), "✓ Đã xoá.");
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[820px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Enums</h1>
        <div className="text-sm text-muted mb-6">
          Danh sách giá trị tái sử dụng (vd <code>order_status</code>,{" "}
          <code>priority</code>) với nhãn đa ngôn ngữ. Field kiểu{" "}
          <code>enum</code>/<code>multi-enum</code> trỏ qua id để chia chung.
        </div>

        <Card className="mb-4 space-y-2">
          <div className="font-semibold">Enum đã đăng ký</div>
          {list.length === 0 && (
            <div className="text-sm text-muted">Chưa có enum nào.</div>
          )}
          {list.map((e) => (
            <div key={e.id} className="flex items-center gap-2 p-2 rounded-md border border-border">
              <I.Tag size={15} className="text-muted shrink-0" />
              <Link to="/enums/$id" params={{ id: e.id }}
                className="font-medium hover:underline">{e.name}</Link>
              <span className="text-xs text-muted truncate">{e.label}</span>
              <Chip className="!text-[10px]">{e.values?.length ?? 0} giá trị</Chip>
              <Chip variant={e.enabled ? "success" : "default"}>
                {e.enabled ? "Bật" : "Tắt"}
              </Chip>
              <div className="flex-1" />
              <Switch checked={e.enabled}
                onChange={(v) => void run(
                  () => ec.setEnabled(e.id, v).then(() => {}),
                  "✓ Đã cập nhật.")} />
              <Button size="sm" variant="danger" icon={<I.Trash size={12} />}
                disabled={busy} onClick={() => void doDelete(e)} />
            </div>
          ))}
        </Card>

        <Card className="space-y-2">
          <div className="font-semibold">Tạo enum mới</div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="name (snake_case)" value={name} disabled={busy}
              onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Nhãn (vi)" value={label} disabled={busy}
              onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button variant="primary" icon={<I.Plus size={14} />}
            disabled={busy || !name.trim()} onClick={create}>
            Tạo
          </Button>
          <div className="text-xs text-muted">
            Sau khi tạo, mở enum để thêm giá trị + nhãn vi/en.
          </div>
        </Card>

        {msg && <div className="mt-4"><Chip variant="success">{msg}</Chip></div>}
        {err && <div className="mt-4"><Chip variant="danger">{err}</Chip></div>}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/enums/")({
  component: EnumsList,
});
