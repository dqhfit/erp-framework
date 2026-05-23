# Tích hợp IoT

Module IoT cho phép thiết bị (ESP32 / Raspberry Pi / PLC / mobile app…) gửi
telemetry về và nhận lệnh từ ERP Framework. Hỗ trợ **HTTP REST** và **MQTT**.
Telemetry có thể kích hoạt workflow theo bộ lọc thiết bị/kênh.

## 1. Tạo thiết bị

Trong app: **Sidebar → Thiết bị IoT → Thêm thiết bị**. Lưu device key NGAY
(chỉ hiện 1 lần).

Hoặc qua tRPC admin (`iot.devices.create`).

## 2. HTTP REST — đơn giản nhất

Mọi request kèm header `X-Device-Key: <key>`.

### Gửi telemetry

```bash
curl -X POST https://YOUR-APP/iot/v1/telemetry \
  -H "X-Device-Key: <key>" \
  -H "content-type: application/json" \
  -d '{"channel":"temperature","payload":{"value":28.5,"unit":"C"}}'
```

Response: `{"ok":true,"accepted":1,"commands":[{...pending commands...}]}` —
mọi lệnh đang chờ được "piggyback" trong cùng response để tiết kiệm round-trip.

Batch nhiều bản ghi cùng lúc:
```json
{"items":[
  {"channel":"temp","payload":{"v":28.5}},
  {"channel":"hum","payload":{"v":61.2}}
]}
```

### Kéo lệnh

```bash
curl https://YOUR-APP/iot/v1/commands -H "X-Device-Key: <key>"
```

### Báo kết quả lệnh

```bash
curl -X POST https://YOUR-APP/iot/v1/commands/<id>/ack \
  -H "X-Device-Key: <key>" \
  -H "content-type: application/json" \
  -d '{"status":"ack","result":{"executed":true}}'
```

`status` ∈ `ack | error`. Bỏ qua → mặc định `ack`.

## 3. MQTT — realtime push/pull

Broker: cùng host với app, cổng `1883` (xem `docker/docker-compose.yml`
biến `ERP_MQTT_PORT`).

Topic:

| Hướng | Topic | Ai pub | Ai sub |
|---|---|---|---|
| Thiết bị → server | `iot/<deviceId>/telemetry/<channel>` | device | server |
| Server → thiết bị | `iot/<deviceId>/cmd/<commandId>` | server | device |
| Thiết bị → server | `iot/<deviceId>/ack/<commandId>` | device | server |

`<deviceId>` là UUID của thiết bị (xem trong app). KHÔNG dùng device key thô
trong topic (key chỉ tồn tại ở dạng hash trong DB).

**Payload**: JSON. Server tự `JSON.parse` (nếu lỗi → giữ raw string).

**Auth MVP**: broker bật `allow_anonymous true` (không yêu cầu user/pass).
Phù hợp mạng nội bộ tin cậy. Production: tắt anonymous và tạo password file —
xem `docker/mosquitto.conf`.

## 4. Workflow trigger theo telemetry

Workflow có `triggerType = iot_telemetry` sẽ chạy mỗi khi telemetry tới khớp:
- `triggerConfig.deviceId` — (tuỳ chọn) chỉ một thiết bị.
- `triggerConfig.channel` — (tuỳ chọn) chỉ một channel.
- Bỏ trống = match tất cả.

Workflow nhận context:
```json
{
  "iot": {
    "device": {"id": "...", "name": "..."},
    "channel": "temperature",
    "payload": {"value": 28.5},
    "ts": "2026-…"
  }
}
```

## 5. Ví dụ ESP32 (Arduino)

```cpp
#include <WiFi.h>
#include <HTTPClient.h>

const char* DEVICE_KEY = "<paste-here>";
const char* URL = "https://your-app.example.com/iot/v1/telemetry";

void postTelemetry(float t, float h) {
  HTTPClient http;
  http.begin(URL);
  http.addHeader("X-Device-Key", DEVICE_KEY);
  http.addHeader("Content-Type", "application/json");
  String body = "{\"channel\":\"climate\",\"payload\":{\"t\":" +
                String(t,1) + ",\"h\":" + String(h,1) + "}}";
  int code = http.POST(body);
  Serial.printf("telemetry → %d\n", code);
  http.end();
}
```

MQTT (PubSubClient):
```cpp
const char* DEVICE_ID = "<paste-deviceId-here>";
client.publish(("iot/" + String(DEVICE_ID) + "/telemetry/climate").c_str(),
               "{\"t\":28.5,\"h\":61}");
client.subscribe(("iot/" + String(DEVICE_ID) + "/cmd/+").c_str());
```

## 6. Bảo mật

- Device key sinh ngẫu nhiên 32-byte, server chỉ lưu SHA-256. Mất key →
  Xoay key trong UI (thiết bị cần cập nhật).
- REST đi qua HTTPS (do nginx app expose). MQTT nội bộ Docker network →
  không lộ ra Internet (Coolify template).
- Workflow chạy với quyền của workflow tạo ra — KHÔNG kế thừa quyền thiết bị.
- Lệnh server → device đi qua tRPC admin (`iot.commands.queue`), gác bởi
  RBAC `create:iot`.

## 7. Lưu ý vận hành

- **Retention**: `iot_telemetry` append-only — định kỳ chạy `DELETE FROM
  iot_telemetry WHERE ts < now() - interval '30 days'` (cron) nếu volume lớn.
- **High volume**: PostgreSQL plain xử lý tốt vài triệu rows/tháng. Nếu cần
  >100k row/giờ thì cân nhắc TimescaleDB (chuyển bảng telemetry → hypertable).
- **MQTT QoS**: server publish command với QoS 1 (đảm bảo đến ít nhất 1 lần);
  thiết bị xử lý idempotent qua commandId.
