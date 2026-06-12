# Đề xuất DataSource từ 275 proc query_datasource (2026-06-12)

Cluster theo base + hợp nhất join (script cluster-datasource-procs.ts, chi tiết datasource-clusters.json).

## Tổng quan: 275 proc = 121 đọc đơn giản (→ DS) + 114 đọc phức tạp (Tier D đọc) + 40 CÓ GHI (reclassify Tier D port)

## A. 37 DataSource tạo được NGAY (đủ entity trên prod) — phủ 72 proc

| DS đề xuất | Base | Join | Số proc | Procs |
|---|---|---|---|---|
| ds_lenhcapphat_head | tr_lenhcapphat_head | tr_lenhcapphat, tr_material | 7 | TR_LENHCAPPHAT_HEAD_GET2, TR_LENHCAPPHAT_HEAD_GETLISTBYTYPE, TR_LENHCAPPHAT_HEAD_GETBYKHO, TR_LENHCAPPHAT_HEAD_GETBYACTIVE, TR_LENHCAPPHAT_GETLISTBYORDER, TR_LENHCAPPHAT_GETLISTBYSP, … |
| ds_order | tr_order | tr_khachhang, tr_order_detail, tr_sanpham | 5 | TR_ORDER_GET2, TR_ORDER_GETBYSTATUS, TR_ORDER_GETALLBYCUSTOMER, TR_ORDER_DETAIL_TONGHOPBYDATE, TR_ORDER_GETALL2 |
| ds_material | tr_material | — | 5 | TR_MATERIAL_GETGROUP, TR_MATERIAL_GETLISTBYTYPE, TR_MATERIAL_GETGROUP3, TR_MATERIAL_GETALL3, TR_MATERIAL_GETGROUP2 |
| ds_dondathang | tr_dondathang | sys_user, tr_dondathang_chitiet, tr_order_detail, tr_sanpham | 5 | TR_DONDATHANG_GET3, TR_DONDATHANG_GetByWS, TR_DONDATHANG_GETBYTYPE2, TR_DONDATHANG_GETBYSTATUS, TR_DONDATHANG_CHITIET_LSX |
| ds_banve | tr_banve | tr_sanpham | 3 | TR_BANVE_GET2, TR_BANVE_GETBYTYPE, TR_BANVE_GETALL3 |
| ds_phieuxuat | tr_phieuxuat | tr_ctphieuxuat, tr_material, tr_reftype | 3 | TR_PHIEUXUAT_GETBYMACT, TR_PHIEUXUAT_GETLISTBYLCP, TR_PHIEUXUAT_GETALLBYWHS |
| ds_phieubaogia | tr_phieubaogia | sys_user, tr_nhacc, tr_phieubaogia_chitiet | 3 | TR_PHIEUBAOGIA_GETBYNUMBER, TR_PHIEUBAOGIA_GETBYDATE, TR_PHIEUBAOGIA_CHITIET_GETALL3 |
| ds_trangthai_sanxuat | tr_trangthai_sanxuat | — | 3 | TR_TRANGTHAI_SANXUAT_GETBYPCARD, TR_TRANGTHAI_SANXUAT_GETDAY, TR_TRANGTHAI_SANXUAT_GETLIST2 |
| ds_baocao_hangloi | tr_baocao_hangloi | tr_bophan, tr_sanpham | 3 | TR_BAOCAO_HANGLOI_GETLISTBYDATE, TR_BAOCAO_HANGLOI_GETLISTBYMONTH, TR_BAOCAO_HANGLOI_GETLISTBYYEAR |
| ds_sanpham_nhamay | tr_sanpham_nhamay | — | 2 | TR_SANPHAM_NHAMAY_GETBYSTATUS, TR_SANPHAM_NHAMAY_GETBYHEHANG |
| ds_sanpham | tr_sanpham | tr_banve, tr_color, tr_khachhang, tr_loaisp | 2 | TR_BANVE_GetAll2, TR_SANPHAM_GetAll2 |
| ds_dexuat_phoi_chitiet | tr_dexuat_phoi_chitiet | tr_dexuat_phoi | 2 | TR_DEXUAT_PHOI_CHITIET_GETALL2, TR_DEXUAT_PHOI_CHITIET_GETALL4 |
| ds_dinhmuc_ngukim | tr_dinhmuc_ngukim | tr_material | 2 | TR_DINHMUC_NGUKIM_Get2, TR_DINHMUC_NGUKIM_Get3 |
| ds_phieuyeucau | tr_phieuyeucau | sys_user, tr_bophan, tr_loai_dexuat, tr_material, tr_phieuyeucau_chitiet, tr_site | 2 | TR_PHIEUYEUCAU_GET2, TR_PHIEUYEUCAU_GETALL3 |
| ds_pallet_card | tr_pallet_card | tr_pallet | 2 | TR_PALLET_CARD_GETALL2, TR_PALLET_CARD_GETALL4 |
| ds_order_detail | tr_order_detail | tr_sanpham | 2 | TR_ORDER_DETAIL_GETLISTBYID, ListOrderNumber |
| ds_baogia_thanhpham | tr_baogia_thanhpham | — | 1 | TR_BAOGIA_THANHPHAM_GET2 |
| ds_phieuyeucau_muahang | tr_phieuyeucau_muahang | sys_user, tr_material, tr_phieuyeucau_muahang_chitiet | 1 | TR_PHIEUYEUCAU_MUAHANG_GETBYNUMBER2 |
| ds_baocao_final | tr_baocao_final | — | 1 | TR_BAOCAO_FINAL_BAOCAOCHATLUONG |
| ds_phieunhap | tr_phieunhap | tr_ctphieunhap, tr_material | 1 | TR_PHIEUNHAP_GETBYMACT |
| ds_baocao_final_muckiemtra | tr_baocao_final_muckiemtra | tr_baocao_final_hinhanh | 1 | TR_BAOCAO_FINAL_MUCKIEMTRA_GETALL2 |
| ds_pallet | tr_pallet | tr_pallet_card, tr_sanpham | 1 | TR_PALLET_CARD_GETBYORDER |
| ds_nganhang | tr_nganhang | — | 1 | TR_NGANHANG_GETDEFAULT |
| ds_muctieu_sanxuat2 | tr_muctieu_sanxuat2 | trtb_m_op | 1 | TR_MUCTIEU_SANXUAT2_GETBYMONTH |
| ds_material_other | tr_material_other | — | 1 | TR_MATERIAL_OTHER_GETBYCODE |
| ds_material_ncc | tr_material_ncc | — | 1 | TR_MATERIAL_NCC_GET2 |
| ds_baogia_donggoi | tr_baogia_donggoi | tr_material | 1 | TR_BAOGIA_DONGGOI_GET2 |
| ds_thaydoi_kythuat | tr_thaydoi_kythuat | tr_sanpham | 1 | TR_THAYDOI_KYTHUAT_BAOCAOCHATLUONG |
| ds_baogia_govan | tr_baogia_govan | — | 1 | TR_BAOGIA_GOVAN_GET2 |
| ds_lenhcapphat | tr_lenhcapphat | — | 1 | TR_LENHCAPPHAT_GetListID |
| ds_dondathang_chitiet | tr_dondathang_chitiet | — | 1 | TR_DONDATHANG_CHITIET_GET2 |
| ds_baogia_ngukim | tr_baogia_ngukim | tr_material | 1 | TR_BAOGIA_NGUKIM_GET2 |
| ds_dinhmuc_son2 | tr_dinhmuc_son2 | — | 1 | TR_DINHMUC_SON2_GETLISTBYMASP |
| ds_dexuat_phoi | tr_dexuat_phoi | sys_user, tr_loai_dexuat | 1 | TR_DEXUAT_PHOI_GETBYNUMBER2 |
| ds_dexuat_bangmau | tr_dexuat_bangmau | sys_user | 1 | TR_DEXUAT_BANGMAU_GETBYNUMBER |
| ds_baogia_son | tr_baogia_son | — | 1 | TR_BAOGIA_SON_GET2 |
| ds_list_shipping | tr_list_shipping | — | 1 | TR_LIST_SHIPPING_GETBYDESTINATION |

