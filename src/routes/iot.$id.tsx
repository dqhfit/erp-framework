import {
  createIotClient,
  type IotCommandRow,
  type IotDevice,
  type IotTelemetryRow,
} from "@erp-framework/client";
/* ==========================================================
   iot.$id — Chi tiết thiết bị: telemetry gần đây + hàng đợi lệnh +
   form gửi lệnh + xoay key + xoá thiết bị. Tự refresh mỗi 5s.
   ========================================================== */
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, FormField, Textarea } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const iot = createIotClient("");

function IotDeviceDetail() {
  const { id } = useParams({ from: "/iot/$id" });
  const navigate = useNavigate();
  const [device, setDevice] = useState<IotDevice | null>(null);
  const [telemetry, setTelemetry] = useState<IotTelemetryRow[]>([]);
  const [commands, setCommands] = useState<IotCommandRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [cmdPayload, setCmdPayload] = useState('{"action": "ping"}');
  const [rotated, setRotated] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      iot.devices.list(),
      iot.telemetry.list({ deviceId: id, limit: 100 }),
      iot.commands.list(id, 50),
    ])
      .then(([devs, tel, cmds]) => {
        const list = devs as unknown as IotDevice[];
        setDevice(list.find((d) => d.id === id) ?? null);
        setTelemetry(tel as unknown as IotTelemetryRow[]);
        setCommands(cmds as unknown as IotCommandRow[]);
      })
      .catch((e) => setErr((e as Error).message));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  // Tự làm mới mỗi 5 giây — telemetry chảy về liên tục từ thiết bị.
  useEffect(() => {
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const queueCmd = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const payload = JSON.parse(cmdPayload) as Record<string, unknown>;
      await iot.commands.queue(id, payload);
      setMsg("Đã đưa lệnh vào hàng đợi.");
      load();
    } catch (e) {
      setErr((e as Error).message || "Payload không phải JSON hợp lệ.");
    } finally {
      setBusy(false);
    }
  };

  const rotateKey = async () => {
    const ok = await dialog.confirm(
      "Xoay key sẽ huỷ key cũ. Thiết bị đang dùng key cũ sẽ MẤT kết nối — bạn phải cập nhật firmware. Tiếp tục?",
      { title: "Xoay device key", confirmText: "Xoay key", danger: true },
    );
    if (!ok) return;
    try {
      const r = await iot.devices.rotateKey(id);
      setRotated(r.key);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const doDelete = async () => {
    const ok = await dialog.confirm(
      `Xoá thiết bị "${device?.name ?? ""}"? Mọi telemetry và lệnh liên quan cũng bị xoá.`,
      { title: "Xoá thiết bị", confirmText: "Xoá", danger: true },
    );
    if (!ok) return;
    try {
      await iot.devices.delete(id);
      void navigate({ to: "/iot" });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!device) {
    return <div className="p-8 text-muted">Đang tải…</div>;
  }

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[1000px] mx-auto p-3 sm:p-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-xl font-semibold flex-1">{device.name}</h1>
          <Button size="sm" variant="default" icon={<I.Redo size={12} />} onClick={rotateKey}>
            Xoay key
          </Button>
          <Button size="sm" variant="danger" icon={<I.Trash size={12} />} onClick={doDelete}>
            Xoá
          </Button>
        </div>
        <div className="text-sm text-muted mb-4">
          {device.label && <>{device.label} · </>}
          {device.lastSeenAt ? (
            <>Cập nhật lần cuối {new Date(device.lastSeenAt).toLocaleString("vi-VN")}</>
          ) : (
            <>Chưa kết nối</>
          )}
        </div>

        {rotated && (
          <Card className="mb-4 border-warning/40 bg-warning/5">
            <div className="font-semibold mb-2">⚠ Key MỚI (lưu NGAY, chỉ hiện 1 lần):</div>
            <div className="font-mono text-xs break-all p-2 bg-bg-soft border border-border rounded-sm">
              {rotated}
            </div>
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant="default"
                icon={<I.Copy size={12} />}
                onClick={() => void navigator.clipboard.writeText(rotated)}
              >
                Sao chép
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRotated(null)}>
                Đã lưu
              </Button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Card className="space-y-2">
            <div className="font-semibold">Gửi lệnh xuống thiết bị</div>
            <FormField label="Payload (JSON)">
              <Textarea
                rows={4}
                value={cmdPayload}
                onChange={(e) => setCmdPayload(e.target.value)}
              />
            </FormField>
            <Button
              variant="primary"
              icon={<I.Send size={13} />}
              disabled={busy}
              onClick={queueCmd}
            >
              Đưa vào hàng đợi
            </Button>
          </Card>

          <Card>
            <div className="font-semibold mb-2">Tóm tắt</div>
            <div className="text-sm space-y-1">
              <div>
                Telemetry: <span className="font-medium">{telemetry.length}</span> bản ghi gần đây
              </div>
              <div>
                Lệnh: <span className="font-medium">{commands.length}</span> (
                {commands.filter((c) => c.status === "pending").length} đang chờ)
              </div>
            </div>
          </Card>
        </div>

        <Card className="mt-4">
          <div className="font-semibold mb-2">Telemetry gần đây</div>
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {telemetry.length === 0 && (
              <div className="text-sm text-muted py-2">Chưa có dữ liệu.</div>
            )}
            {telemetry.map((t) => (
              <div
                key={t.id}
                className="text-xs font-mono p-2 bg-bg-soft border border-border rounded-sm"
              >
                <div className="flex items-center gap-2 text-muted mb-1">
                  <Chip className="text-[10px]!">{t.channel}</Chip>
                  <span>{new Date(t.ts).toLocaleString("vi-VN")}</span>
                </div>
                <pre className="whitespace-pre-wrap break-all">
                  {JSON.stringify(t.payload, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </Card>

        <Card className="mt-4">
          <div className="font-semibold mb-2">Hàng đợi lệnh</div>
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
            {commands.length === 0 && <div className="text-sm text-muted py-2">Chưa có lệnh.</div>}
            {commands.map((c) => (
              <div key={c.id} className="text-xs p-2 bg-bg-soft border border-border rounded-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Chip
                    className="text-[10px]!"
                    variant={
                      c.status === "ack"
                        ? "success"
                        : c.status === "error"
                          ? "danger"
                          : c.status === "sent"
                            ? "accent"
                            : undefined
                    }
                  >
                    {c.status}
                  </Chip>
                  <span className="text-muted">
                    {new Date(c.createdAt).toLocaleString("vi-VN")}
                  </span>
                </div>
                <pre className="font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(c.payload, null, 2)}
                </pre>
                {c.result && (
                  <pre className="font-mono whitespace-pre-wrap break-all text-muted mt-1">
                    ↳ {JSON.stringify(c.result)}
                  </pre>
                )}
              </div>
            ))}
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

export const Route = createFileRoute("/iot/$id")({ component: IotDeviceDetail });
