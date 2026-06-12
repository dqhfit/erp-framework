-- PARAMS:
-- @tungay date
-- @denngay date


CREATE   PROC [dbo].[TR_TRANGTHAI_SANXUAT_REPORT5]
(
	@tungay date,
	@denngay date
)
AS
BEGIN
	-- SỐ NGƯỜI HIỆN DIỆN
	SELECT A.ngaythang, A.macongdoan, B.n_op AS tencongdoan, 
		COALESCE(A.songuoi_hiendien_hc, 0) AS songuoi_hiendien_hc, 
		COALESCE(A.muctieu_sokhoi_theo_hc, 0) AS muctieu_sokhoi_theo_hc
	INTO #BAOCAO_HIENDIEN
	FROM tr_muctieu_sanxuat2_chitiet A
		INNER JOIN trtb_m_op B ON A.macongdoan = B.c_op
	WHERE A.ngaythang BETWEEN @tungay AND @denngay AND A.songuoi_hiendien_hc > 0
		AND A.macongdoan NOT IN ('UV03', 'SON01', 'SCT01', 'SCT1', 'DG01', 'DG02')
	
	-- TRẠNG THÁI SẢN XUẤT
	SELECT A.ngaythang, FORMAT(A.ngaytao, 'HHmm') as thoigian,
		C.c_op AS macongdoan, C.n_op AS tencongdoan, 
		(CASE
			WHEN A.mact = '000' THEN A.soluong * A.sokhoi
			WHEN A.mact <> '000' AND COALESCE(A.nguyenlieu,'') IN ('', '0') THEN (A.soluong * A.dayy*A.rong*A.dai)/1000000000
			ELSE A.sokhoi
		END) AS sokhoi
	INTO #TRANGTHAI_SANXUAT
	FROM tr_trangthai_sanxuat A
	INNER JOIN trtb_m_location B ON A.congdoan = B.c_location
	INNER JOIN trtb_m_op C ON B.c_op = C.c_op
	WHERE A.congdoan LIKE '%-PROD' AND A.ngaythang BETWEEN @tungay AND @denngay
		AND A.donhang_sanxuat IS NULL


	SELECT COALESCE(A.ngaythang, B.ngaythang) AS ngaythang, 
		COALESCE(A.macongdoan, B.macongdoan) AS macongdoan, 
		COALESCE(A.tencongdoan, B.tencongdoan) AS tencongdoan,
		A.sokhoi, A.TI_01, A.TI_02, A.TI_03, A.TI_04, A.TI_05,
		B.songuoi_hiendien_hc, B.muctieu_sokhoi_theo_hc,
		binhquan = IIF(COALESCE(B.songuoi_hiendien_hc, 0) = 0, 0, COALESCE(A.sokhoi, 0) / B.songuoi_hiendien_hc) 
	FROM (	
		SELECT A.ngaythang, A.macongdoan, A.tencongdoan,
			sokhoi = SUM(A.sokhoi),
			TI_01 = SUM(CASE WHEN A.thoigian >= 0730 AND A.thoigian < 0930 THEN A.sokhoi ELSE 0 END),
			TI_02 = SUM(CASE WHEN A.thoigian >= 0930 AND A.thoigian < 1130 THEN A.sokhoi ELSE 0 END),
			TI_03 = SUM(CASE WHEN A.thoigian >= 1130 AND A.thoigian < 1430 THEN A.sokhoi ELSE 0 END),
			TI_04 = SUM(CASE WHEN A.thoigian >= 1430 AND A.thoigian < 1630 THEN A.sokhoi ELSE 0 END),
			TI_05 = SUM(CASE WHEN A.thoigian >= 1630 THEN A.sokhoi ELSE 0 END)
		FROM #TRANGTHAI_SANXUAT A
		GROUP BY A.ngaythang, A.macongdoan, A.tencongdoan
	) A FULL JOIN #BAOCAO_HIENDIEN B ON A.ngaythang = B.ngaythang AND A.macongdoan = B.macongdoan
	ORDER BY 1, 3

	DROP TABLE #TRANGTHAI_SANXUAT, #BAOCAO_HIENDIEN;
END

