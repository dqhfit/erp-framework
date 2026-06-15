# FreeCAD MCP — sinh bản vẽ CAD cho sản phẩm

Sidecar dựng **3D STEP + bản vẽ 2D SVG** cho sản phẩm nội thất gỗ ván
(họ PoC: thùng/tủ chữ nhật parametric). Dùng cho **Provider 1** (in-app
Agent gọi qua tool `cad_generate`) và làm engine cho **Provider 2b**
(addon local) sau này.

## Thành phần

| File | Vai trò |
|---|---|
| `server.py` | HTTP JSON-RPC shim (chỉ stdlib Python, KHÔNG import FreeCAD). Mỗi `tools/call` spawn `freecadcmd run_build.py`. |
| `run_build.py` | Chạy bởi `freecadcmd` (có FreeCAD API): dựng hình → xuất STEP + SVG. |
| `panel_box.py` | Generator geometry parametric (dùng chung sidecar + addon local). |
| `techdraw_2d.py` | Chiếu HLR `TechDraw.project` → SVG **headless** (không cần GUI/xvfb). |

Hợp đồng tool: `cad_build_panel_box({ masp?, params:{W,D,H,thickness,hasBack,shelves}, format? })`
→ `result.content[0].text` = JSON `{ format:"svg", svg, step }` (base64).

## Chạy

### Docker (provider 1, prod/self-host)
```
docker compose -f docker/docker-compose.yml up -d --build freecad
# server gọi nội bộ http://freecad:8920 (đã cấu hình FREECAD_MCP_URL).
```

### Native, không Docker (provider 2a, máy dev)
Cài FreeCAD (có `freecadcmd` trên PATH) rồi:
```
FREECAD_MCP_SECRET=dev python3 tooling/freecad-mcp/server.py
# rồi đặt trong packages/server/.env:
#   FREECAD_MCP_URL=http://127.0.0.1:8920
#   FREECAD_MCP_SECRET=dev
#   BANVE_FILES_DIR=./.banve
```
Nếu `freecadcmd` không trên PATH, đặt `FREECADCMD=/đường/dẫn/freecadcmd`.

## Test nhanh (cổng chốt đầu ra 2D — Risk #1)

```
# health
curl -s localhost:8920/health
# build 1 tủ 800x400x720, ván 18mm
curl -s -X POST localhost:8920 -H 'content-type: application/json' \
  -H 'x-freecad-secret: dev' -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{"name":"cad_build_panel_box",
      "arguments":{"masp":"TEST","params":{"W":800,"D":400,"H":720,"thickness":18,"shelves":1}}}}'
# → result.content[0].text = JSON {format,svg,step}; decode svg base64, mở bằng trình duyệt.
```

## ⚠ Lưu ý kỹ thuật

- **Bản vẽ 2D = SVG headless** qua `TechDraw.project` (hàm tính toán HLR,
  không đụng Qt). PDF của TechDraw page cần GUI/xvfb → **không làm ở PoC**
  (xem plan Risk #1). Nếu bản FreeCAD đổi API `TechDraw.project`, sửa
  `techdraw_2d.py` (có thể fallback workbench `Drawing.projectToSVG`).
- `panel_box.py`/`techdraw_2d.py`/`run_build.py` **chỉ chạy trong
  freecadcmd** (import FreeCAD) — không import được từ Node/CI thường.
- KHÔNG expose execute-arbitrary-Python (chống RCE đa tenant): chỉ tool
  parametric cố định.
- Build image nặng (~1.5GB gói `freecad`) → lần đầu chậm (Risk #3).
