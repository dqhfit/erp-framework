# Tích hợp FreeCAD — Agent vẽ bản vẽ CAD cho sản phẩm

PoC: cho AI sinh **bản vẽ CAD** (3D STEP + bản vẽ 2D SVG) cho sản phẩm
nội thất gỗ ván (họ thùng/tủ chữ nhật parametric), rơi đúng vào luồng
bản vẽ sẵn có — hiện ở tab **"Bản vẽ AI"** của trang mobile `/banve`.

Plan đầy đủ: `~/.claude/plans/enumerated-gathering-curry.md`.

## Kiến trúc (đã làm trong slice này)

Lõi chung + **Provider 1** (in-app Agent) + **Provider 3** (máy trạm
external) + **viewer 3D web**. Provider 2b (browser↔FreeCAD local) để giai đoạn 2.

Sidecar xuất **3D STL** (ngoài STEP) để xem trên web; file 3D lưu cạnh bản
vẽ 2D (`cad-<stamp>-model.stl`), serve qua `GET /banvesvc/model?id=&kind=stl`,
render bằng three.js (lazy chunk ~503KB, chỉ tải khi bấm "3D").

```
                 ┌────────────── persistDrawing (cad-persist.ts) ──────────────┐
                 │  ghi BANVE_FILES_DIR/<company>/<masp>/  + trBanveInsert3      │
                 │  (phanloai="Bản vẽ AI" → tr_sanpham.isbvai) → /banve         │
                 └──────────────────────────────────────────────────────────────┘
   Provider 1                                    Provider 3
   in-app Agent /agent/chat                      máy trạm (Claude Code + FreeCAD MCP local)
     tool cad_generate (cad-tool.ts)               POST /mcp/cad (mcp-cad.ts, X-API-Key)
       → FreeCAD sidecar (HTTP JSON-RPC)             cad_get_product (read)
         FREECAD_MCP_URL                             cad_save_drawing (write) → persistDrawing
       → persistDrawing
```

## File

| File | Vai trò |
|---|---|
| `packages/server/src/cad-persist.ts` | `persistDrawing` dùng chung (ghi file + tr_banve). |
| `packages/server/src/cad-tool.ts` | Provider 1: tool `cad_generate` gọi sidecar + persist. |
| `packages/server/src/mcp-cad.ts` | Provider 3: `/mcp/cad` (cad_get_product / cad_save_drawing), scope `cad:read|write`. |
| `packages/server/src/index.ts` | Wire `cad_generate` vào agent (RBAC create:entity + allowlist + env) + `registerCadMcp`. |
| `packages/server/src/drawing-routes.ts` | `/banvesvc/file` content-type theo đuôi (svg/html/pdf) + CSP cho svg/html. |
| `tooling/freecad-mcp/*` | Sidecar FreeCAD (HTTP shim + generator + projection SVG + **STL export**). Xem README cạnh đó. |
| `docker/freecad/Dockerfile`, `docker/docker-compose.yml` | Service `freecad` + volume `erp-banve` + env. |
| `src/components/Model3dViewer.tsx` | **Viewer 3D web** (three.js + STL, lazy chunk). |
| `src/routes/banve.tsx` | Nút "3D" ở tab "Bản vẽ AI" → mở viewer (lazy Suspense). |
| `drawing-routes.ts` `/banvesvc/model` | Serve artifact 3D anh em (stl/step/png) dẫn xuất từ `tr_banve.filepath`. |

## Cách test end-to-end

### 0) Cổng chốt: sidecar FreeCAD (Risk #1 — làm TRƯỚC)
Xem `tooling/freecad-mcp/README.md` (curl `cad_build_panel_box`, kiểm
SVG mở được). Đây là phần PHẢI validate trên FreeCAD thật.

### 1) Provider 1 — in-app Agent (mobile self-service)
- Đặt env server: `FREECAD_MCP_URL`, `FREECAD_MCP_SECRET`, `BANVE_FILES_DIR`.
  - Docker: `docker compose up -d --build freecad server` (đã cấu hình sẵn).
  - No-Docker (provider 2a): chạy `python3 tooling/freecad-mcp/server.py`
    native + `FREECAD_MCP_URL=http://127.0.0.1:8920` trong `.env`.
- Có sẵn 1 sản phẩm test (`tr_sanpham.f_masp`).
- Chat agent (role có `create:entity`): "tạo bản vẽ CAD cho `<masp>`,
  tủ 800×400×720, ván 18, 1 kệ".
- Kỳ vọng: 1 row `tr_banve` (`phanloai="Bản vẽ AI"`), file svg trong
  `BANVE_FILES_DIR/<company>/<masp>/`, `tr_sanpham.isbvai=true`; mở
  `/banve` → sản phẩm → tab "Bản vẽ AI" → SVG render qua `/banvesvc/file`.
- Fail-closed: thiếu `create:entity` hoặc thiếu `FREECAD_MCP_URL` → tool
  không xuất hiện; agent có allowlist không chứa `cad_generate` → bị chặn.

### 2) Provider 3 — máy trạm external
- Tạo API key scope `cad:read,cad:write` cho công ty.
- `curl /mcp/cad` (`initialize` / `tools/list` / `tools/call`):
  - `cad_get_product {masp}` → product + định mức gỗ ván/ngũ kim.
  - `cad_save_drawing {masp, format:"svg", drawingBase64, stepBase64?}` →
    drawingId + url; xuất hiện ở `/banve`.
- Scope sai → 403; companyId khác (key công ty khác) → không đọc chéo.

## Quyết định / lệch so với plan

- **Bảo mật XSS svg/html**: xử lý ở **server-side CSP** (`/banvesvc/file`
  trả `Content-Security-Policy: script-src 'none'` cho svg/html) thay vì
  thêm `sandbox` vào `<iframe>` trong `banve.tsx` — vì sandbox áp chung
  iframe có thể vỡ trình xem PDF sẵn có (frontend không biết đuôi file từ
  id). CSP đạt cùng mục tiêu mà không regression.
- **Gate provider 1** dùng RBAC `create:entity` + env `FREECAD_MCP_URL` +
  allowlist agent (không bắt buộc `company_tools.enabled` để PoC chạy
  ngay; governance qua bảng `tools`/`company_tools` để follow-up).
- **2D = SVG** (PDF best-effort/để sau — headless PDF cần Qt/xvfb).

## Xem 3D web (đã làm)
- Sidecar xuất STL; `/banvesvc/model?id=&kind=stl|step|png` serve file 3D
  (path-traversal guard + scope company, dẫn xuất sibling từ filepath 2D).
- `Model3dViewer.tsx` (three.js, lazy) — tab "Bản vẽ AI" có nút **3D**:
  xoay/zoom/pan + nút "Tải STEP". Thiếu mô hình → "chưa có mô hình 3D".
- Build: `three` tách chunk lazy 503KB (gzip 128KB) — KHÔNG vào main bundle.

## Chưa làm (follow-up)
- Provider 2b (browser↔FreeCAD local, outbound-WS) — giai đoạn 2.
- PDF qua xvfb; cut-list; map tham số tự động từ định mức; unit test
  cad-persist/cad-tool (mock sidecar); seed `tools` row + `company_tools`
  governance UI.
```
