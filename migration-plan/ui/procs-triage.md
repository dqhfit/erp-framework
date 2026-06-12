# Triage 101 proc write_logic còn lại (2026-06-12)

Phân loại theo body T-SQL thật (dump từ MSSQL, script
`tooling/migration-cli/src/triage-procs.ts`, chi tiết máy đọc ở
`procs-triage.json`). Đã port 37/138; còn 101 chia như sau:

## 1. `datasource` — 4 proc CHUYỂN DATASOURCE, KHÔNG port code

SELECT phẳng (join many-to-one + filter) — DataSource hiện tại diễn đạt đủ,
lại tự route theo storage.tier nên miễn nhiễm vấn đề cột vật lý f_/ext:

| Proc | Base + relation | Ghi chú |
|---|---|---|
| TR_TONKHO_SUM_GETALL2 | tr_tonkho_sum → tr_material (mavt) | filter makho/trangthai qua widget |
| TR_TONKHO_SUM_GETALL3 | tr_tonkho_sum → tr_material (mavt) | dynamic SQL gốc chỉ là filter điều kiện (soluong >/</= 0) — map thành filter widget |
| TR_TONKHO_SUM_GETBYPRICE | tr_tonkho_sum → tr_material (mavt) | |
| TR_BAOCAO_ROTCHUYEN_GETBYIDBAOCAO | tr_baocao_rotchuyen → tr_sanpham | ⚠ tr_baocao_rotchuyen CHƯA migrate — cần đưa vào scope trước |

## 2. `datasource-aggregate` — 7 proc đọc nhưng VƯỢT khả năng DataSource

GROUP BY toàn bảng / UNION / pivot / temp table. Hai lựa chọn: port Tier D
đọc (procTable + aggregate SQL thô, như tr_dinhmuc_govan_m3total đã làm)
hoặc đợi mở rộng DataSource groupBy server-side:

- PS_KEHOACH_DONHANG_TOTAL_CONT2 (⚠ ps_kehoach_donhang + tr_gridview_column chưa migrate)
- TR_BAOCAO_CHUYENSON_GETDATA
- TR_DONDATHANG_SUMBYYEAR
- TR_DINHMUC_NGUKIM_TOTALMAVT
- TR_TIENDO_CHUYENSON_GETBYKHUVUC / GETBYKHUVUC2 (⚠ tr_tiendo_chuyenson + tr_release_govan chưa migrate)
- TR_TINHGIA_BY_DDH

→ Khuyến nghị: port Tier D đọc (nhanh, pattern sẵn) — 7 proc.

## 3. `tierD-read-scalar` — 5 proc đọc trả SCALAR (SELECT @out = SUM…)

Không phải dataset nên DataSource không thay được, nhưng Tier D rất mỏng
(5-10 dòng procTable):

- TINHGIA_NGUYENLIEU_DGO / NKI / SON — SUM đơn giá theo masp
- TINHGIA_NGUYENLIEU_GVA2 (⚠ dùng fn_dongia_nguyenlieu_gva4 + cursor — cần port function đó vào JS)
- TINHGIA_DONGGOI_BY_MAVT (⚠ tr_congthuc_donggoi + trmaterialclassstd/dtail chưa migrate; có cursor + fn_split)

## 4. `tierB-pure-calc` — 1 proc thuần công thức, không đụng bảng

- TINHGIA_HANGMUC_LAIVAY: `sotien = tongtien * 1% * 3 tháng` → làm
  procedure Tier B (JS sandbox, bảng `procedures`) hoặc computed ngay UI.

## 5. `tierD` — 83 proc CÓ GHI, tiếp tục port procTable

Danh sách đầy đủ trong `procs-triage.json` (group=tierD, kèm bảng
writes/reads per proc để chuẩn bị field-map). Port theo thứ tự ưu tiên
`procs-all.txt` (đã sort theo số form dùng).

## 6. `missing-source` — 1 proc KHÔNG tồn tại trong MSSQL

- TR_QUYTRINH_SON_DELETEALL: form tham chiếu nhưng proc đã bị xoá ở DB
  nguồn → đánh dấu obsolete, bỏ khỏi kế hoạch port (cần xác nhận form
  tương ứng còn dùng không).

## Tác động tiến độ

- Khỏi port code: 4 (datasource) + 1 (pure-calc → Tier B 5 phút) + 1 (obsolete) = **6 proc**
- Port Tier D mỏng: 5 (read-scalar) + 7 (aggregate đọc) = **12 proc nhẹ**
- Port Tier D thật: **83 proc** (ghi, độ phức tạp trung bình như 37 đã làm)

## Bảng cần đưa vào scope migrate (chặn các proc trên)

tr_baocao_rotchuyen, tr_tiendo_chuyenson, tr_release_govan,
tr_congthuc_donggoi, trmaterialclassstd, trmaterialclassstddtail
(+ danh sách cũ: ps_kehoach_donhang, tr_gridview_column, tr_dinhmuc_lock,
tr_dongia_nguyenlieu_gva, tr_dinhmuc_son, tr_muctieu_sanxuat,
tr_sanpham_components)

## NGUYÊN TẮC CHỐT (2026-06-12): DataSource-first

Ưu tiên quy proc về DataSource hết mức. Chỉ port Tier D khi proc thật sự
GHI hoặc trả scalar tính toán. Proc đọc phức tạp (group-by/union/pivot/
subquery) → hướng ưu tiên là MỞ RỘNG DataSource (groupBy server-side...)
thay vì port code đọc hàng loạt. Agent port phát hiện proc chỉ-đọc-đơn-giản
→ dừng, báo lại làm ứng viên DataSource.
