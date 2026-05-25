/* ==========================================================
   /enums — Danh sách enum (option set) tái sử dụng đa ngôn ngữ.
   Field type "enum"/"multi-enum" tham chiếu qua id để chia chung
   danh sách giá trị giữa nhiều entity.
   ========================================================== */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button, Card, Chip, Input, Switch, Textarea } from "@/components/ui";
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
  const nav = useNavigate();
  const [list, setList] = useState<EnumRow[]>([]);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  // AI generator state — prompt mô tả + draft preview trước khi save.
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

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
    const ok = await dialog.confirm(`Xoá danh mục "${e.name}"?`, {
      title: "Xoá danh mục", confirmText: "Xoá",
    });
    if (ok) void run(() => ec.delete(e.id), "✓ Đã xoá.");
  };

  /** Gọi AI → preview draft → confirm → save → nav tới /enums/$id. */
  const generateAi = async () => {
    const prompt = aiPrompt.trim();
    if (prompt.length < 3) return;
    setAiBusy(true); setErr(""); setMsg("");
    try {
      const draft = await ec.generateAi(prompt);
      const preview = `Tên: ${draft.name}\nNhãn: ${draft.label}`
        + (draft.labelEn ? ` (EN: ${draft.labelEn})` : "")
        + `\n\n${draft.values.length} giá trị:\n`
        + draft.values.map((v, i) =>
            `  ${i + 1}. ${v.value} — ${v.label}`
            + (v.labelEn ? ` (${v.labelEn})` : "")).join("\n");
      const ok = await dialog.confirm(preview, {
        title: "AI đề xuất Danh mục — duyệt rồi lưu?",
        confirmText: "Lưu",
      });
      if (!ok) { setAiBusy(false); return; }
      const saved = await ec.save({
        name: draft.name,
        label: draft.label,
        labelEn: draft.labelEn,
        description: draft.description,
        values: draft.values,
      }) as { id: string };
      setAiPrompt("");
      setMsg("✓ Đã tạo danh mục từ AI. Mở để chỉnh sửa thêm.");
      load();
      if (saved?.id) void nav({ to: "/enums/$id", params: { id: saved.id } });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[820px] mx-auto p-8">
        <h1 className="text-xl font-semibold mb-1">Danh mục</h1>
        <div className="text-sm text-muted mb-6">
          Danh sách giá trị tái sử dụng (vd <code>order_status</code>,{" "}
          <code>priority</code>) với nhãn đa ngôn ngữ. Field kiểu{" "}
          <code>enum</code>/<code>multi-enum</code> trỏ qua id để chia chung.
        </div>

        <Card className="mb-4 space-y-2 bg-accent/5 border-accent/20">
          <div className="font-semibold flex items-center gap-1">
            <I.Sparkles size={14} className="text-accent" /> Tạo bằng AI
          </div>
          <div className="text-xs text-muted">
            Mô tả ngắn — AI tự sinh tên + nhãn + danh sách giá trị tiếng Việt/Anh.
            Bạn duyệt lại trước khi lưu.
          </div>
          <Textarea rows={2} value={aiPrompt} disabled={aiBusy}
            placeholder='VD: "Trạng thái đơn hàng KD xuất khẩu" hoặc "Loại vật liệu gỗ"'
            onChange={(e) => setAiPrompt(e.target.value)} />
          <Button variant="primary" icon={<I.Sparkles size={14} />}
            disabled={aiBusy || aiPrompt.trim().length < 3}
            onClick={generateAi}>
            {aiBusy ? "Đang sinh…" : "Sinh bằng AI"}
          </Button>
        </Card>

        <Card className="mb-4 space-y-2">
          <div className="font-semibold">Danh mục đã đăng ký</div>
          {list.length === 0 && (
            <div className="text-sm text-muted">Chưa có danh mục nào.</div>
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
          <div className="font-semibold">Tạo danh mục thủ công</div>
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
            Sau khi tạo, mở danh mục để thêm giá trị + nhãn vi/en.
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