## B. 36 DataSource BỊ CHẶN (thiếu entity — cần migrate bảng trước) — phủ 49 proc

| DS đề xuất | Base | Thiếu bảng | Số proc |
|---|---|---|---|
| ds_dinhmuc_govan | tr_dinhmuc_govan | tr_loai_uv, tr_tinhtrang_fsc | 6 |
| ds_tieuchuan_chatluong | tr_tieuchuan_chatluong | tr_tieuchuan, tr_tieuchuan_chatluong, tr_tieuchuan_congdoan, tr_tieuchuan_nguyennhan | 3 |
| ds_hr_nhanvien_2 | hr_nhanvien_2 | hr_bophan_2, hr_nhanvien_2 | 2 |
| ds_order_example_detail | tr_order_example_detail | tr_order_example_detail | 2 |
| ds_khuvuc_sanxuat | tr_khuvuc_sanxuat | tr_khuvuc_sanxuat | 2 |
| ds_denghi_thanhtoan | tr_denghi_thanhtoan | tr_phieudenghi_thanhtoan_nhacc | 2 |
| ds_m_op | trtb_m_op | tr_khuvuc_sanxuat | 2 |
| ds_bieumau_friday | tr_bieumau_friday | tr_bieumau_friday, tr_bieumau_friday_congdoan | 2 |
| ds_bom_mix | tr_bom_mix | tr_bom_mix | 1 |
| ds_tonghop_xuat_hopchat | tr_tonghop_xuat_hopchat | tr_tonghop_xuat_hopchat | 1 |
| ds_mes_quytrinh_sanpham | mes_quytrinh_sanpham | tr_khuvuc_sanxuat | 1 |
| ds_thongtin_sanpham_nguyenlieu | tr_thongtin_sanpham_nguyenlieu | tr_thongtin_sanpham_nguyenlieu | 1 |
| ds_sanpham_venner | tr_sanpham_venner | tr_sanpham_venner | 1 |
| ds_sanpham_vattu | tr_sanpham_vattu | tr_sanpham_vattu | 1 |
| ds_sanpham_tem | tr_sanpham_tem | tr_sanpham_tem | 1 |
| ds_sanpham_ngukim | tr_sanpham_ngukim | tr_sanpham_ngukim | 1 |
| ds_quytrinh_yeucau_chatluong | tr_quytrinh_yeucau_chatluong | tr_quytrinh_yeucau_chatluong | 1 |
| ds_proforma_invoice | tr_proforma_invoice | tr_proforma_invoice | 1 |
| ds_phieuxuat_thanhpham2 | tr_phieuxuat_thanhpham2 | tr_phieuxuat_thanhpham2, tr_phieuxuat_thanhpham2_chitiet, tr_tinhtrang_fsc | 1 |
| ds_phieugiao_thanhpham_chitiet | tr_phieugiao_thanhpham_chitiet | tr_phieugiao_thanhpham_chitiet | 1 |
| ds_rst_nhap_nguyenlieu | rst_nhap_nguyenlieu | rst_nhap_nguyenlieu | 1 |
| ds_order_example | tr_order_example | tr_order_example | 1 |
| ds_nhap_thanhpham | tr_nhap_thanhpham | tr_nhap_thanhpham | 1 |
| ds_nguyenlieu_tenkhoahoc | tr_nguyenlieu_tenkhoahoc | tr_nguyenlieu_tenkhoahoc | 1 |
| ds_tonkho_chitiet | tr_tonkho_chitiet | tr_tonkho_chitiet | 1 |
| ds_luutrinh_sanxuat | tr_luutrinh_sanxuat | tr_luutrinh_sanxuat | 1 |
| ds_sal_baogia_govan | sal_baogia_govan | sal_baogia_govan | 1 |
| ds_kehoach_hangtrang | tr_kehoach_hangtrang | tr_kehoach_hangtrang | 1 |
| ds_kehoach_giaohang | tr_kehoach_giaohang | tr_kehoach_giaohang | 1 |
| ds_gridview_column | tr_gridview_column | tr_gridview_column | 1 |
| ds_email_subscriber2 | tr_email_subscriber2 | tr_email_subscriber2 | 1 |
| ds_stockbalances | stockbalances | stockbalances | 1 |
| ds_baogia3_giaphoi | tr_baogia3_giaphoi | tr_baogia3_giaphoi | 1 |
| ds_cont | tr_cont | tr_cont | 1 |
| ds_nhom_nguyenlieu | tr_nhom_nguyenlieu | tr_nhom_nguyenlieu | 1 |
| ds_material_mix | tr_material_mix | tr_material_mix | 1 |

## C. 114 proc đọc phức tạp (group-by/union/temp/cursor/scalar/subquery) → Tier D đọc hoặc chờ DataSource groupBy server-side — danh sách trong datasource-clusters.json (complexProcs)

## D. 40 proc CÓ GHI bị kiểm kê cũ xếp nhầm vào query_datasource → chuyển sang hàng đợi port Tier D (writeProcs trong JSON)
