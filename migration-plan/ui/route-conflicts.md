# Route Conflicts Report
> Sinh tự động bởi `tooling/page-routes/audit-pages.mjs`
> Ngày: 2026-06-26T05:02:29.168Z

## Tóm tắt

| Mục | Số lượng | Ghi chú |
|-----|---------|---------|
| Route code (`src/routes`) | 69 | App routes cứng |
| Page config ERP (`pages/`) | 297 | Trang ERP theo domain module |
| Page config Portal (`pages-menu/`) | 145 | Trang portal theo nhóm menu (P01-P14, G1020) |
| Trùng slug (cross-source: ERP + Portal) | 60 | **Ưu tiên giải quyết P1** |
| Trùng slug (same-source) | 21 | Trang ver/add variant cùng bộ |
| Planned-delete (old-pages-to-delete.json) | 276 | Trang cũ cần xoá trên prod |
| Trang phiên bản (ver2/add2/test/copy) | 79 | Candidate hợp nhất |
| Slug đụng route code | 0 | Kiểm tra trước P2 |

## 1. Trùng slug — Cross-source (ERP ↔ Portal)

> Slug từ `pages/` và `pages-menu/` trùng nhau → nếu thêm route `/p/$slug` sẽ cần phân biệt.

### `danh-sach-ban-ve`
- `dq_bang_mau_banve_banve2` — "Danh sách bản vẽ" — source: **pages** / module: `bang_mau_banve`
- `dq_bang_mau_banve_danh_sach_ban_ve` — "Danh sách bản vẽ" — source: **pages** / module: `bang_mau_banve`
- `dq_p02_danh_sach_ban_ve` — "Danh sách bản vẽ" — source: **pages-menu** / module: `P02`

### `danh-sach-ban-ve-da-phat-hanh`
- `dq_bang_mau_banve_danh_sach_ban_ve2` — "Danh sách bản vẽ đã phát hành" — source: **pages** / module: `bang_mau_banve`
- `dq_p02_danh_sach_ban_ve2` — "Danh sách bản vẽ (đã phát hành)" — source: **pages-menu** / module: `P02`

### `bao-cao-final`
- `dq_bao_cao_bao_cao_final_add2` — "Báo cáo final" — source: **pages** / module: `bao_cao`
- `dq_p01_bao_cao_final` — "Báo cáo Final" — source: **pages-menu** / module: `P01`

### `bao-cao-hien-dien`
- `dq_bao_cao_bao_cao_hien_dien` — "Báo cáo hiện diện" — source: **pages** / module: `bao_cao`
- `dq_p10_bao_cao_hien_dien` — "Báo cáo hiện diện" — source: **pages-menu** / module: `P10`

### `bao-cao-kiem-tra-chat-luong`
- `dq_bao_cao_bao_cao_kiem_tra_chat_luong` — "Báo cáo kiểm tra chất lượng" — source: **pages** / module: `bao_cao`
- `dq_p10_bao_cao_kiem_tra_chat_luong` — "Báo cáo kiểm tra chất lượng" — source: **pages-menu** / module: `P10`

### `theo-doi-don-dat-hang`
- `dq_bao_cao_theo_doi_dat_hang` — "Theo dõi đơn đặt hàng" — source: **pages** / module: `bao_cao`
- `dq_don_hang_theodoi_dondathang` — "Theo dõi đơn đặt hàng" — source: **pages** / module: `don_hang`
- `dq_p01_theo_doi_dat_hang` — "Theo dõi đơn đặt hàng" — source: **pages-menu** / module: `P01`

### `thong-ke-san-luong-son-dong-goi`
- `dq_bao_cao_thong_ke_so_luong_add2` — "Thống kê sản lượng (Sơn, Đóng gói)" — source: **pages** / module: `bao_cao`
- `dq_p10_thong_ke_so_luong_add2` — "Thống kê sản lượng (Sơn, Đóng gói)" — source: **pages-menu** / module: `P10`

### `thong-ke-xuat-hang-thanh-pham`
- `dq_bao_cao_thong_ke_xuat_hang_thanh_pham` — "Thống kê xuất hàng thành phẩm" — source: **pages** / module: `bao_cao`
- `dq_p01_thong_ke_xuat_hang_thanh_pham` — "Thống kê xuất hàng thành phẩm" — source: **pages-menu** / module: `P01`

### `bao-gia-chi-tiet-go-van`
- `dq_bao_gia_bao_gia_chi_tiet_go_van` — "Báo giá chi tiết gỗ ván" — source: **pages** / module: `bao_gia`
- `dq_p03_bao_gia_vat_tu_go_van` — "Báo giá chi tiết gỗ ván" — source: **pages-menu** / module: `P03`

### `bao-gia-phoi`
- `dq_bao_gia_bao_gia_phoi` — "Báo giá phôi" — source: **pages** / module: `bao_gia`
- `dq_p03_bao_gia_phoi` — "Báo giá phôi" — source: **pages-menu** / module: `P03`

### `danh-sach-bao-gia`
- `dq_bao_gia_baogia_danhsach` — "Danh sách báo giá" — source: **pages** / module: `bao_gia`
- `dq_p03_baogia_danhsach` — "Danh sách báo giá" — source: **pages-menu** / module: `P03`

### `danh-sach-bao-gia-hang-trang`
- `dq_bao_gia_danh_sach_bao_gia_hang_trang` — "Danh sách báo giá hàng trắng" — source: **pages** / module: `bao_gia`
- `dq_p03_danh_sach_bao_gia_hang_trang` — "Danh sách báo giá hàng trắng" — source: **pages-menu** / module: `P03`

### `danh-sach-bao-gia-phoi`
- `dq_bao_gia_danh_sach_bao_gia_phoi` — "Danh sách báo giá phôi" — source: **pages** / module: `bao_gia`
- `dq_p03_danh_sach_bao_gia_phoi` — "Danh sách báo giá phôi" — source: **pages-menu** / module: `P03`

### `lenh-cap-phat-go-van`
- `dq_danh_muc_create_material_request_gva_ver2` — "Lệnh cấp phát gỗ ván" — source: **pages** / module: `danh_muc`
- `dq_p08_create_material_request_gva` — "Lệnh cấp phát gỗ ván" — source: **pages-menu** / module: `P08`

### `hoa-don-ban-hang`
- `dq_danh_muc_danh_sach_hoa_don2` — "Hóa đơn bán hàng" — source: **pages** / module: `danh_muc`
- `dq_don_hang_hoa_don_ban_hang_add` — "Hóa đơn bán hàng" — source: **pages** / module: `don_hang`
- `dq_g1020_hoa_don_ban_hang_add` — "Hoá đơn bán hàng" — source: **pages-menu** / module: `G1020`

### `danh-sach-san-pham`
- `dq_danh_muc_list_bom_editor` — "Danh sách sản phẩm" — source: **pages** / module: `danh_muc`
- `dq_san_pham_sanpham` — "Danh sách sản phẩm" — source: **pages** / module: `san_pham`
- `dq_p01_sanpham` — "Danh sách sản phẩm" — source: **pages-menu** / module: `P01`

### `dinh-muc-chi-phi-san-pham`
- `dq_dinh_muc_dinh_muc_chi_phi_san_pham` — "Định mức chi phí sản phẩm" — source: **pages** / module: `dinh_muc`
- `dq_p14_dinh_muc_chi_phi_san_pham` — "Định mức chi phí sản phẩm" — source: **pages-menu** / module: `P14`

### `kiem-tra-dinh-muc-ban-ve-ai`
- `dq_dinh_muc_dinh_muc_he_hang` — "Kiểm tra định mức - bản vẽ - AI" — source: **pages** / module: `dinh_muc`
- `dq_p01_dinh_muc_he_hang` — "Kiểm tra định mức - bản vẽ - AI" — source: **pages-menu** / module: `P01`

### `dinh-muc-so-che`
- `dq_dinh_muc_dinh_muc_so_che` — "Định mức sơ chế" — source: **pages** / module: `dinh_muc`
- `dq_p02_dinh_muc_go_van_so_che` — "Định mức sơ chế" — source: **pages-menu** / module: `P02`

### `quy-trinh-son`
- `dq_dinh_muc_dinh_muc_son3` — "Quy trình sơn" — source: **pages** / module: `dinh_muc`
- `dq_ke_toan_quy_trinh_son` — "Quy trình sơn" — source: **pages** / module: `ke_toan`
- `dq_p02_quy_trinh_son` — "Quy trình sơn" — source: **pages-menu** / module: `P02`

### `dinh-muc-mau-son`
- `dq_dinh_muc_dinh_muc_son4` — "Định mức màu sơn" — source: **pages** / module: `dinh_muc`
- `dq_p02_dinh_muc_son4` — "Định mức màu sơn" — source: **pages-menu** / module: `P02`

### `dinh-muc-son`
- `dq_dinh_muc_dinh_muc_son_editor` — "Định mức sơn" — source: **pages** / module: `dinh_muc`
- `dq_p02_dinh_muc_son3` — "Định mức sơn" — source: **pages-menu** / module: `P02`

### `dinh-muc-vat-tu-tieu-hao`
- `dq_dinh_muc_dinh_muc_vat_tu_tieu_hao` — "Định mức vật tư tiêu hao" — source: **pages** / module: `dinh_muc`
- `dq_p08_dinh_muc_vat_tu_tieu_hao` — "Định mức vật tư tiêu hao" — source: **pages-menu** / module: `P08`

### `kiem-tra-dinh-muc-theo-don-hang`
- `dq_dinh_muc_kiemtra_dinhmuc_ver2` — "Kiểm tra định mức theo đơn hàng" — source: **pages** / module: `dinh_muc`
- `dq_dinh_muc_kiemtra_dinhmuc_ver3` — "Kiểm tra định mức theo đơn hàng" — source: **pages** / module: `dinh_muc`
- `dq_p10_kiemtra_dinhmuc_ver3` — "Kiểm tra định mức (theo đơn hàng)" — source: **pages-menu** / module: `P10`

