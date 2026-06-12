-- PARAMS:
-- @donhang nvarchar


CREATE PROC TR_SODO_CATVAN_GETBYORDER
(
	@donhang nvarchar(max)
)
AS
BEGIN
	DECLARE @TB_NGUYENLIEU TABLE
	(
		nguyenlieu nvarchar(200)
	)

	INSERT INTO @TB_NGUYENLIEU(nguyenlieu)
	VALUES ('LBV'), ('LVB'), ('LVD'), ('LVP'), ('MDF'), ('PB'), ('PLYWOOD'), ('VÁN ÉP'),
		(N'LVB BẠCH DƯƠNG VNR BẠCH DƯƠNG 0.3, BẠCH DƯƠNG 0.3'),
		(N'LVD CAO SU VNR THÔNG 0.3, VNR THÔNG 0.3'),
		(N'LVL CAO SU VNR BẠCH DƯƠNG 0.3, BẠCH DƯƠNG 0.3'),
		(N'LVL CAO SU VNR TẠP 0.3, VNR TẠP 0.3')

	SELECT A.order_number, A.item_number, SUM(A.order_qty) AS  order_qty
	INTO #DONHANG_SANXUAT
	FROM tr_order_detail A
	WHERE A.f_cancelled = 'N' AND A.order_number IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@donhang, ','))
	GROUP BY A.order_number, A.item_number

	SELECT B.order_number, A.masp, A.mact, A.chitiet, 
		A.nguyenlieu, A.dayy_tc, A.rong_tc, A.dai_tc, A.soluong_tc,
		soluong_donhang = B.order_qty,
		soluongcan = A.soluong_tc * B.order_qty,
		sokhoi = A.m3_tc * B.order_qty,
		A.veneer_canhdai, A.veneer_canhngan,
		A.veneer_matchinh, A.veneer_matphu, A.veneer_dan_canh,
		C.loaihang AS tenveneer_matchinh, 
		D.loaihang AS tenveneer_matphu, 
		E.loaihang AS tenveneer_dan_canh,
		A.ghichu
	FROM tr_dinhmuc_govan A
	INNER JOIN #DONHANG_SANXUAT B ON A.masp = B.item_number
	LEFT JOIN tr_baogia_chiphi_veneer C ON A.veneer_matchinh = C.id
	LEFT JOIN tr_baogia_chiphi_veneer D ON A.veneer_matphu = D.id
	LEFT JOIN tr_baogia_chiphi_veneer E ON A.veneer_dan_canh = E.id
	WHERE A.nguyenlieu IN (SELECT nguyenlieu FROM @TB_NGUYENLIEU)
	ORDER BY B.order_number, A.masp

	DROP TABLE #DONHANG_SANXUAT;
END

