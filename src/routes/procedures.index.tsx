/* ==========================================================
   /procedures — Danh sách native procedure.
   Native procedure = JS chạy server (isolated-vm) với db/entity
   bindings. Dùng thay stored proc MSSQL / MCP tool tính toán.
   ========================================================== */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Card, Chip, Input, Switch } from "@/components/ui";
import { I } from "@/components/Icons";
import { createProceduresClient } from "@erp-framework/client";
import { dialog } from "@/lib/dialog";

const procs = createProceduresClient("");

interface ProcRow {
  id: string;
  name: string;
  label: string;
  description: string | null;
  enabled: boolean;
  updatedAt: string;
}

function ProceduresList() {
  const [list, setList] = useState<ProcRow[]>([]);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = () => {
    procs.list().then((r) => setList(r as ProcRow[])).catch(() => { /* ignore */ });
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
    await procs.save({
      name: n,
      label: label.trim() || n,
      code: "// Hàm procedure. Truy cập: args, db, entity, callTool, fetch, console.\nreturn { hello: args.name ?? 'world' };",
    });
    setName(""); setLabel("");
  }, "✓ Đã tạo procedure.");

  const doDelete = async (p: ProcRow) => {
    const ok = await dialog.confirm(`Xoá procedure "${p.name}"?`, {
      title: "Xoá procedure", confirmText: "Xoá",
    });
    if (ok) void run(() => procs.delete(p.id), "✓ Đã xoá.");
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[820px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Procedures</h1>
        <div className="text-sm text-muted mb-6">
          JS procedure chạy server-side với truy cập DB. Thay stored
          proc MSSQL — invoke từ workflow, tRPC, hoặc entity binding.
        </div>

        <Card className="mb-4 space-y-2">
          <div className="font-semibold">Procedure đã đăng ký</div>
          {list.length === 0 && (
            <div className="text-sm text-muted">Chưa có procedure nào.</div>
          )}
          {list.map((p) => (
            <div key={p.id}
              className="flex items-center gap-2 p-2 rounded-md border border-border">
              <I.Terminal size={15} className="text-muted shrink-0" />
              <Link to="/procedures/$id" params={{ id: p.id }}
                className="font-medium hover:underline">{p.name}</Link>
              <span className="text-xs text-muted truncate">{p.label}</span>
              <Chip variant={p.enabled ? "success" : "default"}>
                {p.enabled ? "Bật" : "Tắt"}
              </Chip>
              <div className="flex-1" />
              <Switch checked={p.enabled}
                onChange={(v) => void run(
                  () => procs.setEnabled(p.id, v).then(() => {}),
                  "✓ Đã cập nhật.")} />
              <Button size="sm" variant="danger" icon={<I.Trash size={12} />}
                disabled={busy} onClick={() => void doDelete(p)} />
            </div>
          ))}
        </Card>

        <Card className="space-y-2">
          <div className="font-semibold">Tạo procedure mới</div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="name (snake_case)" value={name} disabled={busy}
              onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Nhãn hiển thị" value={label} disabled={busy}
              onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button variant="primary" icon={<I.Plus size={14} />}
            disabled={busy || !name.trim()} onClick={create}>
            Tạo
          </Button>
          <div className="text-xs text-muted">
            Sau khi tạo, mở procedure để viết code và test run.
          </div>
        </Card>

        {msg && <div className="mt-4"><Chip variant="success">{msg}</Chip></div>}
        {err && <div className="mt-4"><Chip variant="danger">{err}</Chip></div>}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/procedures/")({
  component: ProceduresList,
});
