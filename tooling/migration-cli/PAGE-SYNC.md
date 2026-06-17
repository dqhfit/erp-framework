# Đồng bộ trang low-code (`pages`) giữa dev ↔ prod

Trang dev (`erp_sample`) và prod **dùng chung UUID toàn cục**. Đẩy đúng cách =
**giữ nguyên `id`** → update tại chỗ, link menu (`legacy_menu_map.page_id`) giữ
nguyên, KHÔNG đẻ trùng. (Bỏ id = khớp theo `name`; tên drift `<base>_<id6>` thì
mỗi lần đẩy đẻ trang mới — đó là lỗi cũ, xem memory `project_page_sync_id_stable`.)

Tất cả tool: lấy API key MCP từ `~/.claude.json` (không in), DB dev từ
`packages/db/.env`, gọi `https://erp.vfmgroup.vn/mcp/migration`.

## Tool

| Lệnh | Chiều | Ghi chú |
|---|---|---|
| `node tooling/migration-cli/src/sync-pages.mjs` | **2 chiều** ⭐ | Mặc định **DRY** (in kế hoạch). Hội tụ dev↔prod, prod = hub. |
| `… sync-pages.mjs --apply` | 2 chiều | Thực thi. |
| `… sync-pages.mjs --only a,b --apply` | 2 chiều | Chỉ các trang nêu tên. |
| `… sync-pages-to-prod.mjs --only a,b` | dev → prod | Đẩy 1 chiều (giữ id). `--dry` để xem. |
| `… sync-pages-from-prod.mjs` | prod → dev | **PROD-WINS** — ⚠ đè local. KHÔNG chạy khi local mới hơn. |

> Nhiều máy dev: mỗi máy chạy `sync-pages.mjs --apply` để hội tụ. **Luôn xem DRY
> trước.** Hợp cho 1 người nhiều máy — KHÔNG hợp 2 người sửa cùng 1 trang đồng thời.

## `sync-pages.mjs` quyết định ra sao (per trang, khớp theo id)

- Trùng **nội dung** (label+icon+published+content) → **SKIP** (chống ping-pong).
- Khác nội dung → bên `updated_at` **mới hơn thắng**: PUSH (local) / PULL (prod).
- Chỉ có ở prod → **PULL**. Chỉ có ở local → PUSH (mới) hoặc **STRAY** (tên trùng
  `<base>` với trang prod khác id → báo, không đẩy; tự xoá local rồi PULL bản chuẩn).
- Cùng giờ, khác nội dung → **CONFLICT** (báo, tự xử).
- Trang xoá mềm (`deleted_at`) 2 bên đều BỎ QUA (xoá không tự lan).

Kỹ thuật: fetch prod **keyset** (`id > lastId`, KHÔNG offset — offset trôi khi prod
bị sửa đồng thời, sót trang); so nội dung bằng `JSON.stringify(content)` (jsonb chuẩn
hoá key order 2 bên nên khớp).

## AI gọi MCP trực tiếp (không cần repo/DB dev — đẩy/cập-nhật 1 trang)

```json
{"method":"tools/call","params":{"name":"page_create_draft","arguments":{
  "id":"<uuid trang>","name":"...","label":"...","content":[...],
  "overwrite":true,"overwritePublished":true}}}
```

Có `id`: tồn tại → `overwritten`; chưa có → `created` (đúng id đó); trùng-tên-khác-id
→ `name_conflict` (không đè). Soi prod phải lọc `deleted_at IS NULL`.