### `phat-hanh-dinh-muc`
- `dq_dinh_muc_phat_hanh_dinh_muc2` — "Phát hành định mức" — source: **pages** / module: `dinh_muc`
- `dq_p02_phat_hanh_dinh_muc2` — "Phát hành định mức" — source: **pages-menu** / module: `P02`

### `danh-sach-de-xuat-phoi`
- `dq_don_hang_banhanggo_danh_sach_de_xuat_phoi` — "Danh sách đề xuất phôi" — source: **pages** / module: `don_hang`
- `dq_don_hang_banhanggo_danh_sach_de_xuat_phoi2` — "Danh sách đề xuất phôi" — source: **pages** / module: `don_hang`
- `dq_don_hang_banhanggo_danh_sach_de_xuat_phoi3` — "Danh sách đề xuất phôi" — source: **pages** / module: `don_hang`
- `dq_p13_banhanggo_danh_sach_de_xuat_phoi` — "Danh sách đề xuất phôi" — source: **pages-menu** / module: `P13`

### `nhap-kho`
- `dq_don_hang_banhanggo_phieunhapkho` — "Nhập kho" — source: **pages** / module: `don_hang`
- `dq_kho_vat_tu_nhap_kho2` — "Nhập kho" — source: **pages** / module: `kho_vat_tu`
- `dq_kho_vat_tu_nhap_kho_go_van` — "Nhập kho" — source: **pages** / module: `kho_vat_tu`
- `dq_p07_nhap_kho2` — "Nhập kho" — source: **pages-menu** / module: `P07`

### `commercial-invoice`
- `dq_don_hang_commercial_invoice_add` — "Commercial Invoice" — source: **pages** / module: `don_hang`
- `dq_p03_commercial_invoice` — "Commercial Invoice" — source: **pages-menu** / module: `P03`

### `thong-ke-don-hang`
- `dq_don_hang_danh_sach_don_hang_theo_ngay` — "Thống kê đơn hàng" — source: **pages** / module: `don_hang`
- `dq_p09_dashboard_order` — "Thống kê đơn hàng" — source: **pages-menu** / module: `P09`

### `don-hang-bu`
- `dq_don_hang_don_hang_bu` — "Đơn hàng bù" — source: **pages** / module: `don_hang`
- `dq_p01_don_hang_bu` — "Đơn hàng bù" — source: **pages-menu** / module: `P01`
- `dq_p03_don_hang_bu` — "Đơn hàng bù" — source: **pages-menu** / module: `P03`

### `ke-hoach-don-hang-trang`
- `dq_don_hang_ke_hoach_hang_trang_don_hang` — "Kế hoạch đơn hàng trắng" — source: **pages** / module: `don_hang`
- `dq_p05_ke_hoach_hang_trang3` — "Kế hoạch đơn hàng trắng" — source: **pages-menu** / module: `P05`

### `tao-don-hang`
- `dq_don_hang_order_number_add` — "Tạo đơn hàng" — source: **pages** / module: `don_hang`
- `dq_don_hang_order_number_add2` — "Tạo đơn hàng" — source: **pages** / module: `don_hang`
- `dq_don_hang_order_number_add3` — "Tạo đơn hàng" — source: **pages** / module: `don_hang`
- `dq_p03_order_number_add` — "Tạo đơn hàng" — source: **pages-menu** / module: `P03`

### `proforma-invoice`
- `dq_don_hang_proforma_invoice` — "Proforma Invoice" — source: **pages** / module: `don_hang`
- `dq_p03_proforma_invoice` — "Proforma Invoice" — source: **pages-menu** / module: `P03`

### `theo-doi-don-hang-phoi`
- `dq_don_hang_theo_doi_don_hang_phoi` — "Theo dõi đơn hàng phôi" — source: **pages** / module: `don_hang`
- `dq_p08_chi_phi_don_hang` — "Theo dõi đơn hàng phôi" — source: **pages-menu** / module: `P08`

### `tong-hop-chi-tiet-theo-don-hang`
- `dq_don_hang_tong_hop_chi_tiet_don_hang` — "Tổng hợp chi tiết theo đơn hàng" — source: **pages** / module: `don_hang`
- `dq_don_hang_tong_hop_chi_tiet_don_hang2` — "Tổng hợp chi tiết theo đơn hàng" — source: **pages** / module: `don_hang`
- `dq_p02_tong_hop_chi_tiet_don_hang2` — "Tổng hợp chi tiết theo đơn hàng" — source: **pages-menu** / module: `P02`
- `dq_p07_danh_sach_vat_tu_don_hang` — "Tổng hợp chi tiết theo đơn hàng" — source: **pages-menu** / module: `P07`

### `danh-sach-khach-hang`
- `dq_khach_hang_ncc_danhsachkhachhang` — "Danh sách khách hàng" — source: **pages** / module: `khach_hang_ncc`
- `dq_g1020_danh_sach_cong_no` — "Danh sách khách hàng" — source: **pages-menu** / module: `G1020`
- `dq_p13_banhanggo_danhsachdonhang` — "Danh sách khách hàng" — source: **pages-menu** / module: `P13`

### `thong-tin-khach-hang`
- `dq_khach_hang_ncc_khach_hang_info` — "Thông tin khách hàng" — source: **pages** / module: `khach_hang_ncc`
- `dq_p03_khach_hang` — "Thông tin khách hàng" — source: **pages-menu** / module: `P03`

### `danh-sach-kho`
- `dq_kho_vat_tu_kho` — "Danh sách kho" — source: **pages** / module: `kho_vat_tu`
- `dq_g1020_kho` — "Danh sách kho" — source: **pages-menu** / module: `G1020`

### `lenh-cap-phat-ai`
- `dq_kho_vat_tu_lenh_cap_phat_ai` — "Lệnh cấp phát AI" — source: **pages** / module: `kho_vat_tu`
- `dq_p08_lenh_cap_phat_ai` — "Lệnh cấp phát AI" — source: **pages-menu** / module: `P08`

### `lenh-cap-phat-hang-trang`
- `dq_kho_vat_tu_lenh_cap_phat_hang_trang` — "Lệnh cấp phát hàng trắng" — source: **pages** / module: `kho_vat_tu`
- `dq_p05_lenh_cap_phat_hang_trang` — "Lệnh cấp phát hàng trắng" — source: **pages-menu** / module: `P05`

### `bao-cao-hang-loi`
- `dq_kho_vat_tu_nhap_hang_loi3` — "Báo cáo hàng lỗi" — source: **pages** / module: `kho_vat_tu`
- `dq_p10_nhap_hang_loi3` — "Báo cáo hàng lỗi" — source: **pages-menu** / module: `P10`

### `nhap-kho-thanh-pham`
- `dq_kho_vat_tu_nhap_kho_thanh_pham` — "Nhập kho thành phẩm" — source: **pages** / module: `kho_vat_tu`
- `dq_p07_warehouse_finish_good_input` — "Nhập kho thành phẩm" — source: **pages-menu** / module: `P07`

### `nhap-tien-do-hang-trang`
- `dq_kho_vat_tu_nhap_tien_do_hang_trang` — "Nhập tiến độ hàng trắng" — source: **pages** / module: `kho_vat_tu`
- `dq_san_xuat_tien_do_hang_trang4` — "Nhập tiến độ hàng trắng" — source: **pages** / module: `san_xuat`
- `dq_p10_tien_do_hang_trang3` — "Nhập tiến độ hàng trắng" — source: **pages-menu** / module: `P10`

### `phieu-de-nghi-thanh-toan`
- `dq_kho_vat_tu_phieu_de_nghi_thanh_toan_add` — "Phiếu đề nghị thanh toán" — source: **pages** / module: `kho_vat_tu`
- `dq_p01_phieu_de_nghi_thanh_toan` — "Phiếu đề nghị thanh toán" — source: **pages-menu** / module: `P01`
- `dq_p09_phieu_de_nghi_thanh_toan` — "Phiếu đề nghị thanh toán" — source: **pages-menu** / module: `P09`

### `phieu-giao-nhan-hang`
- `dq_kho_vat_tu_phieu_giao_nhan_hang` — "Phiếu giao nhận hàng" — source: **pages** / module: `kho_vat_tu`
- `dq_p01_phieu_giao_nhan_hang` — "Phiếu giao nhận hàng" — source: **pages-menu** / module: `P01`

### `phieu-giao-thanh-pham`
- `dq_kho_vat_tu_phieu_giao_thanh_pham` — "Phiếu giao thành phẩm" — source: **pages** / module: `kho_vat_tu`
- `dq_kho_vat_tu_phieu_giao_thanh_pham_add` — "Phiếu giao thành phẩm" — source: **pages** / module: `kho_vat_tu`
- `dq_p10_phieu_giao_thanh_pham` — "Phiếu giao thành phẩm" — source: **pages-menu** / module: `P10`

### `tao-yeu-cau-mua-hang`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang` — "Tạo yêu cầu mua hàng" — source: **pages** / module: `kho_vat_tu`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang2` — "Tạo yêu cầu mua hàng" — source: **pages** / module: `kho_vat_tu`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang_theo_ho_so` — "Tạo yêu cầu mua hàng" — source: **pages** / module: `kho_vat_tu`
- `dq_p05_tao_yeu_cau_mua_hang_theo_ho_so` — "Tạo yêu cầu mua hàng" — source: **pages-menu** / module: `P05`

### `ton-kho-bao-tri`
- `dq_kho_vat_tu_ton_kho_bao_tri` — "Tồn kho bảo trì" — source: **pages** / module: `kho_vat_tu`
- `dq_p07_ton_kho_bao_tri` — "Tồn kho bảo trì" — source: **pages-menu** / module: `P07`

### `xuat-kho-thanh-pham`
- `dq_kho_vat_tu_warehouse_finish_good_output` — "Xuất kho thành phẩm" — source: **pages** / module: `kho_vat_tu`
- `dq_p07_warehouse_finish_good_output` — "Xuất kho thành phẩm" — source: **pages-menu** / module: `P07`

