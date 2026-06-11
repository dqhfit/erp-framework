-- PARAMS:
-- @id_hangmuc int
-- @tigia float
-- @masp nvarchar


CREATE   PROC [dbo].[TINHGIA_HANGMUC_SANPHAM]
(
	@id_hangmuc int,
	@tigia float = 25400,
	@masp nvarchar(200)
)
AS
BEGIN
DECLARE @chiphi1 decimal(18, 2);
DECLARE @chiphi2 decimal(18, 2);
DECLARE @ghichu nvarchar(max);
DECLARE @m3_tc decimal(18, 5);
DECLARE @dongia_sanpham decimal(18, 5);

-- TÍNH TỔNG SỐ LƯỢNG, SỐ KHỐI XUẤT ĐI TRONG 6 THÁNG
DECLARE @currentDate date;
SET @currentDate = GETDATE(); 
--SET @currentDate = DATEADD(M, -1, GETDATE()); -- KHÔNG TÍNH THÁNG HIỆN TẠI

DECLARE @prev_Date date = DATEADD(M, -6, @currentDate);
DECLARE @firstDayOfMonth date = DATEFROMPARTS(YEAR(@prev_Date), MONTH(@prev_Date), 1);
DECLARE @lastDayOfMonth date = EOMONTH(@currentDate);

DECLARE @tongsokhoi_xuat decimal(18, 5) = 0
DECLARE @tongsoluong_xuat int = 0
DECLARE @tienluong_khac decimal(18, 2);
DECLARE @bhxh_congdoan_khac decimal(18, 2);
DECLARE @luongthang13_khac decimal(18, 2);

DECLARE @tongsokhoi_hoanthanh_dp decimal(18, 5) = 0;
DECLARE @tongsokhoi_hoanthanh_dh decimal(18, 5) = 0;
DECLARE @tongsokhoi_hoanthanh_tp decimal(18, 5) = 0;
BEGIN TRY
	--EXEC TR_TONGHOP_THANHPHAM_XUAT2 @firstDayOfMonth, @lastDayOfMonth, @tongsokhoi_xuat OUTPUT, @tongsoluong_xuat OUTPUT;
	
	SELECT @tienluong_khac = SUM(tienluong)/3, @bhxh_congdoan_khac = SUM(bhxh_congdoan)/3, @luongthang13_khac = (SUM(tienluong)/3)/12
	FROM tr_chiphi_nhancong
	WHERE bophan IN (N'Bảo trì', N'QC', N'THỜI VỤ') AND ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	-- TỔNG SỐ KHỐI HOÀN THÀNH ĐỒNG BỘ PHÔI
	SELECT @tongsokhoi_hoanthanh_dp = SUM(sokhoi) FROM tr_trangthai_sanxuat
	WHERE congdoan = 'DP09-PROD'
		AND ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	-- TỔNG SỐ KHỐI SƠN LÊN CHUYỀN
	SELECT @tongsokhoi_hoanthanh_tp = SUM(A.SOLUONG * B.m3_tc)
	FROM tr_thongke_soluong A
		INNER JOIN tr_sanpham B ON A.MASP = B.masp
	WHERE A.BOPHAN IN ('SON', 'DGO') AND A.NGAYNHAP BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	-- tổng số khối, số lượng đóng gói
	SELECT @tongsokhoi_xuat = SUM(A.SOLUONG * B.m3_tc), @tongsoluong_xuat = SUM(A.SOLUONG)
	FROM tr_thongke_soluong A
		INNER JOIN tr_sanpham B ON A.MASP = B.masp
	WHERE A.BOPHAN IN ('DGO') AND A.NGAYNHAP BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	-- TỔNG SỐ KHỐI HOÀN THÀNH ĐỒNG BỘ ĐỊNH HÌNH 1
	SELECT @tongsokhoi_hoanthanh_dh = SUM(sokhoi) FROM tr_trangthai_sanxuat
	WHERE congdoan = 'DH06-PROD'
		AND ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth
END TRY
BEGIN CATCH
	SET @tongsokhoi_xuat = 0;
	SET @tongsoluong_xuat = 0;

	SET @tienluong_khac = 0;
	SET @bhxh_congdoan_khac = 0;
	SET @luongthang13_khac = 0;
END CATCH

SELECT @m3_tc = m3_tc,
	@dongia_sanpham = dongia
FROM tr_sanpham WHERE masp = @masp
IF @m3_tc IS NULL
BEGIN
	SET @m3_tc = 0;
END

IF @id_hangmuc = 4
BEGIN
	-- Phí nhập khẩu, xuất khẩu
	DECLARE @phixuatcont decimal(18, 2)
	SELECT @phixuatcont = giatri FROM tr_hangmuc_chiphi WHERE id = @id_hangmuc

	SET @chiphi2 = (@phixuatcont / 68);
	SET @chiphi2 = @chiphi2 + (@chiphi2 * 0.12)
	--SET @chiphi1 = (@phixuatcont / 68) * @m3_tc;
	SET @chiphi1 = @chiphi2 * @m3_tc;
	
	SET @ghichu = CONCAT('CP 1 SP = ', N'([CP xuất cont 1 khối(' + FORMAT(@chiphi2, '#,0.##') + N')] + 12%) x [Số khối TC (' + FORMAT(@m3_tc, '#,0.####') + ')]');
END
ELSE IF @id_hangmuc = 5
BEGIN
	-- PHÍ QUẢN LÝ CÔNG TY
	SET @chiphi1 = (@dongia_sanpham * @tigia) * 0.02;
	SET @chiphi2 = IIF(@m3_tc = 0, 0, (@chiphi1) / @m3_tc);
	
	SET @ghichu = CONCAT('CP 1 SP = ', N'[Giá bán] x 2%');
END
ELSE IF @id_hangmuc = 6
BEGIN
	-- PHÍ QUẢN LÝ XƯỞNG = 5% chi phí nhân công
	DECLARE @chiphinhancong decimal(18, 2);
	SELECT @chiphinhancong = SUM(tienluong + bhxh_congdoan + luongthang_13) FROM tr_chiphi_nhancong
	WHERE ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_xuat = 0, 0, @chiphinhancong / @tongsokhoi_xuat) * 0.05;
	SET @chiphi1 = @chiphi2 * @m3_tc;

	SET @ghichu = CONCAT('CP 1 SP = ', N'([Tổng chi phí nhân công 6 tháng] / [Tổng khối TC 6 tháng đã xuất (' + FORMAT(@tongsokhoi_xuat, '#,0.####') + N')]) * 5% * [Số khối TC 1 SP]');
END
ELSE IF @id_hangmuc = 7
BEGIN
	-- Hoa hồng
	SET @chiphi1 = (@dongia_sanpham * @tigia) * 0.02;
	SET @chiphi2 = IIF(@m3_tc = 0, 0, (@chiphi1) / @m3_tc);

	SET @ghichu = CONCAT('CP 1 SP = ', N'[Giá bán] x 2%');
END
ELSE IF @id_hangmuc = 8
BEGIN
	-- Phí claim
	SET @chiphi1 = (@dongia_sanpham * @tigia) * 0.015;
	SET @chiphi2 = IIF(@m3_tc = 0, 0, (@chiphi1) / @m3_tc);

	SET @ghichu = CONCAT('CP 1 SP = ', N'[Giá bán] x 1.5%');
END
ELSE IF @id_hangmuc = 9
BEGIN
	-- Phí khác
	SET @chiphi1 = (@dongia_sanpham * @tigia) * 0.01;
	SET @chiphi2 = IIF(@m3_tc = 0, 0, (@chiphi1) / @m3_tc);

	SET @ghichu = CONCAT('CP 1 SP = ', N'[Giá bán] x 1%');
