# Style guide cho AI migration

File này được nạp vào MỌI LLM call của migration-cli (enrich/codegen/samples/audit) — là nguồn chuẩn duy nhất cho convention naming Vietnamese. Sửa file → mọi tier AI tự động adapt ở lần gọi tiếp theo.

## 1. Naming convention

| Phần tử | Quy tắc | Ví dụ |
|---|---|---|
| `entity.name`, `field.name`, `procedure.name`, `module` | `snake_case` tiếng Việt **không dấu** (vì là code identifier) | `don_hang`, `khach_hang`, `thoi_gian_tao`, `cap_nhat_trang_thai` |
| `entity.label`, `field.label`, `procedure.label` | tiếng Việt **có dấu**, viết hoa chữ cái đầu của câu | `Đơn hàng`, `Khách hàng`, `Thời gian tạo` |
| `description` | 1-2 câu tiếng Việt có dấu, kết thúc bằng dấu chấm | `Đơn đặt hàng của khách. Mỗi đơn thuộc 1 khách hàng.` |
| File plugin TS | snake_case, ngoài 1 phần extension | `place_order.ts`, `report_doanh_thu.ts` |
| Module name | snake_case 1 từ hoặc 2 từ | `sales`, `inventory`, `nhan_su`, `ke_toan` |

**Tách bạch quan trọng**:
- `name` / `field` / `procedure name` là **code identifier** → bắt buộc ASCII không dấu, an toàn ở URL, JSON key, SQL column.
- `label` / `description` là **văn bản hiển thị** → tiếng Việt đầy đủ dấu, render trong UI cho user xem.

**Tránh**:
- Không dùng tiếng Anh hỗn hợp (vd `orderTotal`, `customerInfo`) trừ khi từ đã phổ thông tiếng Việt (`id`, `email`, `password`, `url`, `qr_code`).
- Không dùng CamelCase / PascalCase cho identifier.
- Không viết tắt trừ abbrev phổ biến (xem bảng dưới).

## 2. Abbreviation table (MSSQL → tiếng Việt full)

Cột bảng MSSQL legacy thường viết tắt. Khi suy tên field/entity, **bỏ abbrev** trừ khi abbrev là từ nghiệp vụ được team dùng phổ biến.

| Viết tắt | Full (snake_case không dấu) | Nghĩa (có dấu) |
|---|---|---|
| `ID` | `id` | id — giữ nguyên, phổ biến |
| `KH` | `khach_hang` | Khách hàng |
| `NV` | `nhan_vien` | Nhân viên |
| `NCC` | `nha_cung_cap` | Nhà cung cấp |
| `SP` | `san_pham` | Sản phẩm |
| `DH` | `don_hang` | Đơn hàng |
| `HD` | `hoa_don` | Hóa đơn |
| `VT` | `vat_tu` | Vật tư |
| `TGTAO` | `thoi_gian_tao` | Thời gian tạo — created_at |
| `TGSUA` | `thoi_gian_sua` | Thời gian sửa — updated_at |
| `NGAY_TAO` | `ngay_tao` | Ngày tạo — bản date-only |
| `MA_*` | `ma_*` | Mã \* — giữ prefix |
| `TEN_*` | `ten_*` | Tên \* |
| `TRANG_THAI` | `trang_thai` | Trạng thái — status |
| `SL` | `so_luong` | Số lượng |
| `DGIA`, `DON_GIA` | `don_gia` | Đơn giá — unit price |
| `TTIEN`, `TONG_TIEN` | `tong_tien` | Tổng tiền |
| `GHI_CHU` | `ghi_chu` | Ghi chú — giữ nguyên |
| `CT_*` (`CT_DH`) | `chi_tiet_*` (`chi_tiet_don_hang`) | Chi tiết \* — item / line |

Khi gặp viết tắt ngoài bảng này, đoán theo ngữ cảnh; nếu không chắc, giữ nguyên lowercase và đánh dấu trong description: `(unknown abbrev: <X>)`.

## 3. Verb prefix cho procedure tier B

Procedure phải bắt đầu bằng verb tiếng Việt snake_case:

| Verb | Ý nghĩa | Tương ứng tiếng Anh |
|---|---|---|
| `lay_*` | Đọc 1 hoặc nhiều record | get / fetch |
| `dem_*` | Đếm số lượng | count |
| `tinh_*` | Tính toán kết quả | calculate |
| `tao_*` | Tạo record mới | create |
| `cap_nhat_*` | Sửa record | update |
| `xoa_*` | Xóa record | delete |
| `kiem_tra_*` | Validate + return bool / detail | check / validate |
| `gui_*` | Tác vụ side-effect (email, SMS…) | send / notify |
| `dong_*` | Đóng sổ / kết sổ | close / finalize |
| `mo_*` | Mở sổ / khởi tạo | open / init |
| `nhap_*` / `xuat_*` | Nhập kho / xuất kho | inbound / outbound |
| `duyet_*` | Approve workflow | approve |

Ví dụ: `tinh_tong_don_hang`, `lay_khach_hang_theo_ma`, `cap_nhat_trang_thai_don`.

## 4. Field type guideline (cho enrich Tier 1)

- Cột MSSQL `BIT NOT NULL DEFAULT 0` → entity `boolean`, KHÔNG required (default false).
- Cột `STATUS` / `TRANGTHAI` / `LOAI` / có tập giá trị có hạn < 20 → entity `select` với `options[]` tiếng Việt có dấu cho user.
- Cột `MA_*` (vd `MA_DH = "DH-2026-0001"`) có prefix + số → entity `sequence` với `sequencePrefix` + `sequencePadding`.
- Cột ngày tạo / updated → entity `datetime` (KHÔNG cho user nhập, AI mark `editable: false` nếu detect được).
- Cột `EMAIL`, `URL`, `PHONE` → entity `text` với `format` hint (nhưng framework chưa có — chỉ thêm description).
- Cột FK detect qua proc JOIN → entity `relation` với `relationEntity` là entity đích.

## 5. Tier classification guideline (override cho enrich Tier 1)

Parser heuristic đôi khi sai. AI quyết định tier theo nguyên tắc:

- **Tier B** (procedure JS sandbox): proc < 100 dòng T-SQL, single-table write hoặc multi-table write trong tx ngắn. KHÔNG raw SQL aggregate.
- **Tier C** (workflow scheduled): proc được SQL Agent gọi định kỳ, hoặc trigger time-based. Body có thể gọi tier B/D bên trong.
- **Tier D** (plugin TS): proc có CTE/WINDOW/GROUP BY phức tạp, hoặc > 200 dòng, hoặc dùng dynamic SQL.

**Override khi**:
- Parser báo D vì có CTE nhưng CTE chỉ để readability (logic đơn giản) → B.
- Parser báo B nhưng proc có business rule phức tạp (vd nhiều IF/CASE nested) → D.
- Proc tính khá khá (vd tính tồn kho daily) → C nếu có lịch, nếu không C ngầm B/D.

## 6. Description style

Description là 1-2 câu tiếng Việt:
- Câu 1: nói nghiệp vụ (cái gì).
- Câu 2 (optional): nói ràng buộc hoặc edge case.

Ví dụ:
- "Đơn đặt hàng. Mỗi đơn thuộc 1 khách hàng và có thể có nhiều chi tiết."
- "Tính tổng tiền của 1 đơn hàng theo công thức đơn giá * số lượng * (1 - chiết khấu)."

**KHÔNG** viết "This entity stores ..." (tiếng Anh).
**KHÔNG** viết "Đây là bảng chứa ..." (quá dài).