### `xuat-kho-theo-lenh-cap-phat`
- `dq_kho_vat_tu_warehouse_output` — "Xuất kho theo lệnh cấp phát" — source: **pages** / module: `kho_vat_tu`
- `dq_kho_vat_tu_xuat_kho_lenh_cap_phat` — "Xuất kho theo lệnh cấp phát" — source: **pages** / module: `kho_vat_tu`
- `dq_p07_xuat_kho_lenh_cap_phat` — "Xuất kho theo lệnh cấp phát" — source: **pages-menu** / module: `P07`

### `lich-su-nhap-xuat`
- `dq_kho_vat_tu_xuatnhapgo_lichsu` — "Lịch sử nhập xuất" — source: **pages** / module: `kho_vat_tu`
- `dq_p13_xuatnhapgo_lichsu` — "Lịch sử nhập -  xuất" — source: **pages-menu** / module: `P13`

### `in-phieu-pallet`
- `dq_pallet_in_pallet` — "In Phiếu Pallet" — source: **pages** / module: `pallet`
- `dq_pallet_in_pallet_2` — "In Phiếu Pallet" — source: **pages** / module: `pallet`
- `dq_san_xuat_quytrinh_sanxuat_danhsach2` — "In phiếu pallet " — source: **pages** / module: `san_xuat`
- `dq_p10_in_pallet` — "In phiếu Pallet" — source: **pages-menu** / module: `P10`

### `tao-ma-chi-tiet`
- `dq_san_pham_create_material_code_ver3` — "Tạo mã chi tiết" — source: **pages** / module: `san_pham`
- `dq_san_pham_create_material_code_ver4` — "Tạo mã chi tiết" — source: **pages** / module: `san_pham`
- `dq_p02_create_material_code` — "Tạo mã chi tiết" — source: **pages-menu** / module: `P02`
- `dq_p02_create_material_code_ver3` — "Tạo mã chi tiết" — source: **pages-menu** / module: `P02`

### `quy-trinh-san-pham`
- `dq_san_pham_quy_trinh_san_pham` — "Quy trình sản phẩm" — source: **pages** / module: `san_pham`
- `dq_san_pham_quy_trinh_san_pham2` — "Quy trình sản phẩm" — source: **pages** / module: `san_pham`
- `dq_p12_quy_trinh_san_pham` — "Quy trình sản phẩm" — source: **pages-menu** / module: `P12`

### `nhap-xuat-hang-mau`
- `dq_san_pham_san_pham_mau_nhap_xuat` — "Nhập - Xuất hàng mẫu" — source: **pages** / module: `san_pham`
- `dq_p01_san_pham_mau_nhap_xuat` — "Nhập - Xuất hàng mẫu" — source: **pages-menu** / module: `P01`

### `trang-thai-san-xuat-hang-trang`
- `dq_san_xuat_giao_nhan_hang_trang` — "Trạng thái sản xuất hàng trắng" — source: **pages** / module: `san_xuat`
- `dq_san_xuat_trang_thai_san_xuat_htr` — "Trạng thái sản xuất hàng trắng" — source: **pages** / module: `san_xuat`
- `dq_p10_trang_thai_san_xuat_htr` — "Trạng thái sản xuất hàng trắng" — source: **pages-menu** / module: `P10`

### `ke-hoach-san-xuat-hang-trang`
- `dq_san_xuat_ke_hoach_hang_trang3` — "Kế hoạch sản xuất hàng trắng" — source: **pages** / module: `san_xuat`
- `dq_san_xuat_ke_hoach_san_xuat_po2_htr` — "Kế hoạch sản xuất hàng trắng" — source: **pages** / module: `san_xuat`
- `dq_p05_ke_hoach_san_xuat_po2_htr` — "Kế hoạch sản xuất hàng trắng" — source: **pages-menu** / module: `P05`

### `ke-hoach-giao-hang-trang`
- `dq_san_xuat_lich_giao_hang_trang` — "Kế hoạch giao hàng trắng" — source: **pages** / module: `san_xuat`
- `dq_p05_lich_giao_hang_trang` — "Kế hoạch giao hàng trắng" — source: **pages-menu** / module: `P05`

### `muc-tieu-san-xuat`
- `dq_san_xuat_muc_tieu_san_xuat` — "Mục tiêu sản xuất" — source: **pages** / module: `san_xuat`
- `dq_san_xuat_muc_tieu_san_xuat2` — "Mục tiêu sản xuất" — source: **pages** / module: `san_xuat`
- `dq_p05_muc_tieu_san_xuat2` — "Mục tiêu sản xuất" — source: **pages-menu** / module: `P05`

### `theo-doi-tien-do-hang-trang`
- `dq_san_xuat_tien_do_hang_trang2` — "Theo dõi tiến độ hàng trắng" — source: **pages** / module: `san_xuat`
- `dq_p10_thong_ke_cong_doan` — "Theo dõi tiến độ hàng trắng" — source: **pages-menu** / module: `P10`

## 2. Trùng slug — Same-source (phiên bản / variant)

> Nhiều trang trong cùng bộ (pages/ hoặc pages-menu/) có label giống nhau → trùng slug. Xem xét hợp nhất hoặc đặt tên phân biệt.

### `de-xuat-bang-mau`
- `dq_bang_mau_banve_chi_tiet_de_xuat_bang_mau` — "Đề xuất bảng màu" — module: `bang_mau_banve`
- `dq_bang_mau_banve_de_xuat_bang_mau_add` — "Đề xuất bảng màu" — module: `bang_mau_banve`

### `thong-ke-so-luong`
- `dq_bao_cao_thong_ke_so_luong` — "Thống kê số lượng" — module: `bao_cao`
- `dq_bao_cao_thong_ke_so_luong_add` — "Thống kê số lượng" — module: `bao_cao`

### `tong-hop-xuat-hop-chat-son`
- `dq_bao_cao_tong_hop_xuat_hop_chat_son` — "Tổng hợp xuất hợp chất sơn" — module: `bao_cao`
- `dq_danh_muc_danh_sach_tong_hop_xuat_hop_chat_son` — "Tổng hợp xuất hợp chất sơn" — module: `danh_muc`

### `bao-gia-san-pham`
- `dq_bao_gia_bao_gia3` — "Báo giá sản phẩm" — module: `bao_gia`
- `dq_bao_gia_baogia_sanpham_ver2` — "Báo giá sản phẩm" — module: `bao_gia`
- `dq_bao_gia_baogia_sanpham_ver3` — "Báo giá sản phẩm" — module: `bao_gia`
- `dq_bao_gia_baogia_sanpham_ver4` — "Báo giá sản phẩm" — module: `bao_gia`

### `bao-gia-vat-tu`
- `dq_bao_gia_bao_gia_vat_tu` — "Báo giá vật tư" — module: `bao_gia`
- `dq_bao_gia_bao_gia_vat_tu_add` — "Báo giá vật tư" — module: `bao_gia`

### `cai-dat-don-gia`
- `dq_danh_muc_cai_dat_don_gia_nguyen_lieu` — "Cài đặt đơn giá" — module: `danh_muc`
- `dq_danh_muc_cai_dat_don_gia_nguyen_lieu2` — "Cài đặt đơn giá" — module: `danh_muc`

### `de-xuat-mua-hang`
- `dq_de_xuat_chi_tiet_de_xuat_mua_hang` — "Đề xuất mua hàng" — module: `de_xuat`
- `dq_de_xuat_de_xuat_muahang` — "Đề xuất mua hàng" — module: `de_xuat`

### `de-xuat-phoi`
- `dq_de_xuat_chi_tiet_de_xuat_phoi` — "Đề xuất phôi" — module: `de_xuat`
- `dq_de_xuat_de_xuat_phoi_add` — "Đề xuất phôi" — module: `de_xuat`
- `dq_de_xuat_de_xuat_phoi_add4` — "Đề xuất phôi" — module: `de_xuat`
- `dq_de_xuat_de_xuat_phoi_add5` — "Đề xuất phôi" — module: `de_xuat`