END
ELSE IF @id_hangmuc = 10
BEGIN
	-- GỖ VÁN
	DECLARE @tongdongia_vnd decimal(18, 2)
	DECLARE @tongkhoitinhche decimal(18, 5)
	EXEC TINHGIA_NGUYENLIEU_GVA @masp, @tigia, @tongdongia_vnd OUTPUT, @tongkhoitinhche OUTPUT;

	SET @chiphi1 = @tongdongia_vnd;
	SET @chiphi2 = IIF(@tongkhoitinhche = 0, 0, @tongdongia_vnd / @tongkhoitinhche);

	SET @ghichu = CONCAT('CP 1 SP = ', N'SUM([Số khối NL theo định mức] * [Đơn giá nguyên liệu]); [Đơn giá NL] lấy theo chi phí nguyên liệu trong báo giá hoàn thiện');
	
END
ELSE IF @id_hangmuc = 15
BEGIN
	-- KHẤU HAO MÁY MÓC, NHÀ XƯỞNG
	DECLARE @maymoc_nhaxuong decimal(18, 2);
	SELECT @maymoc_nhaxuong = SUM(maymoc_nhaxuong) 
	FROM tr_chiphi_khauhao
	WHERE ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_xuat = 0, 0, @maymoc_nhaxuong / @tongsokhoi_xuat);
	SET @chiphi1 = @chiphi2 * @m3_tc;

	SET @ghichu = N'CP 1 SP = ([Tổng chi phí 6 tháng (' + FORMAT(@maymoc_nhaxuong, 'N00') + N')] / [Tổng số khối TC xuất trong 6 tháng (' + FORMAT(@tongsokhoi_xuat, '#,0.####') + N')]) * [Số khối TC 1 SP]';
END
ELSE IF @id_hangmuc = 16
BEGIN
	-- CCDC, sửa chữa
	DECLARE @suachua decimal(18, 2);
	SELECT @suachua = SUM(suachua) FROM tr_chiphi_khauhao
	WHERE ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_xuat = 0, 0, @suachua / @tongsokhoi_xuat);
	SET @chiphi1 = @chiphi2 * @m3_tc;

	SET @ghichu = N'CP 1 SP = ([Tổng chi phí 6 tháng (' + FORMAT(@suachua, 'N00') + N')] / [Tổng số khối TC xuất trong 6 tháng (' + FORMAT(@tongsokhoi_xuat, '#,0.####') + N')]) * [Số khối TC 1 SP]';
	
END
ELSE IF @id_hangmuc = 17
BEGIN
	-- BẢO HIỂM TÀI SẢN
	DECLARE @baohiem decimal(18, 2);
	SELECT @baohiem = SUM(baohiem_taisan) FROM tr_chiphi_khauhao
	WHERE ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_xuat = 0, 0, @baohiem / @tongsokhoi_xuat);
	SET @chiphi1 = @chiphi2 * @m3_tc;

	SET @ghichu = N'CP 1 SP = ([Tổng chi phí 6 tháng (' + FORMAT(@baohiem, 'N00') + N')] / [Tổng số khối TC xuất trong 6 tháng (' + FORMAT(@tongsokhoi_xuat, '#,0.####') + N')]) * [Số khối TC 1 SP]';
	
END
ELSE IF @id_hangmuc = 18
BEGIN
	-- khấu hao nhân công phôi - tiền lương
	DECLARE @tienluong_dp decimal(18, 2);
	SELECT @tienluong_dp = SUM(tienluong)
	FROM tr_chiphi_nhancong
	WHERE bophan IN (N'Phôi') AND ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_hoanthanh_dp = 0, 0, (@tienluong_dp+@tienluong_khac) / @tongsokhoi_hoanthanh_dp);
	SET @chiphi1 = @chiphi2 * @m3_tc;
	
	SET @ghichu = N'CP 1 SP = ([Tổng chi phí Phôi 6 tháng] / [Tổng số khối hoàn thành đồng bộ phôi trong 6 tháng]) * [Số khối TC 1 SP]';
