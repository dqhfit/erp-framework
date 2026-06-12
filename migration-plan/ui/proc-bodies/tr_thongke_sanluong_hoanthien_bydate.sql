-- PARAMS:
-- @fromDate date
-- @toDate date


CREATE   PROC TR_THONGKE_SANLUONG_HOANTHIEN_BYDATE
( 
	@fromDate date, 
	@toDate date
)
AS
BEGIN
	--SET @fromDate = '2025-06-01';
	--SET @toDate = '2025-06-17';

	-- 1. SẢN LƯỢNG TỪ NGÀY ĐẾN NGÀY
	SELECT * 
	INTO #THONGKE_SANLUONG
	FROM (
		SELECT A.congdoan, A.madonhang,
			SUM(A.soluong) AS soluong,
			SUM(A.soluong * A.sokhoi) AS sokhoi
		FROM tr_trangthai_sanxuat A
		WHERE A.congdoan IN ('DG01-PROD', 'DG02-PROD', 'SON01-PROD', 'SCT01-PROD')
			AND A.ngaythang BETWEEN @fromDate AND @toDate
			AND A.mact = '000'
		GROUP BY A.congdoan, A.madonhang
		--UNION ALL
		--SELECT A.congdoan, A.madonhang, A.masp1,
		--	SUM(A.sokhoi) AS sokhoi
		--FROM tr_trangthai_sanxuat A
		--WHERE A.congdoan IN ('DG01-PROD', 'DG02-PROD', 'SON01-PROD', 'SCT01-PROD')
		--	AND A.ngaythang BETWEEN @fromDate AND @toDate
		--	AND A.mact <> '000' AND A.nguyenlieu NOT IN ('', '0')
		--GROUP BY A.congdoan, A.madonhang, A.masp1
	) A

	-- 2. SẢN LƯỢNG ĐÃ THỐNG KÊ CỦA CÁC ĐƠN HÀNG TRÊN
	SELECT A.congdoan, A.madonhang,
		SUM(A.soluong) AS tongsoluong_hoanthanh,
		SUM(A.soluong * A.sokhoi) AS tongsokhoi_hoanthanh
	INTO #THONGKE_SANLUONG_TONGHOP
	FROM tr_trangthai_sanxuat A
	WHERE A.congdoan IN ('DG01-PROD', 'DG02-PROD', 'SON01-PROD', 'SCT01-PROD') 
		AND A.mact = '000'
		AND A.madonhang IN (SELECT DISTINCT madonhang FROM #THONGKE_SANLUONG)
	GROUP BY A.congdoan, A.madonhang

	SELECT A.order_number AS madonhang, A.[range] AS hehang, 
		SUM(B.order_qty) AS soluong_donhang, 
		ROUND(SUM(B.order_qty * C.cbm)/68, 1) AS soluong_cont
	INTO #DONHANG
	FROM tr_order A
	INNER JOIN tr_order_detail B ON A.order_number = B.order_number
	INNER JOIN tr_sanpham C ON B.item_number = C.masp
	WHERE A.f_cancelled = 'N' AND B.f_cancelled = 'N'
		AND A.order_number IN (SELECT DISTINCT madonhang FROM #THONGKE_SANLUONG)
	GROUP BY A.order_number,A.[range]

	SELECT E.tenkhuvuc, B.congdoan, D.n_op AS tencongdoan, A.madonhang, A.hehang, 
		A.soluong_cont, A.soluong_donhang, 
		soluong_cont_hoanthanh = ROUND((A.soluong_cont / A.soluong_donhang) * B.soluong, 1),
		B.soluong AS soluong_hoanthanh,
		tongsoluong_cont_hoanthanh = ROUND((A.soluong_cont / A.soluong_donhang) * TH.tongsoluong_hoanthanh, 1),
		TH.tongsoluong_hoanthanh
	FROM #DONHANG A
		INNER JOIN #THONGKE_SANLUONG B ON A.madonhang = B.madonhang
		INNER JOIN #THONGKE_SANLUONG_TONGHOP TH ON B.madonhang = TH.madonhang AND B.congdoan = TH.congdoan
		INNER JOIN trtb_m_location C ON B.congdoan = C.c_location
		INNER JOIN trtb_m_op D ON C.c_op = D.c_op
		INNER JOIN tr_khuvuc_sanxuat E ON D.department = E.makhuvuc
	ORDER BY D.n_op, A.madonhang

	DROP TABLE #THONGKE_SANLUONG, #DONHANG, #THONGKE_SANLUONG_TONGHOP;
END

