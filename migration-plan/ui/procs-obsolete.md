# Proc obsolete — KHÔNG port (đã xác minh không tồn tại ở MSSQL nguồn)

Form UI tham chiếu nhưng proc đã bị xoá khỏi DB nguồn DQHF. Xác minh bằng
`SELECT name FROM sys.objects WHERE type='P'` (script
`tooling/migration-cli/src/check-procs-exist.ts`). Bỏ khỏi kế hoạch port;
nếu form tương ứng còn dùng → cần dựng lại logic từ đặc tả nghiệp vụ, không
phải port 1:1.

| Proc | Ngày xác minh | Ghi chú |
|---|---|---|
| TR_QUYTRINH_SON_DELETEALL | 2026-06-13 | Không có trong `sys.objects` MSSQL. Xoá-tất-cả quy trình sơn — nếu form Quy trình sơn còn dùng nút "Xoá tất cả", cài lại bằng records.bulkDelete theo filter thay vì proc. |
| TR_DINHMUC_VATTU_TIEUHAO_DELETEBYID | 2026-06-13 | **Proc CÒN ở MSSQL nhưng bảng đích `tr_dinhmuc_vattu_tieuhao` ĐÃ XOÁ** (find-tables không thấy, không có rename). Proc chỉ DELETE từ bảng không tồn tại → chết. Bỏ port. Nếu form định mức vật tư tiêu hao còn dùng → bảng đã bị loại khỏi mô hình dữ liệu, cần xác nhận nghiệp vụ. |
| TR_BAOCAO_ROTCHUYEN_GETBYIDBAOCAO | 2026-06-13 | Proc đọc CÒN ở MSSQL nhưng bảng nguồn `tr_baocao_rotchuyen` ĐÃ XOÁ (không rename). DataSource định làm cho proc này KHÔNG dựng được (mất base table). Bỏ khỏi danh sách DataSource. |
| TR_BAOCAO_HIENDIEN4_UPDATE2 | 2026-06-13 | Proc CÒN ở MSSQL; UPDATE chính `tr_baocao_hiendien4` (ĐÃ XOÁ) + phụ `tr_muctieu_sanxuat2_chitiet` (còn). **So cột (dump-columns) loại trừ rename**: `ns_baocao_hiendien` là XPO/DevExpress (Oid/GCRecord/BoPhan/SiSo, khác module); `tr_baocao_chuyenson_hiendien` dùng `songuoi`/`hiendien` gộp, KHÔNG có `songuoi_hanhchanh`+`songuoi_tangca`/`ngaythang`/`RowVer` mà proc cần. → bảng `tr_baocao_hiendien4` (tách HC/TC + RowVer) xoá hẳn, không có bản thay. Dữ liệu hiện diện giờ chảy thẳng vào `tr_muctieu_sanxuat2_chitiet` (songuoi_hiendien_hc/tc) — nhập trực tiếp ở module mục tiêu sản xuất, không qua proc này. |

## KHÔNG obsolete (còn tồn tại MSSQL — hoãn vì nặng/phụ thuộc, không bỏ)

- **TR_MUCTIEU_SANXUAT2_TINHTOAN** — còn ở MSSQL; cursor nặng tính mục tiêu
  sản xuất theo công đoạn × ngày. Port Tier D khi tới nhóm tính toán nặng.
- **TR_TINHGIA_BY_DDH2** — còn ở MSSQL; cần proc nhân sự (HR) chưa migrate.