### `sua-don-hang`
- `dq_don_hang_purchase_order_edit2` — "Sửa đơn hàng" — module: `don_hang`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang_edit` — "Sửa đơn hàng" — module: `kho_vat_tu`

### `hang-loi-hang-doi-tra`
- `dq_kho_vat_tu_nhap_hang_loi` — "Hàng lỗi - hàng đổi trả" — module: `kho_vat_tu`
- `dq_kho_vat_tu_nhap_hang_loi_add` — "hàng lỗi - hàng đổi trả" — module: `kho_vat_tu`

### `nhap-tra-hang`
- `dq_kho_vat_tu_phieu_tra_hang_nhap_add` — "Nhập trả hàng" — module: `kho_vat_tu`
- `dq_kho_vat_tu_warehouse_return` — "Nhập trả hàng" — module: `kho_vat_tu`

### `tao-yeu-cau-mua-hang-go-van`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang_gva` — "Tạo yêu cầu mua hàng gỗ, ván" — module: `kho_vat_tu`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang_gva2` — "Tạo yêu cầu mua hàng gỗ ván" — module: `kho_vat_tu`

### `danh-sach-vat-tu`
- `dq_kho_vat_tu_vattu` — "Danh sách vật tư" — module: `kho_vat_tu`
- `dq_san_xuat_scan110_1` — "Danh sách vật tư" — module: `san_xuat`

### `xuat-kho-theo-chi-tiet`
- `dq_kho_vat_tu_warehouse_output3` — "Xuất kho theo chi tiết" — module: `kho_vat_tu`
- `dq_kho_vat_tu_warehouse_output_material` — "Xuất kho theo chi tiết" — module: `kho_vat_tu`

### `thong-tin-dong-hang`
- `dq_san_pham_thong_tin_san_pham2` — "Thông tin dòng hàng" — module: `san_pham`
- `dq_san_pham_thong_tin_san_pham_add` — "Thông tin dòng hàng" — module: `san_pham`

### `quy-trinh-san-xuat`
- `dq_san_xuat_quy_trinh_san_xuat` — "Quy trình sản xuất" — module: `san_xuat`
- `dq_san_xuat_quytrinh_sanxuat_ver2` — "Quy trình sản xuất" — module: `san_xuat`

### `tien-do-san-xuat`
- `dq_san_xuat_tiendo_sanxuat` — "Tiến độ sản xuất" — module: `san_xuat`
- `dq_san_xuat_tiendo_sanxuat_hangtrang` — "Tiến độ sản xuất" — module: `san_xuat`

### `danh-sach-nha-cung-cap`
- `dq_g1020_nha_cung_cap` — "Danh sách nhà cung cấp" — module: `G1020`
- `dq_p13_danhsachnhacungcap` — "Danh sách nhà cung cấp" — module: `P13`

### `thong-tin-san-pham`
- `dq_g1020_san_pham` — "Thông tin sản phẩm" — module: `G1020`
- `dq_p01_thong_tin_san_pham2` — "Thông tin sản phẩm" — module: `P01`

### `phieu-de-xuat-mua-vat-tu-nguyen-lieu`
- `dq_p01_de_xuat_muahang` — "Phiếu đề xuất mua vật tư - nguyên liệu" — module: `P01`
- `dq_p09_de_xuat_muahang` — "Phiếu đề xuất mua vật tư - nguyên liệu" — module: `P09`

### `lenh-cap-phat`
- `dq_p05_lenh_cap_phat_theo_ho_so` — "Lệnh cấp phát" — module: `P05`
- `dq_p08_lenh_cap_phat_add` — "Lệnh cấp phát" — module: `P08`

## 3. Trang phiên bản cần hợp nhất (ver2/add2/test/copy)

> Tên page có suffix kỹ thuật gợi ý đây là trang thử nghiệm hoặc phiên bản cũ. Nên hợp nhất vào trang chính hoặc xoá.

### Module `bang_mau_banve` (6)
- `dq_bang_mau_banve_bang_mau_add` — "Thông tin bảng màu"
- `dq_bang_mau_banve_banve_mau` — "frm_banve_mau"
- `dq_bang_mau_banve_banve_test` — "frm_banve_test"
- `dq_bang_mau_banve_banve_view3` — "frm_banve_view3"
- `dq_bang_mau_banve_chi_tiet_de_xuat_bang_mau` — "Đề xuất bảng màu" ← cùng slug với: dq_bang_mau_banve_de_xuat_bang_mau_add
- `dq_bang_mau_banve_de_xuat_bang_mau_add` — "Đề xuất bảng màu" ← cùng slug với: dq_bang_mau_banve_chi_tiet_de_xuat_bang_mau

### Module `bao_cao` (10)
- `dq_bao_cao_bao_cao_final_add` — "Nhập Báo cáo Kiểm tra"
- `dq_bao_cao_bao_cao_final_add2` — "Báo cáo final" ← cùng slug với: dq_p01_bao_cao_final
- `dq_bao_cao_bao_cao_hoan_thien_add` — "Báo cáo hàng ngày"
- `dq_bao_cao_bao_cao_lap_rap1_add` — "Báo cáo lắp ráp 1"
- `dq_bao_cao_bao_cao_nguyen_phu_lieu_add` — "Nguyên phụ liệu"
- `dq_bao_cao_bao_cao_rot_chuyen_add` — "Báo cáo rớt chuyền"
- `dq_bao_cao_thong_ke_so_luong_add` — "Thống kê số lượng" ← cùng slug với: dq_bao_cao_thong_ke_so_luong
- `dq_bao_cao_thong_ke_so_luong_add2` — "Thống kê sản lượng (Sơn, Đóng gói)" ← cùng slug với: dq_p10_thong_ke_so_luong_add2
- `dq_bao_cao_thong_tin_lan_uv_add` — "Thông tịn lăn UV"
- `dq_bao_cao_thong_tin_nguoi_phu_trach_ky_thuat_add2` — "Cập nhật thông tin người phụ trách"

### Module `bao_gia` (7)
- `dq_bao_gia_bao_gia2_chi_phi_khac_add` — "Chi phí báo giá khác"
- `dq_bao_gia_bao_gia_chi_tiet_nha_cung_cap_add` — "Báo giá nhà cung cấp"
- `dq_bao_gia_bao_gia_vat_tu_add` — "Báo giá vật tư" ← cùng slug với: dq_bao_gia_bao_gia_vat_tu
- `dq_bao_gia_bao_gia_vat_tu_add2` — "Cập nhật báo giá"
- `dq_bao_gia_baogia_sanpham_ver2` — "Báo giá sản phẩm" ← cùng slug với: dq_bao_gia_bao_gia3, dq_bao_gia_baogia_sanpham_ver3, dq_bao_gia_baogia_sanpham_ver4
- `dq_bao_gia_baogia_sanpham_ver3` — "Báo giá sản phẩm" ← cùng slug với: dq_bao_gia_bao_gia3, dq_bao_gia_baogia_sanpham_ver2, dq_bao_gia_baogia_sanpham_ver4
- `dq_bao_gia_baogia_sanpham_ver4` — "Báo giá sản phẩm" ← cùng slug với: dq_bao_gia_bao_gia3, dq_bao_gia_baogia_sanpham_ver2, dq_bao_gia_baogia_sanpham_ver3

### Module `danh_muc` (2)
- `dq_danh_muc_create_material_request_gva_ver2` — "Lệnh cấp phát gỗ ván" ← cùng slug với: dq_p08_create_material_request_gva
- `dq_danh_muc_danh_muc_loi_add` — "Cập nhật danh mục lỗi"

### Module `de_xuat` (5)
- `dq_de_xuat_de_xuat_muahang_add` — "Thêm đề xuất mua hàng"
- `dq_de_xuat_de_xuat_phoi_add` — "Đề xuất phôi" ← cùng slug với: dq_de_xuat_chi_tiet_de_xuat_phoi, dq_de_xuat_de_xuat_phoi_add4, dq_de_xuat_de_xuat_phoi_add5
- `dq_de_xuat_de_xuat_phoi_add4` — "Đề xuất phôi" ← cùng slug với: dq_de_xuat_chi_tiet_de_xuat_phoi, dq_de_xuat_de_xuat_phoi_add, dq_de_xuat_de_xuat_phoi_add5
- `dq_de_xuat_de_xuat_phoi_add5` — "Đề xuất phôi" ← cùng slug với: dq_de_xuat_chi_tiet_de_xuat_phoi, dq_de_xuat_de_xuat_phoi_add, dq_de_xuat_de_xuat_phoi_add4
- `dq_de_xuat_destination_add` — "Cảng đến"

### Module `dinh_muc` (4)
- `dq_dinh_muc_add_dinhmuc_vt_ver2` — "Cập nhật định mức gỗ ván"
- `dq_dinh_muc_dinh_muc_son_theo_mau` — "Quy trình sơn theo màu"
- `dq_dinh_muc_kiemtra_dinhmuc_ver2` — "Kiểm tra định mức theo đơn hàng" ← cùng slug với: dq_dinh_muc_kiemtra_dinhmuc_ver3, dq_p10_kiemtra_dinhmuc_ver3
- `dq_dinh_muc_kiemtra_dinhmuc_ver3` — "Kiểm tra định mức theo đơn hàng" ← cùng slug với: dq_dinh_muc_kiemtra_dinhmuc_ver2, dq_p10_kiemtra_dinhmuc_ver3

### Module `don_hang` (12)
- `dq_don_hang_banhang_add` — "Bán hàng"
- `dq_don_hang_banhang_add2` — "Chứng từ bán hàng"
- `dq_don_hang_banhanggo_phieudoihang_add` — "Phiếu đổi hàng"
- `dq_don_hang_commercial_invoice_add` — "Commercial Invoice" ← cùng slug với: dq_p03_commercial_invoice
- `dq_don_hang_don_hang_bu_add` — "Thêm đơn hàng bù"
- `dq_don_hang_hoa_don_ban_hang_add` — "Hóa đơn bán hàng" ← cùng slug với: dq_danh_muc_danh_sach_hoa_don2, dq_g1020_hoa_don_ban_hang_add
- `dq_don_hang_ke_hoach_don_hang_mau` — "Kế hoạch đơn hàng mẫu"
- `dq_don_hang_order_example_add` — "Thông tin đơn hàng mẫu"
- `dq_don_hang_order_number_add` — "Tạo đơn hàng" ← cùng slug với: dq_don_hang_order_number_add2, dq_don_hang_order_number_add3, dq_p03_order_number_add
- `dq_don_hang_order_number_add2` — "Tạo đơn hàng" ← cùng slug với: dq_don_hang_order_number_add, dq_don_hang_order_number_add3, dq_p03_order_number_add
- `dq_don_hang_order_number_add3` — "Tạo đơn hàng" ← cùng slug với: dq_don_hang_order_number_add, dq_don_hang_order_number_add2, dq_p03_order_number_add
- `dq_don_hang_proforma_invoice_add` — "Thêm Proforma Invoice"

### Module `ke_toan` (2)
- `dq_ke_toan_denghi_thanhtoan_ncc_add` — "Thông tin người cần thanh toán"
- `dq_ke_toan_ngan_hang_add` — "Cập nhật ngân hàng"

### Module `khach_hang_ncc` (1)
- `dq_khach_hang_ncc_nha_cung_cap_add2` — "Nhà cung cấp"

### Module `kho_vat_tu` (14)
- `dq_kho_vat_tu_add_vattu_ver2` — "frm_add_vattu_ver2"
- `dq_kho_vat_tu_lenh_cap_phat_add` — "Tạo lệnh cấp phát"
- `dq_kho_vat_tu_nhap_chitiet_ver2` — "Nhập số lượng thống kê"
- `dq_kho_vat_tu_nhap_hang_loi_add` — "hàng lỗi - hàng đổi trả" ← cùng slug với: dq_kho_vat_tu_nhap_hang_loi
- `dq_kho_vat_tu_phieu_bu_hang_add` — "Phiếu bù hàng"
- `dq_kho_vat_tu_phieu_de_nghi_thanh_toan_add` — "Phiếu đề nghị thanh toán" ← cùng slug với: dq_p01_phieu_de_nghi_thanh_toan, dq_p09_phieu_de_nghi_thanh_toan
- `dq_kho_vat_tu_phieu_giao_thanh_pham_add` — "Phiếu giao thành phẩm" ← cùng slug với: dq_kho_vat_tu_phieu_giao_thanh_pham, dq_p10_phieu_giao_thanh_pham
- `dq_kho_vat_tu_phieu_tra_hang_nhap_add` — "Nhập trả hàng" ← cùng slug với: dq_kho_vat_tu_warehouse_return
- `dq_kho_vat_tu_phieu_xuat_kho_add` — " Phiếu xuất kho"
- `dq_kho_vat_tu_phieunhapkho_add` — "Phiếu nhập kho"
- `dq_kho_vat_tu_warehouse_input_htr` — "Nhập kho hàng trắng"
- `dq_kho_vat_tu_yeu_cau_chat_luong_add` — "Cập nhật yêu cầu chất lượng"
- `dq_kho_vat_tu_yeu_cau_xuat_vat_tu_add` — "frmYeuCauXuat_VatTuAdd"
- `dq_kho_vat_tu_yeu_cau_xuat_vat_tu_add2` — "Tạo đề xuất kho"

### Module `san_pham` (7)
- `dq_san_pham_create_material_code_ver3` — "Tạo mã chi tiết" ← cùng slug với: dq_san_pham_create_material_code_ver4, dq_p02_create_material_code, dq_p02_create_material_code_ver3
- `dq_san_pham_create_material_code_ver4` — "Tạo mã chi tiết" ← cùng slug với: dq_san_pham_create_material_code_ver3, dq_p02_create_material_code, dq_p02_create_material_code_ver3
- `dq_san_pham_nhap_san_pham_mau` — "Nhập hàng mẫu"
- `dq_san_pham_quy_trinh_san_pham_copy` — "Copy quy trình sản phẩm"
- `dq_san_pham_san_pham_add3` — "Cập nhật thông tin sản phẩm"
- `dq_san_pham_thong_tin_san_pham2_add` — "Thêm thông tin sản phẩm"
- `dq_san_pham_thong_tin_san_pham_add` — "Thông tin dòng hàng" ← cùng slug với: dq_san_pham_thong_tin_san_pham2

### Module `san_xuat` (9)
- `dq_san_xuat_bao_cao_tien_do_chuyen_son_add` — "Tiến độ lên chuyền sơn"
- `dq_san_xuat_ke_hoach_hang_trang_ver3` — "Kế hoạch hàng trắng"
- `dq_san_xuat_ke_hoach_san_xuat_po2_htr` — "Kế hoạch sản xuất hàng trắng" ← cùng slug với: dq_san_xuat_ke_hoach_hang_trang3, dq_p05_ke_hoach_san_xuat_po2_htr
- `dq_san_xuat_ke_hoach_san_xuat_po2_htr_add` — "Thêm đơn hàng"
- `dq_san_xuat_muc_tieu_san_xuat_add` — "Nhập mục tiêu sản xuất"
- `dq_san_xuat_quytrinh_sanxuat_copy` — "Sao chép quy trình sản xuất"
- `dq_san_xuat_quytrinh_sanxuat_ver2` — "Quy trình sản xuất" ← cùng slug với: dq_san_xuat_quy_trinh_san_xuat
- `dq_san_xuat_tien_do_chuyen_son_add` — "Nhập tiến độ chuyền sơn"
- `dq_san_xuat_trang_thai_san_xuat_htr` — "Trạng thái sản xuất hàng trắng" ← cùng slug với: dq_san_xuat_giao_nhan_hang_trang, dq_p10_trang_thai_san_xuat_htr

## 4. Trang planned-delete (old-pages-to-delete.json)

> Các trang này được đánh dấu xoá trong kế hoạch migration. Kiểm tra `deleted_at IS NULL` trên prod DB trước khi xoá thật.
> **Lưu ý**: Trang có JSON trong `pages/` có thể đã được thay bằng phiên bản mới — planned-delete chỉ là marker kế hoạch, không phải `deleted_at` DB.

### Module `bang_mau_banve` (10)
- `dq_bang_mau_banve_bang_mau_add`
- `dq_bang_mau_banve_banve`
- `dq_bang_mau_banve_banve2`
- `dq_bang_mau_banve_banve_mau`
- `dq_bang_mau_banve_banve_view3`
- `dq_bang_mau_banve_chi_tiet_de_xuat_bang_mau`
- `dq_bang_mau_banve_danh_sach_ban_ve`
- `dq_bang_mau_banve_danh_sach_ban_ve2`
- `dq_bang_mau_banve_de_xuat_bang_mau_add`
- `dq_bang_mau_banve_upload_ban_ve2`

### Module `bao_cao` (25)
- `dq_bao_cao_bao_cao_final`
- `dq_bao_cao_bao_cao_final_add`
- `dq_bao_cao_bao_cao_final_add2`
- `dq_bao_cao_bao_cao_hang_loi`
- `dq_bao_cao_bao_cao_hien_dien`
- `dq_bao_cao_bao_cao_hoan_thien_add`
- `dq_bao_cao_bao_cao_kiem_tra_chat_luong`
- `dq_bao_cao_bao_cao_kiem_tra_may_moc`
- `dq_bao_cao_bao_cao_lap_rap1_add`
- `dq_bao_cao_bao_cao_nguyen_phu_lieu_add`
- `dq_bao_cao_bao_cao_rot_chuyen_add`
- `dq_bao_cao_theo_doi_dat_hang`
- `dq_bao_cao_theo_doi_kiem_tra`
- `dq_bao_cao_thong_bao`
- `dq_bao_cao_thong_ke_so_luong`
- `dq_bao_cao_thong_ke_so_luong_add`
- `dq_bao_cao_thong_ke_so_luong_add2`
- `dq_bao_cao_thong_ke_xuat_hang_thanh_pham`
- `dq_bao_cao_thong_tin_interlock`
- `dq_bao_cao_thong_tin_lan_uv_add`
- `dq_bao_cao_thong_tin_nguoi_phu_trach_ky_thuat_add2`
- `dq_bao_cao_thong_tin_nhan_vien_edit`
- `dq_bao_cao_tong_hop_son_theo_ngay`
- `dq_bao_cao_tong_hop_son_uv`
- `dq_bao_cao_tong_hop_xuat_hop_chat_son`

### Module `bao_gia` (20)
- `dq_bao_gia_bao_gia2_chi_phi_khac_add`
- `dq_bao_gia_bao_gia3`
- `dq_bao_gia_bao_gia3_ngu_kim`
- `dq_bao_gia_bao_gia_chi_phi_nhan_cong`
- `dq_bao_gia_bao_gia_chi_tiet_go_van`
- `dq_bao_gia_bao_gia_chi_tiet_nha_cung_cap_add`
- `dq_bao_gia_bao_gia_phoi`
- `dq_bao_gia_bao_gia_vat_tu`
- `dq_bao_gia_bao_gia_vat_tu_add`
- `dq_bao_gia_bao_gia_vat_tu_add2`
- `dq_bao_gia_bao_gia_vat_tu_go_van`
- `dq_bao_gia_baogia_danhsach`
- `dq_bao_gia_baogia_export`
- `dq_bao_gia_baogia_sanpham_auto`
- `dq_bao_gia_baogia_sanpham_info`
- `dq_bao_gia_baogia_sanpham_ver2`
- `dq_bao_gia_baogia_sanpham_ver3`
- `dq_bao_gia_baogia_sanpham_ver4`
- `dq_bao_gia_danh_sach_bao_gia_hang_trang`
- `dq_bao_gia_danh_sach_bao_gia_phoi`

### Module `danh_muc` (19)
- `dq_danh_muc_cai_dat_don_gia_nguyen_lieu`
- `dq_danh_muc_cai_dat_don_gia_nguyen_lieu2`
- `dq_danh_muc_create_material_request_gva`
- `dq_danh_muc_create_material_request_gva_ver2`
- `dq_danh_muc_danh_muc_de_xuat2`
- `dq_danh_muc_danh_muc_loi_add`
- `dq_danh_muc_danh_sach_hoa_don`
- `dq_danh_muc_danh_sach_hoa_don2`
- `dq_danh_muc_danh_sach_ma_nha_may`
- `dq_danh_muc_danh_sach_may_moc`
- `dq_danh_muc_danh_sach_tai_san`
- `dq_danh_muc_danh_sach_tong_hop_xuat_hop_chat_son`
- `dq_danh_muc_danh_sach_xuat_go_van`
- `dq_danh_muc_list_bom_editor`
- `dq_danh_muc_list_material_in_out`
- `dq_danh_muc_list_material_request1`
- `dq_danh_muc_list_whsin_out`
- `dq_danh_muc_nhom_aiadd`
- `dq_danh_muc_nhom_may`

### Module `de_xuat` (9)
- `dq_de_xuat_chi_tiet_de_xuat_mua_hang`
- `dq_de_xuat_chi_tiet_de_xuat_phoi`
- `dq_de_xuat_de_xuat_muahang`
- `dq_de_xuat_de_xuat_muahang_add`
- `dq_de_xuat_de_xuat_phoi_add`
- `dq_de_xuat_de_xuat_phoi_add4`
- `dq_de_xuat_de_xuat_phoi_add5`
- `dq_de_xuat_de_xuat_van`
- `dq_de_xuat_destination_add`

### Module `dinh_muc` (14)
- `dq_dinh_muc_add_dinhmuc_vt_ver2`
- `dq_dinh_muc_dinh_muc_cat_van`
- `dq_dinh_muc_dinh_muc_chi_phi_san_pham`
- `dq_dinh_muc_dinh_muc_don_hang`
- `dq_dinh_muc_dinh_muc_go_van_so_che`
- `dq_dinh_muc_dinh_muc_he_hang`
- `dq_dinh_muc_dinh_muc_history`
- `dq_dinh_muc_dinh_muc_so_che`
- `dq_dinh_muc_dinh_muc_son3`
- `dq_dinh_muc_dinh_muc_son4`
- `dq_dinh_muc_dinh_muc_son_editor`
- `dq_dinh_muc_dinh_muc_son_mix`
- `dq_dinh_muc_dinh_muc_son_theo_mau`
- `dq_dinh_muc_kiemtra_dinhmuc_ver3`

### Module `don_hang` (39)
- `dq_don_hang_ban_hang_go`
- `dq_don_hang_banhang_add`
- `dq_don_hang_banhang_add2`
- `dq_don_hang_banhanggo_danh_sach_de_xuat_phoi`
- `dq_don_hang_banhanggo_danh_sach_de_xuat_phoi3`
- `dq_don_hang_banhanggo_danhsachdonhang`
- `dq_don_hang_banhanggo_phieudoihang_add`
- `dq_don_hang_banhanggo_phieunhapkho`
- `dq_don_hang_baocaobanhang`
- `dq_don_hang_commercial_invoice`
- `dq_don_hang_commercial_invoice_add`
- `dq_don_hang_danh_sach_don_hang_theo_ngay`
- `dq_don_hang_dao_dondathang`
- `dq_don_hang_do_don_hang`
- `dq_don_hang_don_hang_bu`
- `dq_don_hang_don_hang_bu_add`
- `dq_don_hang_don_hang_son`
- `dq_don_hang_hoa_don_ban_hang_add`
- `dq_don_hang_ke_hoach_don_hang_mau`
- `dq_don_hang_ke_hoach_hang_trang_don_hang`
- `dq_don_hang_list_purchase_order_list`
- `dq_don_hang_order_example`
- `dq_don_hang_order_example_add`
- `dq_don_hang_order_number_add`
- `dq_don_hang_order_number_add2`
- `dq_don_hang_order_number_add3`
- `dq_don_hang_proforma_invoice`
- `dq_don_hang_proforma_invoice_add`
- `dq_don_hang_proforma_invoice_add_1`
- `dq_don_hang_proforma_invoice_add_order_no`
- `dq_don_hang_purchase_order_edit`
- `dq_don_hang_purchase_order_edit2`
- `dq_don_hang_theo_doi_don_hang_chi_tiet`
- `dq_don_hang_thong_ke_chi_tiet_don_hang`
- `dq_don_hang_thong_tin_dat_hang_by_order`
- `dq_don_hang_tong_hop_chi_tiet_don_hang`
- `dq_don_hang_tong_hop_chi_tiet_don_hang2`
- `dq_don_hang_tong_hop_don_hang`
- `dq_don_hang_tu_dong_tao_don_hang`

### Module `ke_toan` (15)
- `dq_ke_toan_bang_du_tru_chi_phi`
- `dq_ke_toan_danh_sach_quy_trinh`
- `dq_ke_toan_danh_sach_quy_trinh2`
- `dq_ke_toan_de_xuat_phoi_chon_quy_cach`
- `dq_ke_toan_denghi_thanhtoan_ncc_add`
- `dq_ke_toan_denghi_thanhtoan_tonghop`
- `dq_ke_toan_giao_dich_thanh_toan`
- `dq_ke_toan_lich_su_thong_ke`
- `dq_ke_toan_ngan_hang_add`
- `dq_ke_toan_phan_quyen_ke_hoach`
- `dq_ke_toan_quy_trinh_lan_uv`
- `dq_ke_toan_quy_trinh_lan_uvadd`
- `dq_ke_toan_quy_trinh_son`
- `dq_ke_toan_quy_trinh_uv`
- `dq_ke_toan_view_quy_cach_carton`

### Module `khach_hang_ncc` (6)
- `dq_khach_hang_ncc_danhsachkhachhang`
- `dq_khach_hang_ncc_khach_hang_info`
- `dq_khach_hang_ncc_nha_cung_cap_add2`
- `dq_khach_hang_ncc_sosanhgia_nvt_ncc`
- `dq_khach_hang_ncc_sosanhgia_nvt_ncc_print`
- `dq_khach_hang_ncc_sosanhgia_nvt_ncc_print2`

### Module `kho_vat_tu` (66)
- `dq_kho_vat_tu_add_vattu_ver2`
- `dq_kho_vat_tu_chia_ton_kho`
- `dq_kho_vat_tu_chuyen_kho`
- `dq_kho_vat_tu_danh_sach_cap_phat_yeu_cau`
- `dq_kho_vat_tu_danh_sach_nhap_go_van`
- `dq_kho_vat_tu_danh_sach_vat_tu_khac`
- `dq_kho_vat_tu_danhsachtonkho_search`
- `dq_kho_vat_tu_kho`
- `dq_kho_vat_tu_lenh_cap_phat_add`
- `dq_kho_vat_tu_lenh_cap_phat_ai`
- `dq_kho_vat_tu_lenh_cap_phat_hang_trang`
- `dq_kho_vat_tu_lenh_cap_phat_theo_ho_so`
- `dq_kho_vat_tu_nhap_chitiet`
- `dq_kho_vat_tu_nhap_chitiet_ver2`
- `dq_kho_vat_tu_nhap_hang_loi`
- `dq_kho_vat_tu_nhap_hang_loi2`
- `dq_kho_vat_tu_nhap_hang_loi3`
- `dq_kho_vat_tu_nhap_hang_loi_add`
- `dq_kho_vat_tu_nhap_hang_trang`
- `dq_kho_vat_tu_nhap_kho2`
- `dq_kho_vat_tu_nhap_kho_bao_tri`
- `dq_kho_vat_tu_nhap_kho_go_van`
- `dq_kho_vat_tu_nhap_kho_thanh_pham`
- `dq_kho_vat_tu_phieu_bu_hang_add`
- `dq_kho_vat_tu_phieu_de_nghi_thanh_toan`
- `dq_kho_vat_tu_phieu_giao_nhan_hang`
- `dq_kho_vat_tu_phieu_giao_thanh_pham`
- `dq_kho_vat_tu_phieu_giao_thanh_pham_add`
- `dq_kho_vat_tu_phieu_tra_hang_nhap_add`
- `dq_kho_vat_tu_phieu_xuat_cont`
- `dq_kho_vat_tu_phieu_xuat_kho_add`
- `dq_kho_vat_tu_phieunhapkho_add`
- `dq_kho_vat_tu_so_sanh_gia_vat_tu`
- `dq_kho_vat_tu_tao_phieu_giao_nhan`
- `dq_kho_vat_tu_tao_phieu_pallet`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang2`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang_edit`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang_gva`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang_gva2`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang_khac`
- `dq_kho_vat_tu_tao_yeu_cau_mua_hang_theo_ho_so`
- `dq_kho_vat_tu_theo_doi_nhap_xuat`
- `dq_kho_vat_tu_theo_doi_nhap_xuat_chi_tiet`
- `dq_kho_vat_tu_ton_kho_bao_tri`
- `dq_kho_vat_tu_ton_kho_go_van_chon_quy_cach`
- `dq_kho_vat_tu_ton_kho_go_van_xuat_kho`
- `dq_kho_vat_tu_tong_hop_yeu_cau_xuat_kho_chi_tiet`
- `dq_kho_vat_tu_vattu`
- `dq_kho_vat_tu_vattu_update_price_supplier`
- `dq_kho_vat_tu_vattu_xacnhan`
- `dq_kho_vat_tu_warehouse_finish_good_input`
- `dq_kho_vat_tu_warehouse_finish_good_output`
- `dq_kho_vat_tu_warehouse_input`
- `dq_kho_vat_tu_warehouse_input_htr`
- `dq_kho_vat_tu_warehouse_output`
- `dq_kho_vat_tu_warehouse_output3`
- `dq_kho_vat_tu_warehouse_output_edit`
- `dq_kho_vat_tu_warehouse_output_material`
- `dq_kho_vat_tu_warehouse_return`
- `dq_kho_vat_tu_xuat_kho_lenh_cap_phat`
- `dq_kho_vat_tu_xuatnhapgo_lichsu`
- `dq_kho_vat_tu_yeu_cau_chat_luong_add`
- `dq_kho_vat_tu_yeu_cau_xuat_vat_tu`
- `dq_kho_vat_tu_yeu_cau_xuat_vat_tu_add`
- `dq_kho_vat_tu_yeu_cau_xuat_vat_tu_add2`

