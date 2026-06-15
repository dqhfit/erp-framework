# Máy trạm CAD kết nối ERP MCP (Provider 3)

Hướng dẫn dựng 1 **PC máy trạm** dùng **Claude Code (hoặc AI khác)** để:
đọc sản phẩm/định mức từ ERP → dựng hình bằng **FreeCAD** → ghi bản vẽ
("Bản vẽ AI") ngược về ERP. Mọi kết nối là **outbound từ máy trạm** nên
không dính rủi ro CORS/PNA/firewall của trình duyệt.

```
   [Máy trạm CAD]                                  [ERP server]
   Claude Code
     ├── MCP "erp-cad"  ──HTTPS X-API-Key──▶  POST /mcp/cad
     │      cad_get_product / cad_save_drawing      (scope cad:read|write)
     └── MCP "freecad"  ──local──▶  FreeCAD (dựng 3D + xuất SVG/STEP/STL)
   Luồng: đọc SP (ERP) → dựng (FreeCAD) → cad_save_drawing (ERP) → /banve
```

---

## Bước 1 — Tạo API key trên ERP (1 lần)

Trong app: **Cài đặt → API keys → Tạo key**
- Label: `freecad-workstation`
- Scopes: **`cad:read`** và **`cad:write`** (chỉ 2 scope này — nguyên tắc tối thiểu).
- Lưu lại `sk_...` (chỉ hiện 1 lần).

> Deny-by-default: key chỉ đọc product + ghi bản vẽ, không đụng dữ liệu khác.
> Khoá theo đúng `company_id` của key → không đọc chéo công ty.

## Bước 2 — Đảm bảo ERP đã expose `/mcp/cad`

Endpoint `/mcp/cad` + scope `cad:*` + nginx route là **mới** — prod phải cập nhật:
- **Server**: redeploy image server (mã `mcp-cad.ts` baked trong image).
- **nginx** (volume-mounted): cập nhật `docker/nginx.conf` (đã thêm
  `location = /mcp/cad`) rồi reload:
  `git pull && docker exec <nginx-container> nginx -s reload`.

Kiểm tra nhanh (thay domain + key thật):
```bash
curl -s https://erp.vfmgroup.vn/mcp/cad \
  -H 'content-type: application/json' -H 'X-API-Key: sk_...' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head
# → liệt kê cad_get_product, cad_save_drawing. Nếu trả HTML = nginx chưa route.
```

## Bước 3 — Cài FreeCAD MCP trên máy trạm

Chọn **một** trong hai:

### Cách A — dùng sidecar trong repo (headless, khớp hợp đồng tool)
Cần FreeCAD (có `freecadcmd` trên PATH).
```bash
git clone <repo> && cd erp-framework
FREECAD_MCP_SECRET=ws-secret python3 tooling/freecad-mcp/server.py   # HTTP :8920
```
Tool: `cad_build_panel_box({masp,params:{W,D,H,thickness,hasBack,shelves}})`
→ trả `{format,svg,step,stl}` (base64). Xem `tooling/freecad-mcp/README.md`.

### Cách B — FreeCAD MCP off-the-shelf (neka-nat, dựng hình tương tác)
Cài FreeCAD GUI + addon theo README của `neka-nat/freecad-mcp` (stdio,
điều khiển FreeCAD đang chạy). Nhiều tool hơn nhưng cần GUI.

## Bước 4 — Khai báo 2 MCP server trong Claude Code

```bash
# ERP (remote, HTTP) — đọc/ghi CAD:
claude mcp add --transport http erp-cad https://erp.vfmgroup.vn/mcp/cad \
  --header "X-API-Key: sk_..."

# FreeCAD local — Cách A (HTTP sidecar):
claude mcp add --transport http freecad http://127.0.0.1:8920 \
  --header "X-FreeCAD-Secret: ws-secret"

# …hoặc Cách B (neka-nat, stdio) theo README của họ, ví dụ:
# claude mcp add freecad -- uvx freecad-mcp
```
Kiểm tra: `claude mcp list` → cả `erp-cad` và `freecad` đều "connected".

## Bước 5 — Chạy

Trong Claude Code, prompt ví dụ:
```
Dùng erp-cad đọc sản phẩm <masp>. Dựng tủ gỗ ván bằng freecad theo kích
thước phù hợp (vd 800×400×720, ván 18, 1 kệ). Sau đó lưu bản vẽ về ERP
bằng cad_save_drawing (format svg, kèm step + stl).
```
Luồng tool: `cad_get_product` → `cad_build_panel_box` → `cad_save_drawing`.

Kết quả: 1 record `tr_banve` (phanloai="Bản vẽ AI") + `tr_sanpham.isbvai=true`.
Mở app → `/banve` → sản phẩm → tab **"Bản vẽ AI"** → xem SVG + nút **3D**.

## Hợp đồng tool ERP `/mcp/cad`

| Tool | Scope | Tham số chính | Trả |
|---|---|---|---|
| `cad_get_product` | cad:read | `masp` | product (tr_sanpham) + govan + ngukim |
| `cad_save_drawing` | cad:write | `masp`, `format`(svg/html/pdf), `drawingBase64`, `stepBase64?`, `stlBase64?`, `pngBase64?` | `{drawingId, url}` |

## Bảo mật

- Scope key **chỉ `cad:read,cad:write`**; rotate định kỳ (Cài đặt → API keys).
- Secret FreeCAD local (`FREECAD_MCP_SECRET`) chỉ trên máy trạm; sidecar
  KHÔNG mở ra Internet (chỉ `127.0.0.1`).
- ERP validate + giới hạn kích thước artifact phía server; ghi file
  scope theo company/masp (không vượt `BANVE_FILES_DIR`).
- Nếu bật tool execute-arbitrary-Python ở FreeCAD MCP off-the-shelf →
  RCE trên máy trạm (tự quản lý), nên giữ tối thiểu.
