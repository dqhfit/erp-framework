import { I } from "@/components/Icons";
import { Button, Card, Chip, Switch } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { createHeartbeatsClient } from "@erp-framework/client";
/* ==========================================================
   HeartbeatPanel — Cấu hình "heartbeat" cho một agent: agent tự
   thức dậy theo lịch cron và chạy một nhịp với chỉ dẫn lưu sẵn.
   Nhúng trong trang agent. Gồm: form thêm nhịp, danh sách nhịp
   (bật/tắt, chạy thử, xoá) + tóm tắt kết quả lần gần nhất.
   ========================================================== */
import { useEffect, useState } from "react";

const hbClient = createHeartbeatsClient("");

interface Heartbeat {
  id: string;
  agentId: string;
  cronExpr: string;
  enabled: boolean;
  prompt: string;
  lastRun: string | Date | null;
  lastStatus: string | null;
  lastSummary: string | null;
  runCount: number;
}

const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: "Mỗi giờ", expr: "0 * * * *" },
  { label: "8h sáng hằng ngày", expr: "0 8 * * *" },
  { label: "Mỗi 15 phút", expr: "*/15 * * * *" },
  { label: "Thứ Hai 9h", expr: "0 9 * * 1" },
];

function fmtTime(v: string | Date | null): string {
  if (!v) return "chưa chạy";
  return new Date(v).toLocaleString("vi-VN");
}

export function HeartbeatPanel({ agentId }: { agentId: string }) {
  const [list, setList] = useState<Heartbeat[]>([]);
  const [cron, setCron] = useState("0 8 * * *");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = () => {
    hbClient
      .list(agentId)
      .then((rows) => setList(rows as Heartbeat[]))
      .catch(() => {
        /* chưa đăng nhập / agent chưa lưu */
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [agentId]);

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

  const add = () =>
    void run(async () => {
      await hbClient.save({
        agentId,
        cronExpr: cron.trim(),
        prompt: prompt.trim(),
        enabled: true,
      });
      setPrompt("");
    }, "✓ Đã tạo heartbeat.");

  const toggle = (h: Heartbeat) =>
    void run(
      () =>
        hbClient
          .save({
            id: h.id,
            agentId,
            cronExpr: h.cronExpr,
            prompt: h.prompt,
            enabled: !h.enabled,
          })
          .then(() => {}),
      "✓ Đã cập nhật.",
    );

  const doRunNow = async (h: Heartbeat) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await hbClient.runNow(h.id);
      setMsg(`Chạy thử — ${r.status}: ${r.summary.slice(0, 280)}`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (h: Heartbeat) => {
    const ok = await dialog.confirm("Xoá heartbeat này?", {
      title: "Xoá heartbeat",
      confirmText: "Xoá",
    });
    if (ok) void run(() => hbClient.delete(h.id), "✓ Đã xoá.");
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <I.Clock size={15} className="text-accent" />
        <div className="font-semibold">Heartbeat — agent tự chạy theo lịch</div>
      </div>
      <div className="text-xs text-muted">
        Agent sẽ tự "thức dậy" đúng lịch cron và thực hiện chỉ dẫn bên dưới (chạy nền 24/7, không
        cần ai bấm). Kết quả ghi vào Nhật ký.
      </div>

      {/* Danh sách heartbeat hiện có */}
      <div className="space-y-2">
        {list.map((h) => (
          <div key={h.id} className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <code className="text-xs bg-bg-soft px-1.5 py-0.5 rounded">{h.cronExpr}</code>
              <Chip variant={h.enabled ? "success" : "default"}>
                {h.enabled ? "Đang bật" : "Tắt"}
              </Chip>
              <span className="text-xs text-muted">đã chạy {h.runCount} lần</span>
              <div className="flex-1" />
              <Switch checked={h.enabled} onChange={() => toggle(h)} />
            </div>
            <div className="text-sm whitespace-pre-wrap">{h.prompt}</div>
            <div className="text-xs text-muted">
              Lần gần nhất: {fmtTime(h.lastRun)}
              {h.lastStatus && (
                <>
                  {" · "}
                  <span className={h.lastStatus === "error" ? "text-danger" : "text-success"}>
                    {h.lastStatus}
                  </span>
                </>
              )}
            </div>
            {h.lastSummary && (
              <div className="text-xs bg-bg-soft rounded p-2 whitespace-pre-wrap">
                {h.lastSummary}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="default"
                icon={<I.Play size={12} />}
                disabled={busy}
                onClick={() => void doRunNow(h)}
              >
                Chạy thử
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<I.Trash size={12} />}
                disabled={busy}
                onClick={() => void doDelete(h)}
              >
                Xoá
              </Button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="text-sm text-muted">Chưa có heartbeat nào.</div>}
      </div>

      {/* Form thêm heartbeat */}
      <div className="border-t border-border pt-3 space-y-2">
        <div className="text-sm font-medium">Thêm heartbeat</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {CRON_PRESETS.map((p) => (
            <button
              key={p.expr}
              type="button"
              onClick={() => setCron(p.expr)}
              className={`chip cursor-pointer ${cron === p.expr ? "chip-accent" : ""}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          className="input w-full font-mono text-xs"
          placeholder="Biểu thức cron (vd 0 8 * * *)"
          value={cron}
          disabled={busy}
          onChange={(e) => setCron(e.target.value)}
        />
        <textarea
          className="input w-full text-sm"
          rows={3}
          placeholder="Chỉ dẫn cho agent mỗi nhịp — vd: Tổng hợp đơn hàng mới hôm nay và nêu việc cần ưu tiên."
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <Button
          variant="primary"
          icon={<I.Plus size={14} />}
          disabled={busy || !cron.trim() || !prompt.trim()}
          onClick={add}
        >
          Tạo heartbeat
        </Button>
      </div>

      {msg && <Chip variant="success">{msg}</Chip>}
      {err && <Chip variant="danger">{err}</Chip>}
    </Card>
  );
}