### Module `pallet` (2)
- `dq_pallet_danh_sach_pallet`
- `dq_pallet_in_pallet_2`

### Module `san_pham` (18)
- `dq_san_pham_add_sanpham`
- `dq_san_pham_create_material_code`
- `dq_san_pham_create_material_code_ver3`
- `dq_san_pham_create_material_code_ver4`
- `dq_san_pham_khoi_luong_san_pham`
- `dq_san_pham_material_code_edit`
- `dq_san_pham_nhap_san_pham_mau`
- `dq_san_pham_quy_trinh_san_pham`
- `dq_san_pham_quy_trinh_san_pham2`
- `dq_san_pham_quy_trinh_san_pham_copy`
- `dq_san_pham_san_pham_add3`
- `dq_san_pham_san_pham_edit_code`
- `dq_san_pham_san_pham_mau_nhap_xuat`
- `dq_san_pham_sanpham`
- `dq_san_pham_sanpham_multiselect`
- `dq_san_pham_tao_phieu_san_pham`
- `dq_san_pham_thong_tin_san_pham2_add`
- `dq_san_pham_thong_tin_san_pham_add`

### Module `san_xuat` (33)
- `dq_san_xuat_bao_cao_tien_do_chuyen_son_add`
- `dq_san_xuat_giao_nhan_hang_trang`
- `dq_san_xuat_ho_so_san_xuat`
- `dq_san_xuat_ke_hoach_hang_trang_sap_xep`
- `dq_san_xuat_ke_hoach_hang_trang_ver3`
- `dq_san_xuat_ke_hoach_san_xuat_po`
- `dq_san_xuat_ke_hoach_san_xuat_po2`
- `dq_san_xuat_ke_hoach_san_xuat_po2_htr`
- `dq_san_xuat_ke_hoach_san_xuat_po2_htr_add`
- `dq_san_xuat_lich_giao_hang_trang`
- `dq_san_xuat_muc_tieu_san_xuat`
- `dq_san_xuat_muc_tieu_san_xuat2`
- `dq_san_xuat_quan_ly_tieu_chuan`
- `dq_san_xuat_quy_trinh_san_xuat`
- `dq_san_xuat_quytrinh_sanxuat_copy`
- `dq_san_xuat_quytrinh_sanxuat_danhsach`
- `dq_san_xuat_quytrinh_sanxuat_danhsach2`
- `dq_san_xuat_quytrinh_sanxuat_import`
- `dq_san_xuat_quytrinh_sanxuat_reprint`
- `dq_san_xuat_quytrinh_sanxuat_ver2`
- `dq_san_xuat_scan110`
- `dq_san_xuat_scan110_1`
- `dq_san_xuat_thong_ke_cong_doan`
- `dq_san_xuat_tien_do_chuyen_son`
- `dq_san_xuat_tien_do_chuyen_son_add`
- `dq_san_xuat_tien_do_hang_trang`
- `dq_san_xuat_tien_do_hang_trang2`
- `dq_san_xuat_tien_do_hang_trang3`
- `dq_san_xuat_tiendo_sanxuat`
- `dq_san_xuat_tiendo_sanxuat_hangtrang`
- `dq_san_xuat_tieu_chuan_go_van`
- `dq_san_xuat_tong_hop_chi_tiet_hang_trang`
- `dq_san_xuat_trang_thai_san_xuat_htr`

