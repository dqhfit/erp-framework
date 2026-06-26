# Kế hoạch port form "Giai đoạn 2" (DQHF → ERP)

> Nguồn: `docs/Danh Sach Form Chuyen Doi - All.xlsx`, sheet **Giai doan 2**.
> Phạm vi chốt với user (2026-06-25):
> - Nhóm **Anh Thiện** (R29–R31, R42): **chỉ verify**, KHÔNG đụng deploy.
> - Nhóm **chưa có tên** (cột "Người làm" trống): trang `dq_*` (scaffold pilot
>   sơ khai, 1 widget, không nút/chức năng) **coi như CHƯA tạo** → dựng lại tử tế.
> - Form DQHF nguồn: `D:\code\DotNET\DQHF` (mirror `DQHFDotNet/DQHF` + `DQHF/`).

## Tài nguyên dùng lại (KHÔNG dựng từ đầu)

| Thứ | Vị trí | Dùng để |
|---|---|---|
| Form đã parse | `migration-plan/ui/<module>.forms.yaml` | title, entities(bảng), repos, **procs**, grid columns (field+header), inputs, **buttons** — KHÔNG cần đọc lại C# trừ khi thiếu |
| Menu↔form↔page | bảng `legacy_menu_map` (prod, MCP `migration_query_readonly`) | `name`(nhãn), `win_id`(form), `page_id`(#P=đã gắn), `source_code`(link menu) |
| DataSource sẵn | MCP `datasource_list` (~90 DS) | wire list widget; ưu tiên DS sẵn trước khi tạo mới (DataSource-first) |
| Entity bảng-thật | MCP `entity_list`/`entity_get`/`migration_inspect_table` | UUID entity (config.entity), field name, storage tier |
| Trang mẫu tốt | `mau_sac_647fcb` (list CRUD đầy đủ), `dinh_muc_go_van_d7c566`, `lcp_lenhcapphat` | khuôn content PageComponent |

## Schema content trang (PageComponent[])

`content` = mảng `{id, kind, x, y, w, h, config}` trên grid 12 cột.

**Widget kind**: `list` (lưới CRUD — phổ biến nhất), `form`, `detail`, `actionbar`,
`action`, `kpi`, `chart`, `split`, `grid`, `step`, `search`, `filter`, `combobox`,
`listbox`, `tagbox`, `pivot`, `calendar`, `html`.

**list.config** chính: `entity`(UUID), `dataSourceId`(nếu wire DS), `fields[]`,
`columnLabels{}`, `fieldOverrides{}` (type: image|file|boolean|select|longtext|number),
`fieldLookups{}` (entity+valueField+labelFields), `defaultSort`, `pageSize`, `editable`,
`editFields[]`, `selectable`, `embeddedFilters[]`, `rowActions[]`, `embeddedActions[]`.

**rowActions / embeddedActions** = nút bấm. Mỗi nút `{icon,label,variant,steps[]}`.
**step.kind**: `confirm`, `set-state`, `refresh`, `navigate`, `open-popup`,
`open-create-form`, `open-wizard`, `delete-record`, `create-record`, `update-record`,
`update-fields`, **`invoke-module-proc`** (gọi Tier D proc; token `$currentUser`/`$now`),
`procedure`.

Map nút ribbon DQHF → step:
- Thêm/Sửa → `open-wizard` (hoặc `open-create-form`) ghi entity.
- Xem → `open-popup` popupMode:detail.
- Xoá → `confirm` + `delete-record`.
- Lưu/Phát hành/Tính toán/Tạo phiếu (có logic) → `invoke-module-proc` (CẦN proc Tier D — nếu chưa có thì GHI CHÚ, đừng bịa).
- In/Export → hiện chưa có step in; ghi chú "cần widget/handler in".

## Quy tắc bắt buộc (từ memory + CLAUDE.md)

1. **Màu**: chỉ token semantic, cấm `*-500`/`#hex` (config trang dùng icon name + variant, không màu).
2. **Tạo trang = `page_create_draft`** (published=false). KHÔNG publish, KHÔNG link menu trong sub-agent — để orchestrator review rồi mới `menu_link_pages publish=true`.
3. **Idempotent theo `id`**: nếu dựng lại trang đã có (kể cả skeleton dq_*), nên tạo trang MỚI (tên hash) rồi orchestrator quyết thay link menu; KHÔNG overwrite trang publish của user.
4. **DataSource-first**: proc đọc → mở rộng/tận dụng DS; chỉ proc GHI/scalar mới Tier D.
5. **Bám UI form gốc**: cột/thứ tự/nhãn theo grid DQHF trong forms.yaml (label Việt giữ nguyên).
6. **AI fail-safe / không bịa proc**: nút cần proc chưa tồn tại → ghi chú, không gọi bừa.

---

## A. Nhóm Anh Thiện — VERIFY ONLY (4 mục)

| R | Mục | Bảng | Trang prod | Form DQHF (forms.yaml: dinh_muc / kho_vat_tu) |
|---|---|---|---|---|
| 29 | Định mức gỗ ván | tr_dinhmuc_govan, tr_sanpham, tr_baogia_chiphi_veneer | `dinh_muc_go_van_d7c566` | frmPhatHanhDinhMuc2 / frmDinhMucGoVan_TreeList / frm_add_dinhmuc_vt_ver2 |
| 30 | Định mức ngũ kim | tr_dinhmuc_ngukim, tr_sanpham, tr_material | `dinh_muc_ngu_kim_e69c33` | frm_add_dinhmuc_nk |
| 31 | Định mức đóng gói | tr_dinhmuc_donggoi, tr_sanpham, tr_material | `dinh_muc_dong_goi_7bd5a6` | (đóng gói trong frmPhatHanhDinhMuc) |
| 42 | Tạo lệnh cấp phát | tr_lenhcapphat_head, tr_lenhcapphat | `lcp_lenhcapphat` (a04524f0) | frmXuatVatTu / frmCreateMaterialRequest* / frmLenhCapPhatAdd |

Verify: đối chiếu nút/cột/chức năng trang vs form gốc → báo gap → sửa config nếu lệch (KHÔNG cutover/redeploy).

---

## B. Nhóm chưa-tên — PORT (dq_* skeleton = chưa xong)

Ký hiệu trạng thái prod: **none** = không trang nào · **dq** = chỉ skeleton dq_* · **real** = trang dựng tay (bỏ qua, đã có).

| R | Nhóm | Mục | Bảng chính | Form DQHF | Prod | Batch |
|---|---|---|---|---|---|---|
| 18 | Danh mục | Danh mục đề xuất | tr_dexuat_* / tr_phieuyeucau* / tr_denghi_thanhtoan | frmDanhMucDeXuat | none | B1 |
| 19 | Danh mục | Phiếu giao nhận hàng | tr_giaohang(_chitiet) | frmPhieuGiaoNhanHang | **real** (phieu_giao_nhan_hang_336b68) | — SKIP |
| 20 | Danh mục | Báo cáo final | tr_baocao_final(_hinhanh/_muckiemtra) | frmBaoCaoFinal | dq | B1 |
| 21 | BGĐ | Duyệt đơn hàng | tr_order | frmDuyetDonHang | none | B2 |
| 22 | BGĐ | Duyệt đơn đặt hàng | tr_dondathang | frmBGD110 | none | B2 |
| 23 | BGĐ | Duyệt báo giá vật tư | tr_baogia_vattu | frmBGD160 | none | B2 |
| 27 | Kinh doanh | Báo giá hoàn thiện | tr_baogia* | frm_baogia_sanpham_ver3 | dq | B3 |
| 28 | Kinh doanh | Danh sách báo giá | tr_baogia2_danhsach | frm_baogia_danhsach | dq | B3 |
| 37 | Thu mua | Danh sách đơn đặt hàng | tr_dondathang | frm_thongtin_dathang_ver2 | **real** (danh_sach_don_dat_hang_9d5610) | — SKIP |
| 39 | Thu mua | Tạo báo giá vật tư | tr_baogia_vattu | frmBaoGiaVatTu | dq | B3 |
| 40 | Thu mua | Quản lý đơn giá | tr_material/tr_dongia* | frmMaterialPrice / frm_dongia_goc | none | B3 |
| 41 | Thu mua | Chứng chỉ gỗ ván | (fsc) | frmChungChiGoVan | none | B3 |
| 43 | Kho VT | Phiếu nhập kho vật tư | tr_phieunhap | frmNhapKho2 | dq | B4 |
| 44 | Kho VT | Phiếu xuất kho vật tư | tr_phieuxuat | frmYeuCauXuat_VatTu / frmXuatKhoLenhCapPhat | dq | B4 |
| 45 | Kho VT | Danh sách tồn kho vật tư | tr_tonkho_chitiet | frmDanhSachTonKho / frmOnhandMaterial | none | B4 |
| 46 | Kho VT | Thống kê nhập-xuất | (nhập/xuất) | frmListMaterialInOut / frmTheoDoiNhapXuat | dq | B4 |
| 47 | Kho TP | Phiếu giao thành phẩm | tr_phieugiao_thanhpham(_chitiet) | frmPhieuGiaoThanhPham | dq | B5 |
| 48 | Kho TP | Nhập kho thành phẩm | tr_nhap_thanhpham | frmWarehouseFinishGoodInput | dq | B5 |
| 49 | Kho TP | Xuất kho thành phẩm | tr_phieuxuat_thanhpham2 | frmWarehouseFinishGoodOutput | dq | B5 |
| 50 | Kho TP | Tồn kho thành phẩm | (GWHS onhand) | frmGWHSOnhand | none | B5 |
| 51 | Sản xuất | Thống kê sản lượng hàng trắng | (tiến độ HT) | frmTienDoHangTrang4 | dq | B6 |
| 52 | Sản xuất | Thống kê sản lượng hoàn thiện | (sơn/đóng gói) | frmThongKeSoLuongAdd2 | dq | B6 |
| 53 | Sản xuất | Theo dõi sản lượng theo ngày | ds_trangthai_sanxuat | frmTienDoSanXuat | dq | B6 |
| 54 | Sản xuất | Báo cáo hàng lỗi | ds_baocao_hangloi | frmNhapHangLoi3 | dq | B6 |
| 55 | Sản xuất | BC sản phẩm không phù hợp | (hàng lỗi tổng hợp) | frmBaoCaoHangLoi2 | none | B6 |
| 56 | Sản xuất | Báo cáo sản lượng hoàn thiện | (hoàn thiện) | frmTienDoChuyenSon2 (?) | none | B6 |
| 57 | Sản xuất | Theo dõi tiến độ hàng trắng | (công đoạn) | frmThongKeCongDoan | dq | B6 |
| 58 | Sản xuất | Phiếu bù hàng | tr_phieubu_hangtrang | frmPhieuBuHangTrang | none | B6 |
| 59 | Hàng lỗi | Khai báo danh sách lỗi | tr_danhmuc_loi | frmDanhMucLoiAdd | dq | B7 |
| 60 | Hàng lỗi | Báo cáo kiểm tra chất lượng | ds_tieuchuan_chatluong | frmBaoCaoKiemTraChatLuong | dq | B7 |
| 61 | Định phôi | Danh sách đơn hàng trắng | tr_kehoach_hangtrang | frmKeHoachHangTrang* | dq(?) | B8 |
| 62 | Định phôi | Tổng hợp chi tiết | (INV137) | frmINV137 | none | B8 |
| 63 | Định phôi | Thống kê phôi đầu vào | (INV140) | frmINV140 | none | B8 |
| 64 | Định phôi | Tồn kho phôi | (INV145/134) | frmINV145 | none | B8 |
| 65 | Định phôi | Tạo phiếu pallet | ds_pallet | frmTaoPhieuPallet | dq | B8 |
| 66 | TM gỗ | Danh mục (KH/NCC/Kho/Nguồn gốc) | tr_banhanggo_* | frm_banhanggo_* | dq(g1020) | B9 |
| 67 | TM gỗ | Phiếu yêu cầu gia công | (banhanggo) | frm_banhanggo_PhieuGiaCong | none | B9 |
| 68 | TM gỗ | Phiếu trả hàng bán | (banhanggo) | frm_banhanggo_Phieutrahang_ver2 | none | B9 |
| 69 | TM gỗ | Phiếu đổi hàng | (banhanggo) | frm_banhanggo_Phieudoihang_ver2 | none | B9 |
| 70 | TM gỗ | Danh sách đề xuất phôi | ds_dexuat_phoi | frm_banhanggo_DanhSachDeXuatPhoi | dq | B9 |
| 71 | TM gỗ | Danh sách đề xuất ván | (de_xuat_van) | frm_DeXuatVan | dq | B9 |
| 72 | TM gỗ | Nhập tồn kho gỗ | tr_tonkho_govan | frmTonKhoGoVan / frmNhapXuatGovan | dq | B9 |
| 73 | TM gỗ | Danh sách đơn hàng | (banhanggo donhang) | frm_banhanggo_Danhsachdonhang | dq | B9 |
| 74 | TM gỗ | Thống kê bán hàng | (banhanggo tonghop) | frm_banhanggo_baocaotonghop | none | B9 |
| 75 | Kế toán | Các khoản thu chi | (KT110) | frmKT110 | none | B10 |
| 76 | Kế toán | Tổng hợp đề nghị thanh toán | ds_de_nghi_thanh_toan | frm_denghi_thanhtoan_tonghop | dq | B10 |

**Tổng cần dựng: ~36 form** (R18,20–23,27–28,39–41,43–76 trừ R19/R37). Batch B1→B10.

## Thứ tự thực thi

1. **Verify Anh Thiện** (Task #2) — read-only, ưu tiên (yêu cầu chính của user).
2. **Pilot Group B**: B6 (báo cáo/thống kê read-only — wire DS sẵn, ít/không cần proc) → chứng minh quy trình.
3. Sau review pilot OK → chạy tuần tự các batch còn lại, mỗi batch 1 Sonnet sub-agent, orchestrator review từng batch.
4. Sau khi review toàn bộ → gom danh sách `menu_link_pages` (publish) + báo user.

## Tiến độ (cập nhật dần)

**Verify Anh Thiện (xong)** — cả 4 trang LỆCH NHẸ, đề xuất sửa (chưa áp dụng — chờ user vì là trang live):
- Gỗ ván `d7c566`: thiếu cột `manl`/`tennl`; thiếu nút Phát hành (cần proc `trMesQuytrinhSanphamPhathanh` — chưa có) + Import.
- Ngũ kim `e69c33`: ~~BUG nhãn ngược `dvt`↔`quycach`~~ → **ĐÃ FIX** (page_wire_datasource merge dvt→ĐVT, quycach→Quy cách; config trang, hiệu lực ngay, không redeploy). CÒN thiếu cột `slchet`/`slroi`/`nhom`/`bophan_sudung` (chưa thêm).
- Đóng gói `7bd5a6`: **ĐÃ thêm cột** nhom/dai/rong/cao/khoiluong/`cbm` (setFields 14 cột, config-only, hiệu lực ngay). ⚠ ĐÍNH CHÍNH verify: `hwforww/hwforpacking/hwforai`/`mausac`/`masp_mausac` **KHÔNG tồn tại trên entity tr_dinhmuc_donggoi** — 3 cờ cấp phát là của NGŨ KIM (trang ngũ kim đã hiển thị sẵn), không phải đóng gói. CÒN: nút Phát hành (cần proc, nhóm Anh Thiện = verify-only trừ khi user gỡ).
- LCP `a04524f0`: ĐẠT phần lớn; **thiếu wire nút "Xuất kho/Cấp phát"** (proc `trXuatkhoCapphat` đã có, chưa gắn rowAction panelB); thiếu cột `range`, In/Export, SONTRONG(chủ ý bỏ).

**Group B — draft đã tạo (published=false):**
| R | Trang | id | DS | Ghi chú proc còn thiếu |
|---|---|---|---|---|
| 54 | bao_cao_hang_loi_a3f7c2 | 3ec56f82 | ds_baocao_hangloi | Duyệt hàng lỗi, Tạo&in pallet card |
| 53 | theo_doi_san_luong_ngay_40c7f9 | 3328566a | ds_trangthai_sanxuat | Pivot theo ngày×công đoạn×khung giờ (proc) |
| 45 | ton_kho_vat_tu_e998be | 49b7ce2b | ds_tonkho_sum_material | Tồn đầu/cuối kỳ (proc), Import/Export |
| 60 | bao_cao_kiem_tra_chat_luong_e7eaa6 | 91a7077c | ds_tieuchuan_chatluong | In/Export, Import định phôi (proc) |

**Mẫu chuẩn (truyền cho sub-agent đợt sau)**: page id `3ec56f82-...` (pilot — list+DS+filter+actions).

**Pattern phát hiện**: hầu hết form có phần ĐỌC (list/report) làm được config-only; phần GHI (Duyệt/Tạo phiếu/Xuất kho/In/Export) cần **proc Tier D = phase code+deploy riêng** (user phải redeploy+cutover). Draft dựng phần đọc trước, ghi chú nút cần proc.

### KẾT QUẢ CUỐI Group B (1 lượt quét xong, 2026-06-25)

**37 draft đã tạo (published=false, an toàn)** — đã verify batch: 0 trang rỗng, 0 publish, content hợp lệ.
R18 `danh_muc_de_xuat_bcf8ef` · R20 `bao_cao_final_3ec56f` · R21 `duyet_don_hang_a36b0d` · R22 `duyet_don_dat_hang_7739ee` · R23 `duyet_bao_gia_vat_tu_df43f6` · R27 `bao_gia_hoan_thien_79b70e` · R28 `danh_sach_bao_gia_05be6e` · R39 `tao_bao_gia_vat_tu_ba388f` · R40 `quan_ly_don_gia_3f5011` · R43 `phieu_nhap_kho_vat_tu_0fe673` · R44 `phieu_xuat_kho_vat_tu_96af03` · R45 `ton_kho_vat_tu_e998be` · R46 `thong_ke_nhap_xuat_vat_tu_b7f3c1` · R47 `phieu_giao_thanh_pham_5b4131` · R48 `nhap_kho_thanh_pham_ef3c73` · R49 `xuat_kho_thanh_pham_80b6ae` · R50 `ton_kho_thanh_pham_ef3c73` · R51 `thong_ke_san_luong_hang_trang_40c7f9` · R52 `thong_ke_san_luong_hoan_thien_4f8e12` · R53 `theo_doi_san_luong_ngay_40c7f9` · R54 `bao_cao_hang_loi_a3f7c2` · R55 `bao_cao_san_pham_khong_phu_hop_767a5a` · R56 `bao_cao_san_luong_hoan_thien_40c7f9` · R57 `theo_doi_tien_do_hang_trang_3e1f9a` · R58 `phieu_bu_hang_432578` · R59 `khai_bao_danh_sach_loi_8e5102` · R60 `bao_cao_kiem_tra_chat_luong_e7eaa6` · R61 `danh_sach_don_hang_trang_d38a6b` · R62 `tong_hop_chi_tiet_inv137_d401c6` · R63 `thong_ke_phoi_dau_vao_8e96e4` · R64 `ton_kho_phoi_inv145_d9555d` · R65 `tao_phieu_pallet_1c6552` · R66 `danh_muc_thuong_mai_go_3d8b7f` · R70 `danh_sach_de_xuat_phoi_ca4239` · R71 `danh_sach_de_xuat_van_4f9a2c` · R75 `cac_khoan_thu_chi_b80251` · R76 `tong_hop_de_nghi_thanh_toan_b04f1a`.

**7 form BỊ CHẶN (bảng nguồn chưa migrate vào ERP — cần full-import trước)**:
- R41 Chứng chỉ gỗ ván — `tr_chungchi_govan_savefile`.
- R67 Phiếu yêu cầu gia công — `bg_phieugiacong`.
- R68 Phiếu trả hàng bán / R69 Phiếu đổi hàng — `bg_donhang_chitiet_doitra` (+ `bg_donhang` head).
- R72 Nhập tồn kho gỗ — `bg_xuatnhapgo`.
- R73 Danh sách đơn hàng (TM gỗ) — `bg_donhang`.
- R74 Thống kê bán hàng — proc MSSQL `bg_THONGKE_BANHANG` (cần entity/DS hoặc DS groupBy).
- R66 thiếu 2 tab Kho/Nguồn gốc gỗ — `bg_kho`, `bg_nguongocgo`.

**2 skip** (đã có trang dựng tay thật): R19 `phieu_giao_nhan_hang_336b68`, R37 `danh_sach_don_dat_hang_9d5610`.

### ĐÃ PUBLISH + LINK MENU (2026-06-25)

**32 trang đã publish + link menu** (`menu_link_pages publish=true`, port_status='xong'): R18→I1113, R20→I1347, R21→I1156+I1157, R22→I1032, R23→I1107, R27→I111, R28→I120, R39→I1106, R40→I118, R43→I1291, R44→I1039, R45→I1189, R47→I1354, R48→I70, R49→I96, R51→I1331, R52→I1333, R53→I1361, R54→I1087, R55→I1238, R56→I1363, R57→I1089, R58→I1149, R59→I1258, R60→I1280, R63→I1067, **R64→I1316** (đã rewire sang entity đúng `dqt_pallet_chitiet`), R65→I1266, R70→I1216, R71→I1232, R75→I1147, R76→I1257. Skeleton dq_* cũ ở các node thay-thế giờ MỒ CÔI (vẫn published, không còn trong menu) — có thể xoá/ẩn sau.

**Smoke-test render (prod, admin)**: ĐÃ kiểm 4 trang OK — Tồn kho vật tư, Duyệt đơn hàng (nút Duyệt update-fields), Báo cáo hàng lỗi (nút Thêm), Tồn kho phôi (R64). Render đủ cột Việt + dữ liệu thật + filter + nút + phân trang, KHÔNG lỗi console.

**5 trang HOLD còn lại (CHƯA publish — blocked, KHÔNG sửa config-only được)**:
- R46 Thống kê nhập-xuất — cần **proc pivot** `TR_NHAPXUAT_GETLIST` (báo cáo N-X theo ngày). Draft hiện chỉ list phiếu nhập.
- R50 Tồn kho thành phẩm — cần **proc/view tồn** (nhập−xuất). Draft hiện hiện *nhập* TP.
- R62 Tổng hợp chi tiết — cần **proc** `DQT_TONGHOP_CHITIET`. Draft placeholder tr_pallet.
- R61 Danh sách đơn hàng trắng — **KHÔNG có node menu rõ**; dữ liệu trùng các trang "Kế hoạch hàng trắng" đã có → cần user làm rõ ý định.
- R66 Danh mục TM gỗ — "Danh mục" là **nhóm menu G1186** (KH/NCC đã có trang riêng; Nguồn gốc gỗ I1203 + Kho cần migrate `bg_nguongocgo`/`bg_kho`). Trang tabs draft không khớp cấu trúc → bỏ/để lại.

### PHASE 3 — Widget `report` (read-proc → lưới) + 2 proc báo cáo (2026-06-26)

**Phát hiện kiến trúc (quan trọng)**: framework KHÔNG render output proc ra lưới
(list chỉ nạp entity/dataSource; DS không groupBy server-side; chart/pivot/kpi
aggregate CLIENT-side trên window ≤10k). R53 "pivot theo proc" thực ra chỉ là list
phẳng + filter. → Dựng **widget mới `report`** (nguồn = read-proc Tier D) để mọi báo
cáo aggregate-server-side về sau dùng lại.

**ĐÃ LÀM (code, chưa deploy):**
- `src/components/renderer/widgets/report-widget.tsx` — widget `report`: thanh filter
  (date/select/text, token `$firstOfMonth`/`$lastOfMonth`/`$today`), gọi
  `procs.invokeModule(procName,args)` → render DataGrid client-side (sort/lọc/phân
  trang/xuất). Dispatch ở `ConsumerPage.tsx` (`kind==="report"`). typecheck+lint xanh.
- `packages/plugins/module-ui_procs/material_inout.ts` → `materialInout(makho,tungay,denngay)`
  — port **MATERIAL_INOUT** (R46): UNION nhập (tr_ctphieunhap×tr_phieunhap) + xuất
  (tr_ctphieuxuat×tr_phieuxuat) theo kho+kỳ, GROUP BY gộp, INNER JOIN tr_material theo
  `mavt/mact = idxuong`, LEFT tr_reftype. Batch-stitch (proc-table không qualify JOIN).
- `packages/plugins/module-ui_procs/dqt_tonghop_chitiet.ts` → `dqtTonghopChitiet(maddh,mode)`
  — port **DQT_TONGHOP_DONHANG_GET/GET2/GET3** (R62) gộp 3 mode: 0=theo chi tiết (gộp
  toàn đơn +rong_sc/dai_sc/tilehaohut/congdaiphoi), 1=theo SP (maddh+mã HT), 2=chi tiết
  đầy đủ (không gộp +tensp+ghichu). 6 bảng batch-stitch.
- **Validate logic trên dữ liệu PROD** qua `migration_query_readonly`: R46 join
  `mavt=idxuong` khớp 100% (NKI 11/2025 ~1600 dòng N-X); R62 maddh DQHF12/0620 → 654 đm
  /36 masp → ~2085 dòng. Logic chuẩn.
- **Config 2 trang lưu sẵn** ở `docs/phase3-report-pages.json` (widget report + cột Việt).
  R46 page `fd09fa9b…` (thong_ke_nhap_xuat_vat_tu_b7f3c1) · R62 page `7e8cb0b3…`
  (tong_hop_chi_tiet_inv137_d401c6) — CHƯA đẩy (config-before-code: phải redeploy trước).

**R50 Tồn kho TP — KHÔNG phải proc**: proc gốc `TR_TONKHO_THANHPHAM_GetAll` chỉ
SELECT từ **bảng tồn lưu sẵn** `tr_tonkho_thanhpham` (join sanpham+order) — nhưng bảng
này **CHƯA migrate** vào ERP → blocked như 7 form Phase 4. Cần full-import
`tr_tonkho_thanhpham` rồi wire **DS list** (không cần proc/report widget).

**HOÀN TẤT Phase 3 trên prod (2026-06-26):**
1. ✅ Coolify redeploy XONG — verify 2 proc chạy thật (migration_invoke_module_proc):
   `materialInout` NKI/11 → 96 dòng; `dqtTonghopChitiet` DQHF12/0620 → 603 dòng.
2. ✅ Đẩy config 2 trang (page_create_draft theo id, overwrite). ⚠ overwrite-by-id
   CHUẨN HOÁ tên theo `<base>_<6hex id>` khi trùng tên → R46 đổi `_b7f3c1`→`_fd09fa`.
3. ✅ Smoke-test render R46 (DOM): widget `report` deploy + nhận diện; filter bar (Kho
   7 lựa chọn + 2 date + nút Xem) + DataGrid 15 cột + export + phân trang đầy đủ.
   (Screenshot freeze do browser-extension, không phải lỗi trang.)
4. ✅ **PUBLISH + LINK MENU**: R46 → **I95** "Thống kê nhập xuất" (frmListMaterialInOut);
   R62 → **I1059** "Tổng hợp chi tiết" (frmINV137). `menu_link_pages publish=true`,
   linkedNodes=2. **2 trang LIVE trên prod.**

**R50 Tồn kho TP — DONE LIVE (2026-06-26, DataSource-first, KHÔNG redeploy):**
- ✅ full_import table-tier bảng `tr_tonkho_thanhpham` (job 019f015a, **6625 dòng, reconcile ok**;
  PK=id int, 13 cột). Schema dump bằng `dump-columns.ts`. ⚠ worker queued lâu → `migration_resume_full_job` kích.
- ✅ DataSource `ds_tonkho_thanhpham` (019f015f): base tồn + LEFT join `tr_sanpham`
  (product_code→masp: tensp/tensp_vn/masp_khachhang/sothung_carton) + LEFT join `tr_order`
  (order_number→order_number: f_cancelled/finished). `datasource_preview` xác nhận 6625 dòng, 0 null.
- ✅ Trang `ton_kho_thanh_pham_ef3c73` (4193111d) list widget + DS, cột Việt + filter đơn/mã SP/tên SP.
- ✅ PUBLISH + LINK MENU node **I22** "Tồn kho thành phẩm" (frmGWHSOnhand).
- ⚠ **Lệch chủ ý**: proc gốc lọc cứng `cancelled='N' AND Finished=0`, nhưng TẤT CẢ 6625 dòng tồn
  map order finished=true → áp filter cứng = báo cáo RỖNG. Đổi cancelled/finished thành CỘT hiển thị
  (không lọc cứng) để báo cáo hữu dụng.

**R66 Danh mục TM gỗ — DONE LIVE (2026-06-26):** nhóm menu G1186 "Danh mục" có 4
mục lá. KH (I1201) + NCC (I1200) đã có trang sẵn. Dựng mới + PUBLISH + LINK 2 mục
thiếu (bảng `bg_kho`/`bg_nguongocgo` đã migrate table-tier, sync=null ghi được):
- **I1202 "Danh sách kho"** → trang `danh_sach_kho_tmgo` (d1c9cc4d), list CRUD
  (makho/tenkho/diachi), 3 dòng.
- **I1203 "Danh sách nguồn gốc gỗ"** → trang `danh_sach_nguon_goc_go` (a3abd016),
  list CRUD (tennguongoc), 21 dòng.
Draft tabbed `danh_muc_thuong_mai_go` cũ thừa (4 mục là node lá riêng) → mồ côi, bỏ.

**CÒN LẠI (cần user quyết):**
- **R61 Danh sách đơn hàng trắng** (`frmKeHoachHangTrang*`): ĐÃ có ≥3 trang "Kế hoạch
  hàng trắng" linked (I72→1d4eab00, I1360→6c875959, I1084→351731ea); node I1351 "Kế hoạch
  đơn hàng trắng Ver2" còn trống. R61 nhiều khả năng TRÙNG → chờ user xác nhận nên bỏ
  (trùng) hay dựng riêng cho node I1351.
- R62 nice-to-have: thay ô maddh text bằng order-picker (LookupPicker) thay vì gõ tay.
- Anh Thiện (4 gap config) + cutover các entity mirror để nút GHI ghi thật.

### WIRING proc Tier D (phase "wire trước, viết sau" — 2026-06-25)

**Phát hiện**: đã có **147 proc Tier D** ở `packages/plugins/module-ui_procs/` (auto-load qua `module-procs.ts`, không manifest). Nhiều nút GHI "thiếu" chỉ cần WIRE proc sẵn (config), KHÔNG viết mới.

**Cơ chế binding rowAction→proc** (`list-widgets.tsx` `bindRowIdToAction`): step `invoke-module-proc` được framework TỰ inject `_id = {source:const, value: row.id}` (uuid VẬT LÝ dòng). ⚠ `_id` ≠ field nghiệp vụ "id"/"report_id" (GUID nguồn text) → proc phải match **cột `id` vật lý**: `sql\`id = ${args._id}::uuid\`` (như `tr_lenhcapphat_head_delete`), KHÔNG `t.text("id")`. Step config: `{kind:"invoke-module-proc", procName:"<camelCase>", args:{khác:"$currentUser"/"$now"/binding}}` — `_id` tự có.

**Đã wire 5 trang** (overwrite live + rowAction):
- R54 `bao_cao_hang_loi_a3f7c2` Duyệt→trBaocaoHangloiDuyet; R20 `bao_cao_final_3ec56f` Duyệt→trBaocaoFinalDuyet; R76 `tong_hop_de_nghi_thanh_toan_b04f1a` Duyệt+Huỷ duyệt→trDenghiThanhtoan Duyet/Huyduyet.
- R47 `phieu_giao_thanh_pham_5b4131` Xác nhận→trPhieugiaoThanhphamChitietXacnhan; R71 `danh_sach_de_xuat_van_4f9a2c` Duyệt→trPhieuyeucauConfirm + Huỷ→trPhieuyeucauCancel.

**Đã wire thêm**: R47 Xác nhận phiếu giao TP; R71 Duyệt/Huỷ đề xuất ván; **R44 Huỷ phiếu xuất** + **R43 Huỷ phiếu nhập** (nút "Huỷ phiếu" active=false → trPhieuxuat/phieunhap_updatestatus). Tổng **7 trang** đã wire nút GHI nghiệp vụ.

**ĐÃ SỬA + COMMIT + PUSH 8 proc** nhận `_id` (match cột id vật lý; proc cascade theo business-key thì tra dòng theo id vật lý rồi chạy logic cũ):
- `75595e8` — 4 proc duyệt (R54/R20/R76).
- `a4a8b31`/`e42fafd` — trPhieugiaoThanhphamChitietXacnhan, trPhieuyeucauConfirm, trPhieuyeucauCancel (R47/R71).
- `71d5bd9` — trPhieuxuat_updatestatus, trPhieunhap_updatestatus (R43/R44).
Đã **push lên origin/main** (typecheck pre-push OK; CI chạy test+e2e). ⚠ **CẦN COOLIFY REDEPLOY** thì các nút mới chạy trên prod (config trang đã đẩy sẵn).

**Báo giá**: KHÔNG cần wire proc — R27/R28/R39 đã có CRUD built-in (Thêm/Sửa/Xoá = create/update/delete-record, tự dùng `_id`). `tr_baogia_delete2` (xoá theo masp+baogiaid ở 7 bảng chi tiết) là thao tác của editor báo giá, không map dòng list hiện tại → để dành.

**Wire CÒN LẠI**: R58 phiếu bù (`pb_chitiet_phieubuhang_updatesl` cần ô nhập số lượng → wizard, không 1-click); R40 sửa/xoá đơn giá (entity `tr_material` **mirror** → chờ cutover mới ghi được). CRUD đơn (Thêm/Sửa/Xoá) các danh mục đã wire sẵn built-in lúc dựng trang.

3. **Phase proc Tier D + deploy** (cần user): port các proc GHI/pivot còn thiếu (Phát hành định mức, Xuất kho cấp phát, Duyệt phức tạp, Tạo phiếu nhập/xuất/pallet, các báo cáo pivot N-X/tiến độ/tổng hợp), redeploy + cutover các entity mirror (`tr_material`, `tr_pallet`, `dqt_thongke_phoi`...).
4. **Phase migrate bảng**: full-import `bg_*` (thương mại gỗ) + `tr_chungchi_govan_savefile` → mở khoá 7 form bị chặn.
5. **Sửa Anh Thiện** (config-only, làm trên DEV rồi sync — KHÔNG sửa thẳng prod live): ngũ kim nhãn ngược `dvt`↔`quycach`; đóng gói +3 cờ cấp phát; gỗ ván +manl/tennl; LCP wire nút Xuất kho.

## Playbook 1 sub-agent (1 form / 1 batch)

INPUT: mục sheet2 (nhãn, bảng, ghi chú) + form DQHF + module forms.yaml + DS gợi ý.
DO (read-only trừ page_create_draft):
1. Đọc block form trong `migration-plan/ui/<module>.forms.yaml` (grid columns, buttons, procs). Nếu thiếu → grep `D:/code/DotNET/DQHF/DQHFDotNet/DQHF/**/<form>.cs` + `.Designer.cs`.
2. Chọn DataSource khớp bảng chính (MCP `datasource_list` đã có; nếu thiếu field → `entity_get`).
3. Soạn `content` PageComponent[]: list widget (fields theo grid DQHF, columnLabels Việt) + rowActions/embeddedActions ánh xạ nút ribbon. Nút cần proc chưa có → ghi chú, KHÔNG bịa.
4. `page_create_draft` (published=false, name `<slug>_<6hex>`); rồi `page_wire_datasource` (dryRun=false) nếu dùng DS.
5. REPORT: pageName+id, DS dùng, bảng cột map, nút → step, proc còn thiếu, điểm chưa chắc.
