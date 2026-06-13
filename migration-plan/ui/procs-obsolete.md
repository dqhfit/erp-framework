# Proc obsolete — KHÔNG port (đã xác minh không tồn tại ở MSSQL nguồn)

Form UI tham chiếu nhưng proc đã bị xoá khỏi DB nguồn DQHF. Xác minh bằng
`SELECT name FROM sys.objects WHERE type='P'` (script
`tooling/migration-cli/src/check-procs-exist.ts`). Bỏ khỏi kế hoạch port;
nếu form tương ứng còn dùng → cần dựng lại logic từ đặc tả nghiệp vụ, không
phải port 1:1.

| Proc | Ngày xác minh | Ghi chú |
|---|---|---|
| TR_QUYTRINH_SON_DELETEALL | 2026-06-13 | Không có trong `sys.objects` MSSQL. Xoá-tất-cả quy trình sơn — nếu form Quy trình sơn còn dùng nút "Xoá tất cả", cài lại bằng records.bulkDelete theo filter thay vì proc. |

## KHÔNG obsolete (còn tồn tại MSSQL — hoãn vì nặng/phụ thuộc, không bỏ)

- **TR_MUCTIEU_SANXUAT2_TINHTOAN** — còn ở MSSQL; cursor nặng tính mục tiêu
  sản xuất theo công đoạn × ngày. Port Tier D khi tới nhóm tính toán nặng.
- **TR_TINHGIA_BY_DDH2** — còn ở MSSQL; cần proc nhân sự (HR) chưa migrate.
