-- PARAMS:
-- @ORDERNUMBER nvarchar


CREATE   PROC TR_TIENDO_THANHPHAM_BY_ORDER(@ORDERNUMBER NVARCHAR(MAX))
AS
BEGIN
	SELECT A.order_number, A.item_number, 
		CONVERT(FLOAT, SUM(A.order_qty)) AS order_qty,
		SUM(A.order_qty * B.m3_tc) AS order_m3TC
	INTO #DONHANG
	FROM tr_order_detail A
		INNER JOIN tr_sanpham B ON A.item_number = B.masp
	WHERE A.f_cancelled = 'N' 
		AND A.order_number IN (SELECT dbo.TRIM([value]) FROM dbo.fn_Split(@ORDERNUMBER, ','))
	GROUP BY A.order_number, A.item_number

	SELECT A.madonhang, A.masp1, 
		SCT01 = SUM(CASE WHEN A.c_op = 'SCT01' THEN A.soluong END),
		SON01 = SUM(CASE WHEN A.c_op = 'SON01' THEN A.soluong END),
		DG01 = SUM(CASE WHEN A.c_op = 'DG01' THEN A.soluong END),
		DG02 = SUM(CASE WHEN A.c_op = 'DG02' THEN A.soluong END)
	INTO #THONGKE
	FROM (
		SELECT A.madonhang, C.c_op, A.masp1,
			soluong = CASE WHEN A.mact = '000' THEN A.soluong * A.sokhoi ELSE A.sokhoi END
		FROM tr_trangthai_sanxuat A
			INNER JOIN trtb_m_location B ON A.congdoan = B.c_location
			INNER JOIN trtb_m_op C ON B.c_op = C.c_op
		WHERE C.department IN ('SON', 'DONGGOI') -- AND A.mact = '000'
			AND A.donhang_sanxuat IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@ORDERNUMBER, ','))
			AND A.congdoan LIKE '%-PROD'
	) A
	GROUP BY A.madonhang, A.masp1

	SELECT A.order_number, A.item_number, C.tensp, C.hehang, 
		A.order_qty, 
		A.order_m3TC,
		B.SCT01, B.SON01, B.DG01, B.DG02,
		SCT01_PER = FORMAT(IIF(A.order_m3TC = 0, 0, B.SCT01 / A.order_m3TC), 'P2'),
		SON01_PER = FORMAT(IIF(A.order_m3TC = 0, 0, B.SON01 / A.order_m3TC), 'P2'),
		DG01_PER = FORMAT(IIF(A.order_m3TC = 0, 0,B.DG01 / A.order_m3TC), 'P2'),
		DG02_PER = FORMAT(IIF(A.order_m3TC = 0, 0,B.DG02 / A.order_m3TC), 'P2')
	FROM #DONHANG A
		LEFT JOIN #THONGKE B ON A.order_number = B.madonhang AND A.item_number = B.masp1
		LEFT JOIN tr_sanpham C ON A.item_number = C.masp

	DROP TABLE #DONHANG, #THONGKE

END


