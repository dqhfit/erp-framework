import { createIotClient, type IotDevice } from "@erp-framework/client";
/* ==========================================================
   iot — Danh sách thiết bị IoT + modal tạo (hiện device key 1 lần).
   Thiết bị gửi telemetry qua REST /iot/v1/telemetry (header
   X-Device-Key) hoặc MQTT (topic iot/<deviceId>/telemetry/<channel>).
   ========================================================== */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { I } from "@/components/Icons";
import { Button, Card, Chip, FormField, Input } from "@/components/ui";
import { dialog } from "@/lib/dialog";

const iot = createIotClient("");

function IotPage() {
  const [devices, setDevices] = useState<IotDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<{ device: IotDevice; key: string } | null>(null);

  const load = useCallback(() => {
    iot.devices
      .list()
      .then((rows) => setDevices(rows as unknown as IotDevice[]))
      .catch(() => {
        /* chưa đăng nhập */
      });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await iot.devices.create({
        name: name.trim(),
        label: label.trim() || undefined,
      });
      setNewKey({ device: res.device as unknown as IotDevice, key: res.key });
      setName("");
      setLabel("");
      setShowCreate(false);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (d: IotDevice) => {
    const ok = await dialog.confirm(
      `Xoá thiết bị "${d.name}"? Mọi telemetry và lệnh liên quan cũng bị xoá.`,
      { title: "Xoá thiết bị", confirmText: "Xoá", danger: true },
    );
    if (!ok) return;
    try {
      await iot.devices.delete(d.id);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-[900px] mx-auto p-3 sm:p-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-xl font-semibold flex-1">Thiết bị IoT</h1>
          <Button variant="primary" icon={<I.Plus size={14} />} onClick={() => setShowCreate(true)}>
            Thêm thiết bị
          </Button>
        </div>
        <div className="text-sm text-muted mb-6">
          Đăng ký thiết bị, nhận telemetry qua REST{" "}
          <code className="text-accent">/iot/v1/telemetry</code> hoặc MQTT, gửi lệnh xuống. Xem{" "}
          <a href="/docs/IOT" className="text-accent hover:underline">
            tài liệu tích hợp
          </a>
          .
        </div>

        {newKey && (
          <Card className="mb-4 border-warning/40 bg-warning/5">
            <div className="font-semibold mb-2">
              ✓ Đã tạo "{newKey.device.name}" — lưu device key NGAY (chỉ hiện 1 lần):
            </div>
            <div className="font-mono text-xs break-all p-2 bg-bg-soft border border-border rounded-sm">
              {newKey.key}
            </div>
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant="default"
                icon={<I.Copy size={12} />}
                onClick={() => void navigator.clipboard.writeText(newKey.key)}
              >
                Sao chép
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNewKey(null)}>
                Đã lưu, đóng
              </Button>
            </div>
          </Card>
        )}

        {showCreate && !newKey && (
          <Card className="mb-4 space-y-2">
            <div className="font-semibold">Thêm thiết bị mới</div>
            <FormField label="Tên (định danh)">
              <Input
                placeholder="vd: kho-bac-1-temp"
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
            <FormField
              label="Nhãn (tuỳ chọn)"
              hint="Mô tả ngắn — chỉ hiển thị trong app, không gửi xuống thiết bị."
            >
              <Input
                placeholder="Nhiệt độ kho Bắc 1"
                value={label}
                disabled={busy}
                onChange={(e) => setLabel(e.target.value)}
              />
            </FormField>
            <div className="flex gap-2">
              <Button variant="primary" disabled={busy || !name.trim()} onClick={create}>
                Tạo
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>
                Huỷ
              </Button>
            </div>
          </Card>
        )}

        <Card className="space-y-2">
          <div className="font-semibold">Danh sách thiết bị ({devices.length})</div>
          {devices.length === 0 && (
            <div className="text-sm text-muted py-4 text-center">
              Chưa có thiết bị. Bấm "Thêm thiết bị" để tạo cái đầu.
            </div>
          )}
          {devices.map((d) => (
            <Link
              key={d.id}
              to="/iot/$id"
              params={{ id: d.id }}
              className="block rounded-md border border-border p-3 hover:bg-hover/30"
            >
              <div className="flex items-center gap-2">
                <I.Server size={14} className="text-muted shrink-0" />
                <span className="font-medium truncate">{d.name}</span>
                {d.label && <span className="text-xs text-muted truncate">— {d.label}</span>}
                <div className="flex-1" />
                {d.lastSeenAt ? (
                  <Chip variant="success" className="text-[10px]!">
                    {new Date(d.lastSeenAt).toLocaleString("vi-VN")}
                  </Chip>
                ) : (
                  <Chip className="text-[10px]!">Chưa kết nối</Chip>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  icon={<I.Trash size={12} />}
                  onClick={(e) => {
                    e.preventDefault();
                    void doDelete(d);
                  }}
                />
              </div>
            </Link>
          ))}
        </Card>

        {err && (
          <div className="mt-4">
            <Chip variant="danger">{err}</Chip>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/iot")({ component: IotPage });