END
ELSE IF @id_hangmuc = 19
BEGIN
	-- khấu hao nhân công phôi - BHXH + Công đoàn
	DECLARE @bhxh_congdoan_dp decimal(18, 2);
	SELECT @bhxh_congdoan_dp = SUM(bhxh_congdoan) FROM tr_chiphi_nhancong
	WHERE bophan IN (N'Phôi') AND ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_hoanthanh_dp = 0, 0, (@bhxh_congdoan_dp+@bhxh_congdoan_khac) / @tongsokhoi_hoanthanh_dp);
	SET @chiphi1 = @chiphi2 * @m3_tc;
	
	SET @ghichu = N'CP 1 SP = ([Tổng chi phí Phôi 6 tháng] / [Tổng số khối hoàn thành đồng bộ phôi trong 6 tháng]) * [Số khối TC 1 SP]';
END
ELSE IF @id_hangmuc = 20
BEGIN
	-- khấu hao nhân công phôi - lương tháng 13
	DECLARE @luongthanh13_dp decimal(18, 2);
	SELECT @luongthanh13_dp = SUM(tienluong)/12 FROM tr_chiphi_nhancong
	WHERE bophan IN (N'Phôi') AND ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_hoanthanh_dp = 0, 0, (@luongthanh13_dp+@luongthang13_khac) / @tongsokhoi_hoanthanh_dp);
	SET @chiphi1 = @chiphi2 * @m3_tc;
	
	--SET @ghichu = N'CP 1 SP = ([Tổng chi phí Phôi 6 tháng] / [Tổng số khối hoàn thành đồng bộ phôi trong 6 tháng]) * [Số khối TC 1 SP]';
	SET @ghichu = N'1/12 tiền lương';
END
ELSE IF @id_hangmuc = 21
BEGIN
	-- Keo ghép, keo lắp ráp
	DECLARE @dongia_21 decimal(18, 2);
	SELECT @dongia_21 = giatri
	FROM tr_hangmuc_chiphi
	WHERE id = @id_hangmuc

	--SET @chiphi1 = @dongia_21;
	--SET @chiphi2 = IIF(@m3_tc = 0, 0, @dongia_21 / @m3_tc);

	SET @chiphi1 = @dongia_21 * @m3_tc;
	SET @chiphi2 = @dongia_21;

	SET @ghichu = N'CP 1 SP = ([Đơn giá 1 khối] * [Số khối TC 1 SP]';
END
ELSE IF @id_hangmuc = 22
BEGIN
	-- CHI PHÍ SƠN
	DECLARE @dongia_son1 decimal(18, 2);
	DECLARE @dongia_son2 decimal(18, 2);
	
	EXEC TINHGIA_NGUYENLIEU_SON @masp, @tigia, @dongia_son1 OUTPUT, @dongia_son2 OUTPUT;
	
	SET @chiphi1 = @dongia_son1;
	--SET @chiphi2 = @dongia_son2;
	IF @m3_tc > 0
	BEGIN
		SET @chiphi2 = @chiphi1 / @m3_tc;
	END

	SET @ghichu = N'CP 1 SP = ([Số lượng theo định mức] * [Mét vuông theo định mức] * [Đơn giá vật tư]';
END
ELSE IF @id_hangmuc = 23
BEGIN
	-- Keo 502, vải lau, nhám
	DECLARE @dongia_23 decimal(18, 2);
	SELECT @dongia_23 = giatri
	FROM tr_hangmuc_chiphi
	WHERE id = @id_hangmuc

	--SET @chiphi1 = @dongia_23;
	--SET @chiphi2 = IIF(@m3_tc = 0, 0, @dongia_23 / @m3_tc);

	SET @chiphi1 = @dongia_23 * @m3_tc;
	SET @chiphi2 = @dongia_23;

	SET @ghichu = N'CP 1 SP = ([Đơn giá 1 khối] * [Số khối TC 1 SP]';
