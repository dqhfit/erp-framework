# Thiết kế: Tách trang Bản vẽ theo từng loại

> Phương án: mỗi loại bản vẽ một trang riêng, dùng chung 1 component.

## 1. Bối cảnh

Hệ thống hiện có 6 loại bản vẽ lưu trong `tr_banve.f_phanloai`:

| Loại | Số bản vẽ | Team chính |
|---|---|---|
| Bản vẽ kỹ thuật | 2.355 | Kỹ thuật |
| Bản vẽ đóng gói | 1.607 | Bao bì / Logistics |
| Bản vẽ phát triển | 397 | R&D |
| Bản vẽ AI | 376 | Design |
| Bản vẽ mẫu | 303 | PPS / Mẫu |
| Bản vẽ dao | 12 | Gia công CNC |

Trang hiện tại (`/ban-ve-ky-thuat`) chỉ show kỹ thuật, không có CRUD, layout còn thô.

---

## 2. Phương án: Tách mỗi loại thành 1 route

### 2.1 Route map

```
/ban-ve/ky-thuat      → Bản vẽ kỹ thuật
/ban-ve/dong-goi      → Bản vẽ đóng gói
/ban-ve/phat-trien    → Bản vẽ phát triển
/ban-ve/ai            → Bản vẽ AI
/ban-ve/mau           → Bản vẽ mẫu
/ban-ve/dao           → Bản vẽ dao
```

Mỗi route là wrapper 1 dòng, truyền `phanloai` vào component chung:

```tsx
// src/routes/ban-ve/ky-thuat.tsx
export const Route = createFileRoute("/ban-ve/ky-thuat")({
  component: () => <BanVeTypePage phanloai="Bản vẽ kỹ thuật" />,
});
```

### 2.2 Component chung `BanVeTypePage`

File: `src/components/ban-ve/BanVeTypePage.tsx`

```
Props: { phanloai: string }

Layout:
┌─────────────────────────────────────────────────────┐
│ Filter bar                                          │
│  [Hệ hàng ▾]  [Mã sản phẩm ▾]      [+ Thêm file]  │
├─────────────────────────────────────────────────────┤
│ Card sản phẩm (khi đã chọn)                         │
│  Mã: SPA009 | Tên: SPANISH MEDIA | KH: ATE | HH: SPANISH │
│  Kích thước: 1800×900×450                           │
├─────────────────────────────────────────────────────┤
│ Bảng danh sách file                                 │
│  STT | Tên file | Định dạng | Ngày tạo | Người up | [Xem] [Xoá] │
├─────────────────────────────────────────────────────┤
│ PDF viewer (khi click [Xem])                        │
│  <iframe src="/f/...">                              │
└─────────────────────────────────────────────────────┘
```

---

## 3. CRUD mỗi trang

### Thêm file (modal)
1. Chọn Hệ hàng → chọn Mã SP (auto-fill Tên SP, Hệ hàng, Khách hàng)
2. Upload file → `POST /upload/file` → nhận `{ url, name }`
3. Nhập thêm: Định dạng (seq1), Tên file hiển thị (seq2) — tự điền từ filename
4. Submit → `POST /banvesvc/banve-create` với `phanloai` cố định theo trang

### Xoá file
- Soft-delete: `DELETE /banvesvc/banve-delete?id=X`
- Confirm dialog trước khi xoá

### Sửa (nếu cần sau)
- Chỉ cho đổi file (upload lại) hoặc sửa seq1/seq2
- Không đổi được masp (phải xoá → thêm mới)

---

## 4. API endpoints cần có

```
GET  /banvesvc/sanpham-by-hehang?hehang=X
     → [{ masp, tensp, hehang }]

GET  /banvesvc/banve-list?masp=X&phanloai=Y
     → [{ id, masp, tensp, hehang, phanloai, filepath, seq1, seq2, create_date }]

GET  /banvesvc/product?masp=X
     → { masp, tensp, hehang, khachhang, dai, rong, cao, mausac }

POST /banvesvc/banve-create
     body: { masp, tensp, hehang, phanloai, filepath, seq1, seq2 }

DELETE /banvesvc/banve-delete?id=X
```

Tất cả đã có hoặc đang có trong `packages/server/src/drawing-routes.ts`.  
`/banvesvc/product` cần bổ sung để lấy đầy đủ thông tin SP cho card.

---

## 5. Định mức Ngũ kim / Gỗ ván

Không đưa vào từng trang bản vẽ (sẽ bị lặp 6 lần, dài không cần thiết).

Phương án xử lý:
- **Trang riêng**: `/dinh-muc/ngukim` + `/dinh-muc/govan` — tra cứu theo mã SP
- **Hoặc**: nút "Xem định mức" trên card sản phẩm → mở drawer/modal

---

## 6. Thứ tự triển khai

1. **Bước 1**: Tạo `BanVeTypePage` component từ code `/ban-ve-ky-thuat` hiện có
   - Extract thành component nhận `phanloai` prop
   - Thêm card sản phẩm (gọi `/banvesvc/product`)
   - Thêm CRUD (modal thêm + nút xoá)

2. **Bước 2**: Tạo 6 route files, mỗi file ~5 dòng

3. **Bước 3**: Thêm endpoint `/banvesvc/product?masp=` vào server

4. **Bước 4**: Thêm menu entries vào sidebar (nhóm "Bản vẽ")

5. **Bước 5** (sau): Trang định mức riêng

---

## 7. Ưu / Nhược

**Ưu:**
- Từng team focus đúng trang của họ → không bị nhiễu
- URL share được, bookmarkable
- Phân quyền RBAC sau này dễ (từng route = 1 object)
- Code không trùng vì dùng component chung

**Nhược:**
- Muốn xem **toàn bộ bản vẽ** của 1 sản phẩm phải mở nhiều tab
- Nếu sau này thêm loại bản vẽ mới → thêm 1 route file (nhỏ, không sao)

**Giải pháp cho nhược điểm**: Có thể thêm trang `/ban-ve/san-pham?masp=X`
(tổng hợp) sau khi 6 trang chính xong, không phải làm ngay.
