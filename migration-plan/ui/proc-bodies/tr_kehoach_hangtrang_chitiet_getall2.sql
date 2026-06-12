-- PARAMS:
-- @congdoan nvarchar


CREATE   PROC TR_KEHOACH_HANGTRANG_CHITIET_GETALL2(@congdoan nvarchar(50))
AS
BEGIN
	SELECT A.congdoan, B.n_op AS tencongdoan, A.madonhang, A.masp, C.tensp, C.hehang,
		A.soluong_kehoach, A.tungay, A.denngay
	INTO #KEHOACH_HANGTRANG
	FROM (
		SELECT A.congdoan, A.madonhang, A.masp, 
			--SUM(DISTINCT A.soluong_donhang) AS soluong_donhang, 
			SUM(B.soluong_kehoach) AS soluong_kehoach,
			MIN(B.ngaythang) AS tungay,
			MAX(B.ngaythang) AS denngay
		FROM tr_kehoach_hangtrang A
			INNER JOIN tr_kehoach_hangtrang_chitiet B ON A.id_kehoach = B.id_kehoach
		WHERE A.hoanthanh = 0 AND A.congdoan = @congdoan
		GROUP BY A.congdoan, A.madonhang, A.masp
	) A 
		INNER JOIN trtb_m_op B ON A.congdoan = B.c_op
		INNER JOIN tr_sanpham C ON A.masp = C.masp

	SELECT B.c_op, A.madonhang, A.masp1, 
		SUM(A.soluong) AS soluong_hoanthanh,
		MIN(A.ngaythang) AS tungay,
		MAX(A.ngaythang) AS denngay
	INTO #SANXUAT
	FROM tr_trangthai_sanxuat A
		INNER JOIN trtb_m_location B ON A.congdoan = B.c_location
	WHERE A.congdoan LIKE '%-PROD' AND A.mact = '000'
	GROUP BY B.c_op, A.madonhang, A.masp1

	SELECT A.congdoan, A.tencongdoan, 
		A.madonhang, A.masp, C.tensp, C.hehang, 
		A.soluong_kehoach, A.tungay, A.denngay,
		B.soluong_hoanthanh, B.tungay AS tungay1, B.denngay AS denngay1,
		phantram = ROUND(100 * COALESCE(B.soluong_hoanthanh, 0) / CONVERT(float,A.soluong_kehoach), 2)
	FROM #KEHOACH_HANGTRANG A
		LEFT JOIN #SANXUAT B ON A.congdoan = B.c_op AND A.madonhang = B.madonhang AND A.masp = B.masp1
		INNER JOIN tr_sanpham C ON A.masp = C.masp

	DROP TABLE #KEHOACH_HANGTRANG, #SANXUAT;
END

