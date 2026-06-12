-- PARAMS:
-- @fromDate date
-- @toDate date


CREATE PROC [dbo].[TR_BAOCAO_HANGLOI_GETALL2]
(
	@fromDate date,
	@toDate date
)
AS
BEGIN
	SELECT tbh.id, ngaythang, tbh.masp, tbh.mact, 
		bophanlamloi = REPLACE(loc1.n_location, N'[Hoàn thành]', ''), 
		donhang = SUBSTRING(tbh.donhang, CHARINDEX('-', tbh.donhang) + 1, LEN(tbh.donhang) - 1),
		masp1, tenct, dm.nguyenlieu, dayy, rong, dai, soluong,
		sokhoi = (dayy * rong * dai * soluong) / 1000000000,
		loailoi = hl.[name], 
		TacNhanGayLoi = tn.[name], 
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
		tbh.isCreateCard, tbh.card_no
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
	--ORDER BY loc1.n_location, ngaythang

	-- TRANG THAI SAN XUAT
	SELECT A.nguyenlieu, SUM(A.dayy*A.rong*A.dai*A.soluong)/1000000000 AS sokhoi_hoanthanh
	INTO #THONGKE_SOLUONG
	FROM tr_trangthai_sanxuat A
	WHERE A.ngaythang BETWEEN @fromDate AND @toDate
		AND A.congdoan LIKE 'NHA01-PROD'
		AND A.nguyenlieu NOT IN ('', '0')
		AND A.donhang_sanxuat IS NULL
	GROUP BY A.nguyenlieu

	-- TABLE 0
	SELECT * FROM #BAOCAO_HANGLOI ORDER BY bophanlamloi, ngaythang;

	-- TABLE 1
	SELECT A.nguyenlieu, SUM(soluong) AS soluong, SUM(sokhoi) AS sokhoi, SUM(DISTINCT B.sokhoi_hoanthanh) AS sokhoi_hoanthanh
	FROM #BAOCAO_HANGLOI A
		LEFT JOIN #THONGKE_SOLUONG B ON A.nguyenlieu = B.nguyenlieu
	GROUP BY A.nguyenlieu

	-- TABLE 2
	SELECT TacNhanGayLoi, soluong, sokhoi,
		phantram = ROUND(100.0 * sokhoi / SUM(sokhoi)  OVER (), 2)
	FROM (
		SELECT TacNhanGayLoi, 
			SUM(soluong) AS soluong, 
			SUM(sokhoi) AS sokhoi
		FROM #BAOCAO_HANGLOI
		GROUP BY TacNhanGayLoi
	) A
	
	DROP TABLE #BAOCAO_HANGLOI, #THONGKE_SOLUONG;
END

