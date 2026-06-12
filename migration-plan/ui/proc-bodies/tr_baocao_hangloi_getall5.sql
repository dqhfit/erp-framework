-- PARAMS:
-- @fromDate date
-- @toDate date


CREATE   PROC [dbo].[TR_BAOCAO_HANGLOI_GETALL5]
(
	@fromDate DATE,
	@toDate DATE
)
AS
BEGIN
	SELECT tbh.id, ngaythang, tbh.masp, tbh.mact, 
		loc1.c_op AS mabophanlamloi,
		bophanlamloi = REPLACE(loc1.n_location, N'[Hoàn thành]', ''), 
		tbh.donhang AS maddh,
		donhang = SUBSTRING(tbh.donhang, CHARINDEX('-', tbh.donhang) + 1, LEN(tbh.donhang) - 1),
		masp1, tenct, dm.nguyenlieu, dayy, rong, dai, soluong,
		sokhoi = (dayy * rong * dai * soluong) / 1000000000,
		loailoi = hl.[name], 
		tacnhangayloi = tn.[name], 
		tinhtrang, 
		--nguyennhanloi = IIF(ISNULL(nguyennhankhac, '') = '', nn.[Name], CONCAT(nn.[Name], ' (', nguyennhankhac, ')')),
		nguyennhanloi = IIF(COALESCE(nn.[Name], N'Khác') = N'Khác', nguyennhankhac, nn.[Name]),
		nguyennhankhac, 
		nguoiphutrach, 
		huongxuly, 
		nguoiduyet, 
		daxuly, 
		tencongdoan = REPLACE(loc2.n_location, N'[Hoàn thành]', ''),
		bophantra = IIF(loc3.n_location is null, bophantra, REPLACE(loc3.n_location, N'[Hoàn thành]', '')),
		tbh.isCreateCard, tbh.card_no,
		0 AS dongia
	INTO #BAOCAO_HANGLOI
	FROM tr_baocao_hangloi tbh
		LEFT JOIN tr_tieuchuan_nguyennhan nn ON tbh.nguyennhanloi = nn.Id
		LEFT JOIN tr_tieuchuan_hangloi_loai hl ON tbh.loailoi = hl.ma
		LEFT JOIN tr_tieuchuan_hangloi_tacnhan tn ON tbh.TacNhanGayLoi = tn.ma
		LEFT JOIN trtb_m_location loc1 ON loc1.c_location = tbh.bophanlamloi
		LEFT JOIN trtb_m_location loc2 ON loc2.c_location = tbh.congdoan
		LEFT JOIN trtb_m_location loc3 ON loc3.c_location = tbh.bophantra
		LEFT JOIN tr_dinhmuc_govan dm ON tbh.masp1 = dm.masp AND tbh.mact = dm.mact
	WHERE tbh.ngaythang BETWEEN @fromDate AND @toDate AND tbh.bophanlamloi IS NOT NULL
	
	-- cập nhật đơn giá phôi
	--DECLARE @tigia decimal(18, 2) = 26000 -- lấy tỷ giá mặc định 26000
	DECLARE CUR CURSOR LOCAL FOR
		SELECT maddh, nguyenlieu FROM #BAOCAO_HANGLOI
	OPEN CUR;
	DECLARE @maddh nvarchar(50), @nguyenlieu nvarchar(50);
	FETCH NEXT FROM CUR INTO @maddh, @nguyenlieu;
	WHILE @@FETCH_STATUS = 0
	BEGIN
		DECLARE @dongia decimal(18, 2);
		set @dongia = 0;

		EXEC DQT_THONGKE_PHOI_DONGIA @maddh, @nguyenlieu, @dongia OUTPUT;

		UPDATE #BAOCAO_HANGLOI
		SET dongia = @dongia
		WHERE maddh = @maddh AND nguyenlieu = @nguyenlieu

		FETCH NEXT FROM CUR INTO @maddh, @nguyenlieu;
	END
	CLOSE CUR;
	DEALLOCATE CUR;

	-- 1. BÁO CÁO CHI TIẾT
	SELECT bophanlamloi, ngaythang, donhang, masp1, tenct, nguyenlieu,
		dayy, rong, dai, soluong, sokhoi, bophantra, tacnhangayloi, tinhtrang, nguyennhanloi, huongxuly
	FROM #BAOCAO_HANGLOI
	ORDER BY bophanlamloi, ngaythang, donhang, masp1

	-- 2. Phân loại lỗi ra phôi mới
	SELECT bophanlamloi, donhang, masp1, tensp, tacnhangayloi, daxuly, huongxuly,
		soluong, sokhoi,
		tileloi = ROUND((100 * sokhoi) / SUM(sokhoi) OVER (), 2)
	FROM (
		SELECT bophanlamloi, donhang, masp1, B.tensp, 
			SUM(soluong) AS soluong, 
			SUM(sokhoi) AS sokhoi, 
			tacnhangayloi, daxuly, huongxuly
		FROM #BAOCAO_HANGLOI A LEFT JOIN tr_sanpham B ON A.masp1 = B.masp
		--WHERE huongxuly IN (N'Đổi phôi', N'Thay phôi mới', N'Cấp phôi mới', N'Ra phôi mới')
		WHERE CHARINDEX(N'Ra phôi mới', huongxuly) > 0
		GROUP BY bophanlamloi, donhang, masp1, B.tensp, tacnhangayloi, daxuly, huongxuly
	) A
	ORDER BY bophanlamloi, donhang

	-- 3. Phân loại lỗi sửa chữa
	SELECT bophanlamloi, donhang, masp1, tensp, tacnhangayloi, daxuly, huongxuly,
		soluong, sokhoi,
		tileloi = ROUND((100 * sokhoi) / SUM(sokhoi) OVER (), 2)
	FROM (
		SELECT bophanlamloi, donhang, masp1, B.tensp, 
			SUM(soluong) AS soluong, 
			SUM(sokhoi) AS sokhoi, 
			tacnhangayloi, daxuly, huongxuly
		FROM #BAOCAO_HANGLOI A LEFT JOIN tr_sanpham B ON A.masp1 = B.masp
		--WHERE huongxuly NOT IN (N'Đổi phôi', N'Thay phôi mới', N'Cấp phôi mới', N'Ra phôi mới')
		WHERE CHARINDEX(N'Ra phôi mới', huongxuly) = 0
		GROUP BY bophanlamloi, donhang, masp1, tensp, tacnhangayloi, daxuly, huongxuly
	) A
	ORDER BY bophanlamloi, donhang

	-- 4. Bảng tổng hợp phân loại sản phẩm KPH  nhóm nguyên liệu
	SELECT nguyenlieu, sokhoi, tile = ROUND(100 * sokhoi / SUM(sokhoi) OVER(), 2)
	FROM (
		SELECT nguyenlieu, SUM(sokhoi) AS sokhoi
		FROM #BAOCAO_HANGLOI
		GROUP BY nguyenlieu
	) A
	ORDER BY nguyenlieu

	-- 5. Bảng tổng hợp phân loại sản phẩm KPH theo nhóm lỗi
	SELECT tacnhangayloi, soluong, sokhoi, tile = ROUND(100 * sokhoi / SUM(sokhoi) OVER(), 2)
	FROM (
		SELECT tacnhangayloi, SUM(soluong) AS soluong, SUM(sokhoi) AS sokhoi
		FROM #BAOCAO_HANGLOI
		GROUP BY tacnhangayloi
	) A
	ORDER BY tacnhangayloi

	-- 6. Bảng tổng hợp phân loại sản phẩm KPH theo công đoạn gây ra sai hỏng
	SELECT bophanlamloi, nguyenlieu, sokhoi, tile = ROUND(100 * sokhoi / SUM(sokhoi) OVER(), 2)
	FROM (
		SELECT bophanlamloi, nguyenlieu, SUM(sokhoi) AS sokhoi
		FROM #BAOCAO_HANGLOI
		GROUP BY bophanlamloi, nguyenlieu
	) A
	ORDER BY bophanlamloi
	
	-- 7. Bảng tổng hợp phân loại sản phẩm KPH theo bộ phận
	SELECT tenxuong, tenkhuvuc, SUM(sokhoi_suachua) AS sokhoi_suachua, SUM(sokhoi_raphoimoi) AS sokhoi_raphoimoi
	INTO #TABLE7
	FROM (
		SELECT  
			C.tenxuong,
			C.tenkhuvuc,
			sokhoi_suachua = CASE WHEN CHARINDEX(N'Ra phôi mới', huongxuly) = 0 THEN sokhoi ELSE 0 END,
			sokhoi_raphoimoi = CASE WHEN CHARINDEX(N'Ra phôi mới', huongxuly) > 0 THEN sokhoi ELSE 0 END
		FROM #BAOCAO_HANGLOI A
			LEFT JOIN trtb_m_op B ON A.mabophanlamloi = B.c_op
			LEFT JOIN tr_khuvuc_sanxuat C ON B.department = C.makhuvuc
	) A
	GROUP BY tenxuong, tenkhuvuc

	SELECT D.tenxuong,
		sokhoi = SUM(CASE WHEN A.mact = '000' THEN A.sokhoi * A.soluong ELSE IIF(LEN(A.nguyenlieu)>0, A.sokhoi, 0) END)
	INTO #TRANGTHAI_SANXUAT
	FROM tr_trangthai_sanxuat A
		INNER JOIN trtb_m_location B ON A.congdoan = B.c_location
		INNER JOIN trtb_m_op C ON B.c_op = C.c_op
		INNER JOIN tr_khuvuc_sanxuat D ON C.department = D.makhuvuc
	WHERE A.ngaythang BETWEEN @fromDate AND @toDate
		AND A.congdoan IN (N'NHA01-PROD', N'DP09-PROD')
	GROUP BY D.tenxuong

	SELECT A.tenxuong, A.tenkhuvuc, A.sokhoi_suachua, A.sokhoi_raphoimoi, COALESCE(B.sokhoi, 0) AS sokhoi_hoanthanh,
		tyle_suachua = 100 * CASE WHEN COALESCE(B.sokhoi, 0) = 0 THEN 0 ELSE A.sokhoi_suachua / COALESCE(B.sokhoi, 0) END,
		tyle_raphoimoi = 100 * CASE WHEN COALESCE(B.sokhoi, 0) = 0 THEN 0 ELSE A.sokhoi_raphoimoi / COALESCE(B.sokhoi, 0) END
	FROM #TABLE7 A
		LEFT JOIN #TRANGTHAI_SANXUAT B ON A.tenxuong = B.tenxuong

	-- 8. CHI PHÍ SAI HỎNG
	--SELECT bophanlamloi, nguyenlieu, huongxuly, 
	--	sokhoi, dongia, thanhtien = sokhoi * dongia,
	--	phantram = ROUND((sokhoi * 100) / SUM(sokhoi) OVER(), 2)
	--FROM (
	--	SELECT bophanlamloi, nguyenlieu, huongxuly, AVG(dongia) AS dongia, SUM(sokhoi) AS sokhoi
	--	FROM #BAOCAO_HANGLOI
	--	GROUP BY bophanlamloi, nguyenlieu, huongxuly
	--) A
	--ORDER BY bophanlamloi, nguyenlieu
	SELECT bophanlamloi, nguyenlieu, huongxuly, 
		sokhoi, dongia, thanhtien = sokhoi * dongia,
		phantram = ROUND((sokhoi * 100) / SUM(sokhoi) OVER(), 2)
	FROM (
		SELECT t1.bophanlamloi, t1.nguyenlieu, t1.huongxuly, SUM(t1.sokhoi) AS  sokhoi, AVG(t2.dongia) AS dongia
		FROM #BAOCAO_HANGLOI T1
			LEFT JOIN (
				SELECT bophanlamloi, nguyenlieu, AVG(dongia) AS dongia 
				FROM #BAOCAO_HANGLOI DG
				WHERE DG.dongia > 0
				GROUP BY bophanlamloi, nguyenlieu
			) T2 ON T1.bophanlamloi = T2.bophanlamloi AND T1.nguyenlieu = T2.nguyenlieu
		WHERE CHARINDEX(N'Ra phôi mới', T1.huongxuly) > 0
		GROUP BY t1.bophanlamloi, t1.nguyenlieu, t1.huongxuly
	) A
	ORDER BY bophanlamloi, nguyenlieu
	
	DROP TABLE #BAOCAO_HANGLOI, #TRANGTHAI_SANXUAT, #TABLE7;

END