END
ELSE IF @id_hangmuc = 24
BEGIN
	-- NGŨ KIM
	DECLARE @dongia_ngukim decimal(18, 2);
	EXEC TINHGIA_NGUYENLIEU_NKI @masp, @tigia, @dongia_ngukim OUTPUT;
	SET @chiphi1 = @dongia_ngukim;
	SET @chiphi2 = IIF(@m3_tc = 0, 0, @dongia_ngukim / @m3_tc);

	SET @ghichu = N'CP 1 SP = [Số lượng theo định mức] * [Đơn giá vật tư]'
END
ELSE IF @id_hangmuc = 25
BEGIN
	-- ĐÓNG GÓI
	DECLARE @dongia_donggoi decimal(18, 2);
	EXEC TINHGIA_NGUYENLIEU_DGO @masp, @tigia, @dongia_donggoi OUTPUT;
	SET @chiphi1 = @dongia_donggoi;
	SET @chiphi2 = IIF(@m3_tc = 0, 0, @dongia_donggoi / @m3_tc);

	SET @ghichu = N'CP 1 SP = [Số lượng theo định mức] * [Đơn giá vật tư]'
END
ELSE IF @id_hangmuc = 33
BEGIN
	-- khấu hao nhân công định hình - tiền lương
	DECLARE @tienluong_dh decimal(18, 2);
	SELECT @tienluong_dh = SUM(tienluong)
	FROM tr_chiphi_nhancong
	WHERE bophan IN (N'Định hình') AND ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_hoanthanh_dh = 0, 0, (@tienluong_dh+@tienluong_khac) / @tongsokhoi_hoanthanh_dh);
	SET @chiphi1 = @chiphi2 * @m3_tc;
	
	SET @ghichu = N'CP 1 SP = ([Tổng chi phí định hình 6 tháng] / [Tổng số khối hoàn thành đồng bộ định hình 1 trong 6 tháng]) * [Số khối TC 1 SP]';
END
ELSE IF @id_hangmuc = 34
BEGIN
	-- khấu hao nhân công định hình - BHXH + Công đoàn
	DECLARE @bhxh_congdoan_dh decimal(18, 2);
	SELECT @bhxh_congdoan_dh = SUM(bhxh_congdoan) FROM tr_chiphi_nhancong
	WHERE bophan IN (N'Định hình') AND ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_hoanthanh_dh = 0, 0, (@bhxh_congdoan_dh+@bhxh_congdoan_khac) / @tongsokhoi_hoanthanh_dh);
	SET @chiphi1 = @chiphi2 * @m3_tc;
	
	SET @ghichu = N'CP 1 SP = ([Tổng chi phí định hình 6 tháng] / [Tổng số khối hoàn thành đồng bộ định hình 1 trong 6 tháng]) * [Số khối TC 1 SP]';
END
ELSE IF @id_hangmuc = 35
BEGIN
	-- khấu hao nhân công định hình - lương tháng 13
	DECLARE @luongthanh13_dh decimal(18, 2);
	SELECT @luongthanh13_dh = SUM(tienluong)/12 FROM tr_chiphi_nhancong
	WHERE bophan IN (N'Định hình') AND ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_hoanthanh_dh = 0, 0, (@luongthanh13_dh+@luongthang13_khac) / @tongsokhoi_hoanthanh_dh);
	SET @chiphi1 = @chiphi2 * @m3_tc;
	
	--SET @ghichu = N'CP 1 SP = ([Tổng chi phí định hình 6 tháng] / [Tổng số khối hoàn thành đồng bộ định hình 1 trong 6 tháng]) * [Số khối TC 1 SP]';
	SET @ghichu = N'1/12 tiền lương';
END
ELSE IF @id_hangmuc = 37
BEGIN
	-- khấu hao nhân công sơn + đóng gói - tiền lương
	DECLARE @tienluong_tp decimal(18, 2);
	SELECT @tienluong_tp = SUM(tienluong)
	FROM tr_chiphi_nhancong
	WHERE bophan IN (N'Sơn', N'Thành phẩm') AND ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_hoanthanh_tp = 0, 0, (@tienluong_tp+@tienluong_khac) / @tongsokhoi_hoanthanh_tp);
	SET @chiphi1 = @chiphi2 * @m3_tc;
	
	SET @ghichu = N'CP 1 SP = ([Tổng chi phí Sơn+đóng gói 6 tháng] / [Tổng số khối SP Sơn + Đóng gói trong 6 tháng]) * [Số khối TC 1 SP]';
