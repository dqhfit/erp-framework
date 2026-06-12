-- PARAMS:
-- @fromDate date
-- @toDate date
-- @filter int


CREATE PROC [dbo].[TR_BAOCAO_HANGLOI_GETALL4]
(
	@fromDate date,
	@toDate date,
	@filter int = 0
)
AS
BEGIN
	SELECT tbh.id, donhang, ngaythang, tbh.masp, masp1, tbh.mact, tenct, 
		dm.nguyenlieu, dayy, rong, dai, soluong, 
		sokhoi = (dayy * rong * dai * soluong) / 1000000000,
		loailoi = hl.[name], 
		TacNhanGayLoi = tn.[name], 
		bophanlamloi = REPLACE(loc1.n_location, N'[Hoàn thành]', ''), 
		tinhtrang, 
		--nguyennhanloi = nn.[Name],
		nguyennhanloi = IIF(COALESCE(nn.[Name], N'Khác') = N'Khác', nguyennhankhac, nn.[Name]),
		nguyennhankhac, 
		nguoiphutrach, 
		huongxuly, 
		nguoiduyet, 
		daxuly, 
		tencongdoan = REPLACE(loc2.n_location, N'[Hoàn thành]', ''),
		bophantra = IIF(loc3.n_location is null, bophantra, REPLACE(loc3.n_location, N'[Hoàn thành]', '')),
		tbh.isCreateCard, tbh.card_no, tbh.congdoanhientai
	INTO #BAOCAO_HANGLOI
	FROM tr_baocao_hangloi tbh
		LEFT JOIN tr_tieuchuan_nguyennhan nn ON tbh.nguyennhanloi = nn.Id
		LEFT JOIN tr_tieuchuan_hangloi_loai hl ON tbh.loailoi = hl.ma
		LEFT JOIN tr_tieuchuan_hangloi_tacnhan tn ON tbh.TacNhanGayLoi = tn.ma
		LEFT JOIN trtb_m_location loc1 ON loc1.c_location = tbh.bophanlamloi
		LEFT JOIN trtb_m_location loc2 ON loc2.c_location = tbh.congdoan
		LEFT JOIN trtb_m_location loc3 ON loc3.c_location = tbh.bophantra
		LEFT JOIN tr_dinhmuc_govan dm ON tbh.masp1 = dm.masp AND tbh.mact = dm.mact
	WHERE tbh.ngaythang BETWEEN @fromDate AND @toDate
	--ORDER BY ngaythang DESC

	IF (@filter = 1 OR @filter = 2)
	BEGIN
		-- 1. ĐÃ TẠO PHIẾU, 2. CHƯA TẠO PHIẾU
		SELECT A.*, B.FullName AS tennguoiduyet,
			CASE WHEN ISNULL(A.nguoiduyet, '') = '' THEN N'Chưa duyệt' ELSE N'Đã duyệt' END AS duyetphieu
		FROM #BAOCAO_HANGLOI A
			LEFT JOIN SYS_USER B ON A.nguoiduyet = B.UserName
		WHERE isCreateCard = CASE WHEN @filter = 1 THEN CONVERT(bit, 1) WHEN @filter = 2 THEN CONVERT(bit, 0) END
		ORDER BY ngaythang DESC
	END
	ELSE IF @filter = 3
	BEGIN
		-- 3. ĐÃ HOÀN THÀNH
		SELECT A.*, B.FullName AS tennguoiduyet,
			CASE WHEN ISNULL(A.nguoiduyet, '') = '' THEN N'Chưa duyệt' ELSE N'Đã duyệt' END AS duyetphieu
		FROM #BAOCAO_HANGLOI A
			LEFT JOIN SYS_USER B ON A.nguoiduyet = B.UserName
		WHERE daxuly = 1
		ORDER BY ngaythang DESC
	END
	ELSE IF @filter = 4
	BEGIN
		-- 4. CHƯA HOÀN THÀNH
		SELECT A.*, B.FullName AS tennguoiduyet,
			CASE WHEN ISNULL(A.nguoiduyet, '') = '' THEN N'Chưa duyệt' ELSE N'Đã duyệt' END AS duyetphieu
		FROM #BAOCAO_HANGLOI A
			LEFT JOIN SYS_USER B ON A.nguoiduyet = B.UserName
		WHERE daxuly = 0 AND nguoiduyet IS NOT NULL
		ORDER BY ngaythang DESC
	END
	ELSE
	BEGIN
		SELECT A.*, B.FullName AS tennguoiduyet,
			CASE WHEN ISNULL(A.nguoiduyet, '') = '' THEN N'Chưa duyệt' ELSE N'Đã duyệt' END AS duyetphieu
		FROM #BAOCAO_HANGLOI A
			LEFT JOIN SYS_USER B ON A.nguoiduyet = B.UserName
		ORDER BY ngaythang DESC
	END

	DROP TABLE #BAOCAO_HANGLOI;
END


