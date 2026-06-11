-- PARAMS:
-- @madonhang nvarchar


CREATE PROC TR_TINHGIA_BY_DDH(@madonhang nvarchar(50))
AS
BEGIN
	SELECT A.c_op, A.n_op, B.c_location, A.department 
	INTO #DANHSACH_CONGDOAN
	FROM trtb_m_op A INNER JOIN trtb_m_location B ON A.c_op = B.c_op
	WHERE A.active = 1 AND B.active = 1

	SELECT A.madonhang, A.masp1, C.hehang, A.ngaythang, B.c_op AS macongdoan, B.n_op AS tencongdoan,
		SUM(CASE
			WHEN A.mact = '000' THEN A.soluong * A.sokhoi
			WHEN COALESCE(A.nguyenlieu, '') NOT IN ('', '0') AND A.mact <> '000' THEN A.sokhoi
			ELSE 0
		END) AS sokhoi
	INTO #TRANGTHAI_SANXUAT
	FROM tr_trangthai_sanxuat A INNER JOIN #DANHSACH_CONGDOAN B ON A.congdoan = B.c_location
	INNER JOIN tr_sanpham C ON A.masp1 = C.masp
	WHERE A.madonhang = @madonhang -- A.ngaythang BETWEEN @tungay AND @denngay
		AND A.congdoan LIKE '%-PROD'
		AND B.department NOT IN ('SON', 'UV', 'DONGGOI')
	GROUP BY A.madonhang, A.masp1, C.hehang, A.ngaythang, B.c_op, B.n_op

	SELECT A.macongdoan, A.tencongdoan, A.madonhang, A.hehang, A.heso,
		A.songay, A.tungay, A.denngay, A.sokhoi,
		A.sokhoi * A.heso AS sokhoi1
	FROM (
		SELECT A.macongdoan, A.tencongdoan, A.madonhang, A.hehang, COALESCE(B.heso, 1) AS heso,
			COUNT(DISTINCT A.ngaythang) AS songay,
			MIN(A.ngaythang) AS tungay,
			MAX(A.ngaythang) AS denngay,
			SUM(A.sokhoi) AS sokhoi
		FROM #TRANGTHAI_SANXUAT A LEFT JOIN tr_hehang B ON A.hehang = B.tenhh
		GROUP BY A.macongdoan, A.tencongdoan, A.madonhang, A.hehang, B.heso
	) A


	DROP TABLE #DANHSACH_CONGDOAN, #TRANGTHAI_SANXUAT;
END