## 5. Slug đụng route code hiện có

_Không có slug đụng route code._

> An toàn để tạo `/p/$slug` cho mọi trang ERP mà không đụng route hiện tại.

## 6. Route code inventory (src/routes)

> App routes cứng trong `src/routes/` — không phải page config.

| File | Path | Group | Dynamic? |
|------|------|-------|---------|
| `activity.tsx` | `/activity` | `app` |  |
| `agents.$id.tsx` | `/agents/:id` | `app` | ✓ |
| `agents.library.tsx` | `/agents/library` | `app` |  |
| `approvals.tsx` | `/approvals` | `app` |  |
| `ban-ve.ai.tsx` | `/ban-ve/ai` | `app` |  |
| `ban-ve.dao.tsx` | `/ban-ve/dao` | `app` |  |
| `ban-ve.dong-goi.tsx` | `/ban-ve/dong-goi` | `app` |  |
| `ban-ve.ky-thuat.tsx` | `/ban-ve/ky-thuat` | `app` |  |
| `ban-ve.mau.tsx` | `/ban-ve/mau` | `app` |  |
| `ban-ve.phat-trien.tsx` | `/ban-ve/phat-trien` | `app` |  |
| `ban-ve.tsx` | `/ban-ve` | `app` |  |
| `banve.tsx` | `/banve` | `app` |  |
| `chat.tsx` | `/chat` | `app` |  |
| `datasources.$id.tsx` | `/datasources/:id` | `app` | ✓ |
| `documents.tsx` | `/documents` | `app` |  |
| `entities.$id.tsx` | `/entities/:id` | `app` | ✓ |
| `entities.erd.tsx` | `/entities/erd` | `app` |  |
| `entities.index.tsx` | `/entities/` | `app` |  |
| `enums.$id.tsx` | `/enums/:id` | `app` | ✓ |
| `enums.index.tsx` | `/enums/` | `app` |  |
| `feedback.$id.tsx` | `/feedback/:id` | `app` | ✓ |
| `feedback.index.tsx` | `/feedback/` | `app` |  |
| `feedback.proposals.tsx` | `/feedback/proposals` | `app` |  |
| `index.tsx` | `/` | `app` |  |
| `invite.tsx` | `/invite` | `app` |  |
| `iot.$id.tsx` | `/iot/:id` | `app` | ✓ |
| `iot.tsx` | `/iot` | `app` |  |
| `join.tsx` | `/join` | `app` |  |
| `ketoan.chi-phi.tsx` | `/ketoan/chi-phi` | `ketoan` |  |
| `ketoan.cong-no.tsx` | `/ketoan/cong-no` | `ketoan` |  |
| `ketoan.de-nghi-thanh-toan.tsx` | `/ketoan/de-nghi-thanh-toan` | `ketoan` |  |
| `ketoan.ket-qua.tsx` | `/ketoan/ket-qua` | `ketoan` |  |
| `knowledge.tsx` | `/knowledge` | `app` |  |
| `mes.muctieu-sanxuat.tsx` | `/mes/muctieu-sanxuat` | `mes` |  |
| `oauth.callback.tsx` | `/oauth/callback` | `app` |  |
| `org-chart.tsx` | `/org-chart` | `app` |  |
| `pages.$id.tsx` | `/pages/:id` | `app` | ✓ |
| `portal.tsx` | `/portal` | `app` |  |
| `procedures.$id.tsx` | `/procedures/:id` | `app` | ✓ |
| `procedures.index.tsx` | `/procedures/` | `app` |  |
| `sanluong.tsx` | `/sanluong` | `app` |  |
| `server-data.tsx` | `/server-data` | `app` |  |
| `settings.agents.tsx` | `/settings/agents` | `settings` |  |
| `settings.api-keys.tsx` | `/settings/api-keys` | `settings` |  |
| `settings.backup.tsx` | `/settings/backup` | `settings` |  |
| `settings.cockpit.tsx` | `/settings/cockpit` | `settings` |  |
| `settings.companies.tsx` | `/settings/companies` | `settings` |  |
| `settings.embed.tsx` | `/settings/embed` | `settings` |  |
| `settings.embedding.tsx` | `/settings/embedding` | `settings` |  |
| `settings.errors.tsx` | `/settings/errors` | `settings` |  |
| `settings.llm.tsx` | `/settings/llm` | `settings` |  |
| `settings.mcp.tsx` | `/settings/mcp` | `settings` |  |
| `settings.menu-pages.tsx` | `/settings/menu-pages` | `settings` |  |
| `settings.mes-migrate.tsx` | `/settings/mes-migrate` | `settings` |  |
| `settings.migration.tsx` | `/settings/migration` | `settings` |  |
| `settings.pages-trash.tsx` | `/settings/pages-trash` | `settings` |  |
| `settings.plugins.tsx` | `/settings/plugins` | `settings` |  |
| `settings.rbac.tsx` | `/settings/rbac` | `settings` |  |
| `settings.shortcuts.tsx` | `/settings/shortcuts` | `settings` |  |
| `settings.tools.tsx` | `/settings/tools` | `settings` |  |
| `settings.transfer.tsx` | `/settings/transfer` | `settings` |  |
| `settings.viewer-groups.tsx` | `/settings/viewer-groups` | `settings` |  |
| `settings.web-search.tsx` | `/settings/web-search` | `settings` |  |
| `share.$token.tsx` | `/share/:token` | `app` | ✓ |
| `tools.$slug.tsx` | `/tools/:slug` | `app` | ✓ |
| `tools.index.tsx` | `/tools/` | `app` |  |
| `view.$pageId.tsx` | `/view/:pageId` | `app` | ✓ |
| `workflows.$id.tsx` | `/workflows/:id` | `app` | ✓ |
| `workflows.gallery.tsx` | `/workflows/gallery` | `app` |  |

