# Plan: Hoàn thiện lại đường dẫn các trang hiện tại

> Scope: chỉ lập phương án. Chưa đổi route, chưa đổi page config, chưa sync prod.
> Mục tiêu là có một lộ trình chuẩn hóa URL cho cả route code (`src/routes`) và page config migrate (`migration-plan/ui/pages`) mà không làm mất link/menu đang dùng.

## 1. Hiện trạng cần xử lý

Repo đang có 2 nhóm đường dẫn khác nhau:

- **Route code cố định** trong `src/routes`: dashboard, settings, portal, bản vẽ, sản lượng, kế toán, MES, tools, view page động.
- **Page config từ migration** trong `migration-plan/ui/pages`: khoảng 297 page JSON, chia theo module như `san_pham`, `don_hang`, `dinh_muc`, `san_xuat`, `kho_vat_tu`, `ke_toan`, ...

Các vấn đề có thể gặp:

- URL mới/cũ song song, ví dụ `/banve` và `/ban-ve`.
- Page migrate có tên kỹ thuật dài kiểu `dq_san_pham_sanpham`, chưa có slug thân thiện.
- Menu có thể trỏ page đã đổi tên hoặc page soft-delete.
- Một số trang nên là route code riêng, một số trang nên đi qua `/view/$pageId`.
- Link cũ từ user/bookmark/prod menu cần redirect thay vì 404.

## 2. Nguyên tắc URL

### 2.1 Chuẩn slug

- Dùng tiếng Việt không dấu, kebab-case.
- Không dùng underscore cho URL public.
- Không đưa prefix kỹ thuật `dq_`, `tr_`, `frm_` vào URL người dùng.
- URL theo module nghiệp vụ:

```text
/san-pham
/don-hang
/bao-gia
/dinh-muc
/san-xuat
/kho-vat-tu
/ke-toan
/bao-cao
/bang-mau-ban-ve
```

### 2.2 Phân loại trang

- **App route**: trang có logic riêng, cần code React/server riêng.
  Ví dụ: `/portal`, `/ban-ve`, `/sanluong`, `/settings/...`, `/ketoan/...`.
- **Page config route**: trang migrate/render bằng ConsumerPage.
  URL chuẩn nên trỏ qua slug ổn định, còn runtime vẫn resolve ra page UUID.
- **Alias/legacy route**: đường dẫn cũ chỉ để redirect 301/302 hoặc rewrite nội bộ.

## 3. Kiến trúc đề xuất

### 3.1 Bảng route registry

Tạo một registry cấu hình đường dẫn, nguồn sự thật cho menu và redirect:

```ts
{
  slug: "san-pham",
  label: "Danh sách sản phẩm",
  kind: "page",
  module: "san_pham",
  pageName: "dq_san_pham_sanpham",
  legacy: ["/pages/dq_san_pham_sanpham", "/view/<uuid-cu-neu-co>"]
}
```

Vị trí đề xuất:

- `src/lib/page-routes.ts` cho frontend.
- Nếu cần server resolve slug bằng API: thêm bảng hoặc meta trong `pages.meta`.

### 3.2 Resolve slug sang page UUID

Ưu tiên không đổi `page.id`; chỉ thêm slug/meta:

```json
{
  "meta": {
    "route": {
      "slug": "san-pham",
      "module": "san_pham",
      "legacy": ["dq_san_pham_sanpham"]
    }
  }
}
```

Luồng render:

- `/p/san-pham` hoặc `/san-pham` resolve sang page UUID.
- `/view/$pageId` vẫn giữ để tương thích.
- Menu mới dùng slug; menu cũ vẫn chạy qua UUID.

### 3.3 Redirect legacy

Tạo danh sách redirect rõ ràng:

```text
/banve                  -> /ban-ve
/ban-ve-ky-thuat        -> /ban-ve/ky-thuat
/sanpham                -> /san-pham
/danh-sach-san-pham     -> /san-pham
```

Không xóa route cũ ngay. Giữ ít nhất 1 release để tránh bookmark gãy.

## 4. Lộ trình triển khai

### P0 - Kiểm kê và đóng băng tên trang

Deliverable:

- Sinh inventory từ `src/routes` và `migration-plan/ui/pages`.
- Với mỗi page JSON: ghi `name`, `label`, `module`, `suggestedSlug`, `pageId` nếu có.
- Phát hiện trùng slug, page soft-delete, menu orphan.

Script đề xuất:

```text
tooling/page-routes/audit-pages.mjs
```

Output:

```text
migration-plan/ui/route-inventory.json
migration-plan/ui/route-conflicts.md
```

### P1 - Chuẩn hóa slug cho các trang đang dùng nhiều

Ưu tiên các module:

1. `san_pham`
2. `don_hang`
3. `dinh_muc`
4. `san_xuat`
5. `kho_vat_tu`
6. `ke_toan`
7. `bao_gia`
8. `bang_mau_banve`

Deliverable:

- Thêm `meta.route.slug` vào page config.
- Không đổi UUID.
- Không đổi `name` nếu chưa cần, tránh đẻ page trùng khi sync prod.

### P2 - Thêm route động theo slug

Thêm route:

```text
/p/$slug
```

hoặc nếu muốn URL đẹp ở root:

```text
/$moduleSlug/$pageSlug
```

Khuyến nghị giai đoạn đầu dùng `/p/$slug` để tránh đụng route code hiện có.
Sau khi ổn định mới cân nhắc alias đẹp ở root.

### P3 - Đồng bộ menu sang slug

Menu cần lưu cả 2 thông tin:

- `page_id`: khóa thật, giữ nguyên để không mất binding.
- `route_slug`: đường dẫn hiển thị mới.

Khi render menu:

- Có `route_slug` -> navigate slug.
- Không có -> fallback `/view/$pageId`.

### P4 - Redirect và tương thích ngược

Thêm danh sách alias:

- Alias code route: trong TanStack Router hoặc helper redirect.
- Alias page route: trong route resolver.
- Log alias được dùng để biết link cũ nào còn phổ biến.

### P5 - Kiểm thử

Checklist:

- Tất cả menu item mở được.
- Tất cả legacy URL quan trọng redirect đúng.
- `/view/$pageId` vẫn mở được.
- Page soft-delete không hiện ở menu.
- `legacy_menu_map.page_id` không trỏ page đã xóa.
- Prod sync không tạo page trùng.

E2E smoke đề xuất:

```text
e2e/smoke/page-routes.spec.ts
```

Case chính:

- Login admin.
- Duyệt toàn bộ menu visible.
- Assert không 404, không blank shell.
- Với page config, assert widget đầu tiên render.

## 5. Quy tắc đặt URL theo module

| Module | URL gốc đề xuất | Ví dụ page |
|---|---|---|
| `san_pham` | `/p/san-pham` | Danh sách sản phẩm |
| `don_hang` | `/p/don-hang` | Danh sách đơn hàng |
| `dinh_muc` | `/p/dinh-muc-go-van` | Định mức gỗ ván |
| `san_xuat` | `/p/ke-hoach-san-xuat` | Kế hoạch sản xuất |
| `kho_vat_tu` | `/p/ton-kho-vat-tu` | Tồn kho vật tư |
| `ke_toan` | `/p/cong-no` | Công nợ |
| `bao_gia` | `/p/bao-gia-san-pham` | Báo giá sản phẩm |
| `bang_mau_banve` | `/p/danh-sach-ban-ve` | Danh sách bản vẽ |

## 6. Rủi ro cần tránh

- Không rename `page.name` hàng loạt nếu chưa có cơ chế upsert theo `id`.
- Không bỏ `/view/$pageId` vì nhiều link/menu cũ còn phụ thuộc.
- Không sync config route mới lên prod trước khi code resolver được deploy.
- Không tạo slug ở root nếu trùng route code hiện có.
- Không tự động xóa page trùng nếu chưa so `deleted_at IS NULL` và menu binding.

## 7. Tiêu chí hoàn thành

- Có inventory route/page đầy đủ.
- Mỗi page đang live có slug ổn định.
- Menu dùng URL mới nhưng vẫn giữ `page_id`.
- Legacy URL quan trọng redirect.
- E2E smoke duyệt toàn bộ menu không lỗi.
- Tool sync prod giữ UUID, không đẻ trang trùng.

## 8. Thứ tự làm khuyến nghị

1. Viết audit script và sinh inventory.
2. Chốt slug cho nhóm trang live.
3. Thêm route resolver `/p/$slug`.
4. Gắn `meta.route.slug` cho page config local.
5. Chuyển menu local sang slug.
6. Thêm redirect legacy.
7. Chạy smoke test toàn menu.
8. Deploy code.
9. Sync page/menu config lên prod bằng migration CLI, có dry-run trước.
