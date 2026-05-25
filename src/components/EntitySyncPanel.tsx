import { I } from "@/components/Icons";
import { Button, Card, Chip, Switch } from "@/components/ui";
import { dialog } from "@/lib/dialog";
import { createEntitySyncClient } from "@erp-framework/client";
/* ==========================================================
   EntitySyncPanel — Cấu hình ĐỒNG BỘ TỰ ĐỘNG dữ liệu MCP →
   entity_records cho một entity. Khác nút "Đồng bộ từ MCP"
   (chạy thủ công 1 lần phía client): ở đây scheduler SERVER
   chạy theo lịch cron 24/7.

   Mỗi entity tối đa 1 cấu hình. Gồm: bật/tắt, biểu thức cron,
   field khoá (tuỳ chọn), chạy ngay, xem kết quả lần gần nhất.
   ========================================================== */
import { useEffect, useState } from "react";

const esClient = createEntitySyncClient("");

interface EntitySync {
  id: string;
  entityId: string;
  cronExpr: string;
  enabled: boolean;
  pkField: string;
  lastRun: string | Date | null;
  lastStatus: string | null;
  lastSummary: string | null;
  runCount: number;
}

const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: "Mỗi 15 phút", expr: "*/15 * * * *" },
  { label: "Mỗi giờ", expr: "0 * * * *" },
  { label: "8h sáng hằng ngày", expr: "0 8 * * *" },
  { label: "Thứ Hai 9h", expr: "0 9 * * 1" },
];

function fmtTime(v: string | Date | null): string {
  if (!v) return "chưa chạy";
  return new Date(v).toLocaleString("vi-VN");
}

export function EntitySyncPanel({ entityId }: { entityId: string }) {
  const [cfg, setCfg] = useState<EntitySync | null>(null);
  const [cron, setCron] = useState("0 * * * *");
  const [pkField, setPkField] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = () => {
    esClient
      .get(entityId)
      .then((row) => {
        const r = row as EntitySync | null;
        setCfg(r);
        if (r) {
          setCron(r.cronExpr);
          setPkField(r.pkField ?? "");
          setEnabled(r.enabled);
        }
      })
      .catch(() => {
        /* chưa đăng nhập / entity chưa lưu */
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [entityId]);

  const wrap = async (fn: () => Promise<void>, ok: string) => {
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

  const save = () =>
    void wrap(async () => {
      await esClient.save({
        entityId,
        cronExpr: cron.trim(),
        pkField: pkField.trim(),
        enabled,
      });
    }, "✓ Đã lưu lịch đồng bộ.");

  const doRunNow = async () => {
    if (!cfg) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await esClient.runNow(cfg.id);
      setMsg(`Đồng bộ — ${r.status}: ${r.summary.slice(0, 280)}`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!cfg) return;
    const ok = await dialog.confirm("Xoá lịch đồng bộ tự động này?", {
      title: "Xoá lịch đồng bộ",
      confirmText: "Xoá",
    });
    if (ok) void wrap(() => esClient.delete(cfg.id), "✓ Đã xoá lịch.");
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <I.Clock size={15} className="text-accent" />
        <div className="font-semibold">Đồng bộ tự động từ MCP</div>
        {cfg && (
          <Chip variant={cfg.enabled ? "success" : "default"}>
            {cfg.enabled ? "Đang bật" : "Tạm tắt"}
          </Chip>
        )}
      </div>
      <div className="text-xs text-muted">
        Server tự kéo dữ liệu từ tool MCP đã bind cho op <code>list</code> theo lịch cron, rồi
        upsert vào DB theo field khoá (trùng khoá thì cập nhật, chưa có thì thêm). Chạy nền 24/7,
        không cần mở trình duyệt.
      </div>

      {/* Cron presets */}
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
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[200px] font-mono text-xs"
          placeholder="Biểu thức cron (vd 0 * * * *)"
          value={cron}
          disabled={busy}
          onChange={(e) => setCron(e.target.value)}
        />
        <input
          className="input w-[180px] font-mono text-xs"
          placeholder="Field khoá (để trống = tự suy luận)"
          value={pkField}
          disabled={busy}
          onChange={(e) => setPkField(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <Switch checked={enabled} onChange={() => setEnabled((v) => !v)} />
          Bật lịch
        </label>
      </div>

      {/* Kết quả lần gần nhất */}
      {cfg && (
        <div className="text-xs text-muted">
          Lần gần nhất: {fmtTime(cfg.lastRun)} · đã chạy {cfg.runCount} lần
          {cfg.lastStatus && (
            <>
              {" · "}
              <span className={cfg.lastStatus === "error" ? "text-danger" : "text-success"}>
                {cfg.lastStatus}
              </span>
            </>
          )}
        </div>
      )}
      {cfg?.lastSummary && (
        <div className="text-xs bg-bg-soft rounded p-2 whitespace-pre-wrap">{cfg.lastSummary}</div>
      )}

      {/* Hành động */}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          icon={<I.Save size={13} />}
          disabled={busy || !cron.trim()}
          onClick={save}
        >
          {cfg ? "Cập nhật lịch" : "Tạo lịch đồng bộ"}
        </Button>
        {cfg && (
          <Button
            variant="default"
            icon={busy ? <I.Loader size={13} className="animate-spin" /> : <I.Play size={13} />}
            disabled={busy}
            onClick={() => void doRunNow()}
          >
            Đồng bộ ngay
          </Button>
        )}
        {cfg && (
          <Button
            variant="danger"
            icon={<I.Trash size={13} />}
            disabled={busy}
            onClick={() => void doDelete()}
          >
            Xoá lịch
          </Button>
        )}
      </div>

      {msg && <Chip variant="success">{msg}</Chip>}
      {err && <Chip variant="danger">{err}</Chip>}
    </Card>
  );
}
