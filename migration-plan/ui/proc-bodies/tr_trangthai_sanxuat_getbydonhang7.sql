-- PARAMS:
-- @madonhang nvarchar


CREATE PROC TR_TRANGTHAI_SANXUAT_GETBYDONHANG7 (@madonhang nvarchar(200))
AS
BEGIN
	SELECT madonhang = ISNULL(B.dondathang, A.madonhang), 
		masp = ISNULL(B.mahtr, A.masp), 
		masp1 = ISNULL(B.masp, A.masp1), 
		B.stt,
		mact = ISNULL(B.mact, A.mact), 
		tenct = ISNULL(B.tenct, A.tenct),
		nguyenlieu = ISNULL(B.nguyenlieu, A.nguyenlieu),
		dayy = ISNULL(B.dayy_tc, A.dayy), 
		rong = ISNULL(B.rong_tc, A.rong), 
		dai = ISNULL(B.dai_tc, A.dai), 
		soluong = CAST(ISNULL(A.soluong, 0) AS int),
		B.soluong_can,
		A.congdoan,
		congdoan_type = SUBSTRING(A.congdoan, CHARINDEX('-', A.congdoan) + 1, LEN(A.congdoan)),
		B.isCreateCard, A.ngaygiao
	INTO #TRANGTHAI_SANXUAT
	FROM (SELECT * FROM tr_trangthai_sanxuat WHERE pcard IS NOT NULL AND madonhang = @madonhang) A
		RIGHT JOIN (SELECT * FROM tr_pallet WHERE dondathang = @madonhang AND active = 1 AND isCreateCard = 1) B ON A.madonhang = B.dondathang AND A.masp1 = B.masp AND A.mact = B.mact

	SELECT A.madonhang, A.masp, A.masp1, A.stt, A.mact, A.tenct, 
		A.nguyenlieu, A.dayy, A.rong, A.dai, 
		soluong = CASE WHEN A.congdoan_type = 'IN' AND A.ngaygiao IS NULL THEN 0 ELSE A.soluong END, 
		A.soluong_can,
		A.congdoan, 
		C.n_op AS tencongdoan,
		congdoan_type = CASE 
							WHEN A.congdoan_type = 'IN' THEN N'Nhận' 
							WHEN A.congdoan_type = 'PROD' THEN N'Hoàn thành' 
							ELSE A.congdoan_type
						END,
		A.isCreateCard
	INTO #TRANGTHAI_SANXUAT2
	FROM #TRANGTHAI_SANXUAT A
		INNER JOIN trtb_m_location B ON A.congdoan = B.c_location
		INNER JOIN trtb_m_op C ON B.c_op = C.c_op

	SELECT madonhang, masp, masp1, stt, mact, tenct, tencongdoan, nguyenlieu,
		dayy, rong, dai,
		congdoan, tencongdoan, congdoan_type, isCreateCard,
		SUM(soluong) AS soluong,
		sum(distinct soluong_can) as soluong_can
	FROM #TRANGTHAI_SANXUAT2
	GROUP BY madonhang, masp, masp1, stt, mact, tenct, tencongdoan, nguyenlieu, dayy, rong, dai, congdoan, tencongdoan, congdoan_type, isCreateCard

	DROP TABLE #TRANGTHAI_SANXUAT2, #TRANGTHAI_SANXUAT;
END


