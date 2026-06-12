-- PARAMS:
-- @tungay date
-- @denngay date


CREATE   PROC [dbo].[TR_TRANGTHAI_SANXUAT_BAOCAO_THEONGAY]
(
	@tungay date,
	@denngay date
)
AS
BEGIN
	-- SỐ NGƯỜI HIỆN DIỆN
	SELECT A.ngaythang, A.macongdoan, B.n_op AS tencongdoan, 
		COALESCE(A.songuoi_hiendien_hc, 0) AS songuoi_hiendien_hc
		--COALESCE(A.muctieu_sokhoi_theo_hc, 0) AS muctieu_sokhoi_theo_hc
	INTO #BAOCAO_HIENDIEN
	FROM tr_muctieu_sanxuat2_chitiet A
		INNER JOIN trtb_m_op B ON A.macongdoan = B.c_op
	WHERE A.ngaythang BETWEEN @tungay AND @denngay AND A.songuoi_hiendien_hc > 0
		AND A.macongdoan NOT IN ('UV03', 'SON01', 'SCT1', 'SCT01', 'DG01', 'DG02')
	
	-- TRẠNG THÁI SẢN XUẤT
	SELECT A.ngaythang, A.madonhang, D.hehang,
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
	INNER JOIN tr_sanpham D ON A.masp1 = D.masp
	WHERE A.congdoan LIKE '%-PROD' AND A.ngaythang BETWEEN @tungay AND @denngay
		AND A.donhang_sanxuat IS NULL

	SELECT A.ngaythang, A.macongdoan, A.tencongdoan, A.madonhang, A.hehang,
		A.sokhoi, A.songuoi_hiendien_hc,
		A.tongsokhoi, binhquan = COALESCE(A.tongsokhoi, 0) / A.songuoi_hiendien_hc
	FROM (
		SELECT COALESCE(A.ngaythang, B.ngaythang) AS ngaythang, 
			COALESCE(A.macongdoan, B.macongdoan) AS macongdoan, 
			COALESCE(A.tencongdoan, B.tencongdoan) AS tencongdoan,
			A.madonhang, A.hehang,
			A.sokhoi, 
			B.songuoi_hiendien_hc,
			tongsokhoi = SUM(A.sokhoi) OVER (PARTITION BY COALESCE(A.ngaythang, B.ngaythang), COALESCE(A.macongdoan, B.macongdoan))
		FROM (	
			SELECT A.ngaythang, A.macongdoan, A.tencongdoan, A.madonhang, A.hehang,
				sokhoi = SUM(A.sokhoi)
			FROM #TRANGTHAI_SANXUAT A
			GROUP BY A.ngaythang, A.macongdoan, A.tencongdoan, A.madonhang, A.hehang
		) A FULL JOIN #BAOCAO_HIENDIEN B ON A.ngaythang = B.ngaythang AND A.macongdoan = B.macongdoan
	) A
	ORDER BY A.ngaythang, A.tencongdoan

	DROP TABLE #TRANGTHAI_SANXUAT, #BAOCAO_HIENDIEN;
END