END
ELSE IF @id_hangmuc = 38
BEGIN
	-- khấu hao nhân công sơn + đóng gói - BHXH + Công đoàn
	DECLARE @bhxh_congdoan_tp decimal(18, 2);
	SELECT @bhxh_congdoan_tp = SUM(bhxh_congdoan) FROM tr_chiphi_nhancong
	WHERE bophan IN (N'Sơn', N'Thành phẩm') AND ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_hoanthanh_tp = 0, 0, (@bhxh_congdoan_tp+@bhxh_congdoan_khac) / @tongsokhoi_hoanthanh_tp);
	SET @chiphi1 = @chiphi2 * @m3_tc;
	
	SET @ghichu = N'CP 1 SP = ([Tổng chi phí Sơn + đóng gói 6 tháng] / [Tổng số khối SP Sơn + đóng gói trong 6 tháng]) * [Số khối TC 1 SP]';
END
ELSE IF @id_hangmuc = 39
BEGIN
	-- khấu hao nhân công sơn + đóng gói - lương tháng 13
	DECLARE @luongthanh13_tp decimal(18, 2);
	SELECT @luongthanh13_tp = SUM(tienluong)/12 FROM tr_chiphi_nhancong
	WHERE bophan IN (N'Sơn', N'Thành phẩm') AND ngaythang BETWEEN @firstDayOfMonth AND @lastDayOfMonth

	SET @chiphi2 = IIF(@tongsokhoi_hoanthanh_tp = 0, 0, (@luongthanh13_tp+@luongthang13_khac) / @tongsokhoi_hoanthanh_tp);
	SET @chiphi1 = @chiphi2 * @m3_tc;
	
	--SET @ghichu = N'CP 1 SP = ([Tổng chi phí Sơn 6 tháng] / [Tổng số khối SP Sơn trong 6 tháng]) * [Số khối TC 1 SP]';
	SET @ghichu = N'1/12 tiền lương';
END
ELSE IF @id_hangmuc = 40
BEGIN
	DECLARE @chiphi_thuexuong decimal(18, 2) = 1050000000;
	--DECLARE @sokhoi_xuat_trungbinh decimal(18, 10) = @tongsokhoi_xuat / 6;
	DECLARE @sokhoi_xuat_trungbinh decimal(18, 10) = (@tongsokhoi_hoanthanh_dp + @tongsokhoi_hoanthanh_dh + @tongsokhoi_hoanthanh_tp) / 6;

	SET @chiphi2 = IIF(@sokhoi_xuat_trungbinh = 0, 0, @chiphi_thuexuong / @sokhoi_xuat_trungbinh);
	SET @chiphi1 = @chiphi2 * @m3_tc;
	
	SET @ghichu = N'CP 1 SP = [chi phí thuê xưởng 1 tháng] / [trung bình số khối phôi, định hình 1, sơn của 1 tháng (lấy 6 tháng gần nhất)]';
END
ELSE
BEGIN
	DECLARE @dongia_other decimal(18, 2);
	SELECT @dongia_other = giatri
	FROM tr_hangmuc_chiphi
	WHERE id = @id_hangmuc

	--SET @chiphi1 = @dongia_other;
	--SET @chiphi2 = IIF(@m3_tc = 0, 0, @dongia_other / @m3_tc);

	SET @chiphi1 = @dongia_other * @m3_tc;
	SET @chiphi2 = @dongia_other;

	SET @ghichu = N'CP 1 SP = [Đơn giá 1 khối] * [Số khối TC 1 SP]'
END

SELECT id_hangmuc = @id_hangmuc, 
	chiphi1 = @chiphi1, 
	chiphi2 = @chiphi2,
	ghichu = @ghichu
END


