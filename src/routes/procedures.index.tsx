import { I } from "@/components/Icons";
import { Button, Card, Chip, Input, Switch, Textarea } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { createProceduresClient } from "@erp-framework/client";
/* ==========================================================
   /procedures — Danh sách native procedure.
   Native procedure = JS chạy server (isolated-vm) với db/entity
   bindings. Dùng thay stored proc MSSQL / MCP tool tính toán.
   ========================================================== */
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

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
  const nav = useNavigate();
  const [list, setList] = useState<ProcRow[]>([]);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  // AI generator state.
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const load = () => {
    procs
      .list()
      .then((r) => setList(r as ProcRow[]))
      .catch(() => {
        /* ignore */
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

  const create = () =>
    void run(async () => {
      const n = name.trim();
      if (!/^[a-z][a-z0-9_]*$/.test(n)) {
        throw new Error("Tên phải snake_case bắt đầu bằng chữ.");
      }
      await procs.save({
        name: n,
        label: label.trim() || n,
        code: "// Hàm procedure. Truy cập: args, db, entity, callTool, fetch, console.\nreturn { hello: args.name ?? 'world' };",
      });
      setName("");
      setLabel("");
    }, "✓ Đã tạo procedure.");

  const doDelete = async (p: ProcRow) => {
    const ok = await dialog.confirm(`Xoá thủ tục "${p.name}"?`, {
      title: "Xoá thủ tục",
      confirmText: "Xoá",
    });
    if (ok) void run(() => procs.delete(p.id), "✓ Đã xoá.");
  };

  /** Gọi AI → preview code → confirm → save → nav tới /procedures/$id. */
  const generateAi = async () => {
    const prompt = aiPrompt.trim();
    if (prompt.length < 5) return;
    setAiBusy(true);
    setErr("");
    setMsg("");
    try {
      const draft = await procs.generateAi(prompt);
      // Preview: name + label + 1 dòng đầu code + đếm dòng total
      const lines = draft.code.split("\n");
      const codePreview =
        lines.slice(0, 4).join("\n") +
        (lines.length > 4 ? `\n  … (${lines.length - 4} dòng nữa)` : "");
      const paramsPreview =
        draft.paramsSchema.length > 0
          ? `\n\nTham số (${draft.paramsSchema.length}):\n${draft.paramsSchema
              .map(
                (p, i) =>
                  `  ${i + 1}. ${String((p as { name?: string }).name ?? "?")}: ${String((p as { type?: string }).type ?? "?")}`,
              )
              .join("\n")}`
          : "";
      const preview = `Tên: ${draft.name}\nNhãn: ${draft.label}${draft.description ? `\nMô tả: ${draft.description}` : ""}${paramsPreview}\n\nCode (${lines.length} dòng):\n${codePreview}`;
      const ok = await dialog.confirm(preview, {
        title: "AI đề xuất Thủ tục — duyệt rồi lưu?",
        confirmText: "Lưu",
      });
      if (!ok) {
        setAiBusy(false);
        return;
      }
      const saved = (await procs.save({
        name: draft.name,
        label: draft.label,
        description: draft.description,
        paramsSchema: draft.paramsSchema,
        code: draft.code,
      })) as { id: string };
      setAiPrompt("");
      setMsg("✓ Đã tạo thủ tục từ AI. Mở để test + chỉnh sửa.");
      load();
      if (saved?.id) void nav({ to: "/procedures/$id", params: { id: saved.id } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[820px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Thủ tục</h1>
        <div className="text-sm text-muted mb-6">
          Thủ tục (procedure) JS chạy server-side với truy cập DB. Thay stored proc MSSQL — invoke
          từ workflow, tRPC, hoặc entity binding.
        </div>

        <Card className="mb-4 space-y-2 bg-accent/5 border-accent/20">
          <div className="font-semibold flex items-center gap-1">
            <I.Sparkles size={14} className="text-accent" /> Tạo bằng AI
          </div>
          <div className="text-xs text-muted">
            Mô tả tác vụ — AI tự sinh tên + tham số + code JS. Bạn duyệt preview, lưu, rồi mở chi
            tiết để test.
          </div>
          <Textarea
            rows={3}
            value={aiPrompt}
            disabled={aiBusy}
            placeholder='VD: "Tính tổng doanh thu theo tháng từ entity orders, trả về mảng {month, total}"'
            onChange={(e) => setAiPrompt(e.target.value)}
          />
          <Button
            variant="primary"
            icon={<I.Sparkles size={14} />}
            disabled={aiBusy || aiPrompt.trim().length < 5}
            onClick={generateAi}
          >
            {aiBusy ? "Đang sinh…" : "Sinh bằng AI"}
          </Button>
        </Card>

        <Card className="mb-4 space-y-2">
          <div className="font-semibold">Thủ tục đã đăng ký</div>
          {list.length === 0 && <div className="text-sm text-muted">Chưa có thủ tục nào.</div>}
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-2 p-2 rounded-md border border-border">
              <I.Terminal size={15} className="text-muted shrink-0" />
              <Link
                to="/procedures/$id"
                params={{ id: p.id }}
                className="font-medium hover:underline"
              >
                {p.name}
              </Link>
              <span className="text-xs text-muted truncate">{p.label}</span>
              <Chip variant={p.enabled ? "success" : "default"}>{p.enabled ? "Bật" : "Tắt"}</Chip>
              <div className="flex-1" />
              <Switch
                checked={p.enabled}
                onChange={(v) =>
                  void run(() => procs.setEnabled(p.id, v).then(() => {}), "✓ Đã cập nhật.")
                }
              />
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
          <div className="font-semibold">Tạo thủ tục thủ công</div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="name (snake_case)"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder="Nhãn hiển thị"
              value={label}
              disabled={busy}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <Button
            variant="primary"
            icon={<I.Plus size={14} />}
            disabled={busy || !name.trim()}
            onClick={create}
          >
            Tạo
          </Button>
          <div className="text-xs text-muted">
            Sau khi tạo, mở thủ tục để viết code và test run.
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

export const Route = createFileRoute("/procedures/")({
  component: ProceduresList,
});