## 7. Portal pages (pages-menu/)

> 145 trang portal chia theo nhóm menu (P01-P14, G1020). Mỗi trang này có thể map sang 1 trang ERP cùng nội dung.

- **65** trang portal có ERP counterpart (cùng slug) → candidate merge.
- **80** trang portal chưa có ERP counterpart (nội dung riêng biệt hoặc chưa port).

### Trang portal có ERP counterpart (cùng suggested slug)

| Portal page | ERP counterpart | Label | Group |
|-------------|----------------|-------|-------|
| `dq_g1020_danh_sach_cong_no` | `dq_khach_hang_ncc_danhsachkhachhang` | "Danh sách khách hàng" | `G1020` |
| `dq_g1020_hoa_don_ban_hang_add` | `dq_danh_muc_danh_sach_hoa_don2` | "Hoá đơn bán hàng" | `G1020` |
| `dq_g1020_kho` | `dq_kho_vat_tu_kho` | "Danh sách kho" | `G1020` |
| `dq_p01_bao_cao_final` | `dq_bao_cao_bao_cao_final_add2` | "Báo cáo Final" | `P01` |
| `dq_p01_dinh_muc_he_hang` | `dq_dinh_muc_dinh_muc_he_hang` | "Kiểm tra định mức - bản vẽ - AI" | `P01` |
| `dq_p01_don_hang_bu` | `dq_don_hang_don_hang_bu` | "Đơn hàng bù" | `P01` |
| `dq_p01_phieu_de_nghi_thanh_toan` | `dq_kho_vat_tu_phieu_de_nghi_thanh_toan_add` | "Phiếu đề nghị thanh toán" | `P01` |
| `dq_p01_phieu_giao_nhan_hang` | `dq_kho_vat_tu_phieu_giao_nhan_hang` | "Phiếu giao nhận hàng" | `P01` |
| `dq_p01_san_pham_mau_nhap_xuat` | `dq_san_pham_san_pham_mau_nhap_xuat` | "Nhập - Xuất hàng mẫu" | `P01` |
| `dq_p01_sanpham` | `dq_danh_muc_list_bom_editor` | "Danh sách sản phẩm" | `P01` |
| `dq_p01_theo_doi_dat_hang` | `dq_bao_cao_theo_doi_dat_hang` | "Theo dõi đơn đặt hàng" | `P01` |
| `dq_p01_thong_ke_xuat_hang_thanh_pham` | `dq_bao_cao_thong_ke_xuat_hang_thanh_pham` | "Thống kê xuất hàng thành phẩm" | `P01` |
| `dq_p02_create_material_code` | `dq_san_pham_create_material_code_ver3` | "Tạo mã chi tiết" | `P02` |
| `dq_p02_create_material_code_ver3` | `dq_san_pham_create_material_code_ver3` | "Tạo mã chi tiết" | `P02` |
| `dq_p02_danh_sach_ban_ve` | `dq_bang_mau_banve_banve2` | "Danh sách bản vẽ" | `P02` |
| `dq_p02_danh_sach_ban_ve2` | `dq_bang_mau_banve_danh_sach_ban_ve2` | "Danh sách bản vẽ (đã phát hành)" | `P02` |
| `dq_p02_dinh_muc_go_van_so_che` | `dq_dinh_muc_dinh_muc_so_che` | "Định mức sơ chế" | `P02` |
| `dq_p02_dinh_muc_son3` | `dq_dinh_muc_dinh_muc_son_editor` | "Định mức sơn" | `P02` |
| `dq_p02_dinh_muc_son4` | `dq_dinh_muc_dinh_muc_son4` | "Định mức màu sơn" | `P02` |
| `dq_p02_phat_hanh_dinh_muc2` | `dq_dinh_muc_phat_hanh_dinh_muc2` | "Phát hành định mức" | `P02` |
| `dq_p02_quy_trinh_son` | `dq_dinh_muc_dinh_muc_son3` | "Quy trình sơn" | `P02` |
| `dq_p02_tong_hop_chi_tiet_don_hang2` | `dq_don_hang_tong_hop_chi_tiet_don_hang` | "Tổng hợp chi tiết theo đơn hàng" | `P02` |
| `dq_p03_bao_gia_phoi` | `dq_bao_gia_bao_gia_phoi` | "Báo giá phôi" | `P03` |
| `dq_p03_bao_gia_vat_tu_go_van` | `dq_bao_gia_bao_gia_chi_tiet_go_van` | "Báo giá chi tiết gỗ ván" | `P03` |
| `dq_p03_baogia_danhsach` | `dq_bao_gia_baogia_danhsach` | "Danh sách báo giá" | `P03` |
| `dq_p03_commercial_invoice` | `dq_don_hang_commercial_invoice_add` | "Commercial Invoice" | `P03` |
| `dq_p03_danh_sach_bao_gia_hang_trang` | `dq_bao_gia_danh_sach_bao_gia_hang_trang` | "Danh sách báo giá hàng trắng" | `P03` |
| `dq_p03_danh_sach_bao_gia_phoi` | `dq_bao_gia_danh_sach_bao_gia_phoi` | "Danh sách báo giá phôi" | `P03` |
| `dq_p03_don_hang_bu` | `dq_don_hang_don_hang_bu` | "Đơn hàng bù" | `P03` |
| `dq_p03_khach_hang` | `dq_khach_hang_ncc_khach_hang_info` | "Thông tin khách hàng" | `P03` |
| `dq_p03_order_number_add` | `dq_don_hang_order_number_add` | "Tạo đơn hàng" | `P03` |
| `dq_p03_proforma_invoice` | `dq_don_hang_proforma_invoice` | "Proforma Invoice" | `P03` |
| `dq_p05_ke_hoach_hang_trang3` | `dq_don_hang_ke_hoach_hang_trang_don_hang` | "Kế hoạch đơn hàng trắng" | `P05` |
| `dq_p05_ke_hoach_san_xuat_po2_htr` | `dq_san_xuat_ke_hoach_hang_trang3` | "Kế hoạch sản xuất hàng trắng" | `P05` |
| `dq_p05_lenh_cap_phat_hang_trang` | `dq_kho_vat_tu_lenh_cap_phat_hang_trang` | "Lệnh cấp phát hàng trắng" | `P05` |
| `dq_p05_lich_giao_hang_trang` | `dq_san_xuat_lich_giao_hang_trang` | "Kế hoạch giao hàng trắng" | `P05` |
| `dq_p05_muc_tieu_san_xuat2` | `dq_san_xuat_muc_tieu_san_xuat` | "Mục tiêu sản xuất" | `P05` |
| `dq_p05_tao_yeu_cau_mua_hang_theo_ho_so` | `dq_kho_vat_tu_tao_yeu_cau_mua_hang` | "Tạo yêu cầu mua hàng" | `P05` |
| `dq_p07_danh_sach_vat_tu_don_hang` | `dq_don_hang_tong_hop_chi_tiet_don_hang` | "Tổng hợp chi tiết theo đơn hàng" | `P07` |
| `dq_p07_nhap_kho2` | `dq_don_hang_banhanggo_phieunhapkho` | "Nhập kho" | `P07` |
| `dq_p07_ton_kho_bao_tri` | `dq_kho_vat_tu_ton_kho_bao_tri` | "Tồn kho bảo trì" | `P07` |
| `dq_p07_warehouse_finish_good_input` | `dq_kho_vat_tu_nhap_kho_thanh_pham` | "Nhập kho thành phẩm" | `P07` |
| `dq_p07_warehouse_finish_good_output` | `dq_kho_vat_tu_warehouse_finish_good_output` | "Xuất kho thành phẩm" | `P07` |
| `dq_p07_xuat_kho_lenh_cap_phat` | `dq_kho_vat_tu_warehouse_output` | "Xuất kho theo lệnh cấp phát" | `P07` |
| `dq_p08_chi_phi_don_hang` | `dq_don_hang_theo_doi_don_hang_phoi` | "Theo dõi đơn hàng phôi" | `P08` |
| `dq_p08_create_material_request_gva` | `dq_danh_muc_create_material_request_gva_ver2` | "Lệnh cấp phát gỗ ván" | `P08` |
| `dq_p08_dinh_muc_vat_tu_tieu_hao` | `dq_dinh_muc_dinh_muc_vat_tu_tieu_hao` | "Định mức vật tư tiêu hao" | `P08` |
| `dq_p08_lenh_cap_phat_ai` | `dq_kho_vat_tu_lenh_cap_phat_ai` | "Lệnh cấp phát AI" | `P08` |
| `dq_p09_dashboard_order` | `dq_don_hang_danh_sach_don_hang_theo_ngay` | "Thống kê đơn hàng" | `P09` |
| `dq_p09_phieu_de_nghi_thanh_toan` | `dq_kho_vat_tu_phieu_de_nghi_thanh_toan_add` | "Phiếu đề nghị thanh toán" | `P09` |
| `dq_p10_bao_cao_hien_dien` | `dq_bao_cao_bao_cao_hien_dien` | "Báo cáo hiện diện" | `P10` |
| `dq_p10_bao_cao_kiem_tra_chat_luong` | `dq_bao_cao_bao_cao_kiem_tra_chat_luong` | "Báo cáo kiểm tra chất lượng" | `P10` |
| `dq_p10_in_pallet` | `dq_pallet_in_pallet` | "In phiếu Pallet" | `P10` |
| `dq_p10_kiemtra_dinhmuc_ver3` | `dq_dinh_muc_kiemtra_dinhmuc_ver2` | "Kiểm tra định mức (theo đơn hàng)" | `P10` |
| `dq_p10_nhap_hang_loi3` | `dq_kho_vat_tu_nhap_hang_loi3` | "Báo cáo hàng lỗi" | `P10` |
| `dq_p10_phieu_giao_thanh_pham` | `dq_kho_vat_tu_phieu_giao_thanh_pham` | "Phiếu giao thành phẩm" | `P10` |
| `dq_p10_thong_ke_cong_doan` | `dq_san_xuat_tien_do_hang_trang2` | "Theo dõi tiến độ hàng trắng" | `P10` |
| `dq_p10_thong_ke_so_luong_add2` | `dq_bao_cao_thong_ke_so_luong_add2` | "Thống kê sản lượng (Sơn, Đóng gói)" | `P10` |
| `dq_p10_tien_do_hang_trang3` | `dq_kho_vat_tu_nhap_tien_do_hang_trang` | "Nhập tiến độ hàng trắng" | `P10` |
| `dq_p10_trang_thai_san_xuat_htr` | `dq_san_xuat_giao_nhan_hang_trang` | "Trạng thái sản xuất hàng trắng" | `P10` |
| `dq_p12_quy_trinh_san_pham` | `dq_san_pham_quy_trinh_san_pham` | "Quy trình sản phẩm" | `P12` |
| `dq_p13_banhanggo_danh_sach_de_xuat_phoi` | `dq_don_hang_banhanggo_danh_sach_de_xuat_phoi` | "Danh sách đề xuất phôi" | `P13` |
| `dq_p13_banhanggo_danhsachdonhang` | `dq_khach_hang_ncc_danhsachkhachhang` | "Danh sách khách hàng" | `P13` |
| `dq_p13_xuatnhapgo_lichsu` | `dq_kho_vat_tu_xuatnhapgo_lichsu` | "Lịch sử nhập -  xuất" | `P13` |
| `dq_p14_dinh_muc_chi_phi_san_pham` | `dq_dinh_muc_dinh_muc_chi_phi_san_pham` | "Định mức chi phí sản phẩm" | `P14` |

## 8. Follow-up cho P1+

- **P1 — Giải quyết trùng slug cross-source** (60 nhóm): chốt 1 trang canonical cho mỗi slug, map portal page → ERP page.
- **P1 — Hợp nhất trang phiên bản** (79 trang): gộp ver2/add2 vào trang chính, thêm redirect.
- **P1**: Chốt slug cho module ưu tiên: `san_pham`, `don_hang`, `dinh_muc`, `san_xuat`, `kho_vat_tu`, `ke_toan`, `bao_gia`, `bang_mau_banve`.
- **P2**: Thêm route `/p/$slug` vào TanStack Router.
- **P3**: Menu dùng slug + giữ `page_id` làm fallback.
- **P4**: Redirect legacy URL: `/banve` → `/ban-ve`, `/sanluong` → `/san-luong`.
- **DB check**: Xác nhận `deleted_at IS NULL` trên prod cho planned-delete trước khi xoá.
- **Giới hạn P0**: `pageId` (UUID prod) chưa có trong JSON file.
  Để lấy: `migration_query_readonly` trên MCP hoặc `SELECT id,name FROM pages WHERE deleted_at IS NULL`.
