-- PARAMS:
-- @madonhang nvarchar
-- @loaidonhang nvarchar


CREATE PROC [dbo].[TR_DONDATHANG_GETBYORDER]
(
	@madonhang nvarchar(max),
	@loaidonhang nvarchar(10)
)
AS
BEGIN
	SELECT B.order_number, B.item_number, c.tensp, A.fsc_id, SUM(order_qty) AS order_qty
	INTO #DONHANG_SANXUAT
	FROM tr_order A
		INNER JOIN tr_order_detail B ON A.order_number = B.order_number
		INNER JOIN tr_sanpham C ON B.item_number = C.masp
	WHERE B.f_cancelled = 'N' AND A.order_number IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@madonhang, ','))
	GROUP BY B.order_number, B.item_number, C.tensp, A.fsc_id

	IF @loaidonhang = 'NKI'
	BEGIN
		SELECT A.order_number, A.masp, B.nhom, A.mavt, B.mota, B.quycach, B.mausac, B.dvt, B.soluong1kg, B.mancc, 
			SUM(DISTINCT A.order_qty) AS soluong_donhang, 
			SUM(A.soluongcan) AS soluongcan,
			SUM(DISTINCT B.dongia) AS dongia, 
			SUM(A.soluongcan * B.dongia) AS thanhtien,
			B.loaitien, A.loaicapphat, NULL as ghichu
		FROM (
			SELECT A.order_number, B.masp, B.mavt, A.order_qty, B.soluong, B.soluong * A.order_qty AS soluongcan, 
				CASE 
					WHEN B.HWforAI = 1 THEN N'AI'
					WHEN B.HWforPacking = 1 THEN N'Sau sơn'
					WHEN B.HWforWW = 1 THEN N'Trước sơn'
				END AS loaicapphat
			FROM #DONHANG_SANXUAT A
				INNER JOIN tr_dinhmuc_ngukim B ON A.item_number = B.masp
		) A INNER JOIN tr_material B ON A.mavt = B.mavt
		GROUP BY A.order_number, A.masp, B.nhom, A.mavt, B.mota, B.quycach, B.mausac, B.dvt, B.soluong1kg, B.mancc, B.loaitien, A.loaicapphat
	END
	ELSE IF @loaidonhang = 'DGO'
	BEGIN
		SELECT A.order_number, A.masp, B.nhom, B.mavt, B.mota, B.quycach, B.mausac, B.dvt, B.soluong1kg, B.mancc, 
			SUM(DISTINCT A.order_qty) AS soluong_donhang, 
			SUM(A.soluongcan) AS soluongcan,
			SUM(DISTINCT B.dongia) AS dongia, 
			SUM(A.soluongcan * B.dongia) AS thanhtien,
			B.loaitien, A.loaicapphat, NULL as ghichu
		FROM (
			SELECT A.order_number, B.masp, B.madonggoi, A.order_qty, B.soluong, B.soluong * A.order_qty AS soluongcan, 
				N'Sau sơn' AS loaicapphat
			FROM #DONHANG_SANXUAT A
				INNER JOIN tr_dinhmuc_donggoi B ON A.item_number = B.masp
		) A INNER JOIN tr_material B ON A.madonggoi = B.mavt
		GROUP BY A.order_number, A.masp, B.nhom, B.mavt, B.mota, B.quycach, B.mausac, B.dvt, B.soluong1kg, B.mancc, B.loaitien, A.loaicapphat
	END
	ELSE IF @loaidonhang = 'SON'
	BEGIN
		SELECT A.order_number, A.masp, B.nhom, B.mavt, B.mota, B.quycach, B.mausac, B.dvt, B.soluong1kg, B.mancc,
			SUM(DISTINCT A.order_qty) AS soluong_donhang,
			SUM(A.soluongcan) AS soluongcan,
			SUM(DISTINCT B.dongia) AS dongia, 
			SUM(A.soluongcan * B.dongia) AS thanhtien,
			B.loaitien, A.loaicapphat, NULL as ghichu
		FROM (
		SELECT C.order_number, A.masp, A.mact, C.order_qty, (A.soluong * C.order_qty * B.metvuong) AS soluongcan, N'Trước sơn' AS loaicapphat
		FROM tr_dinhmuc_son3 A 
			INNER JOIN tr_dinhmuc_son3_metvuong B ON A.masp = B.masp AND A.matson = B.matson
			INNER JOIN #DONHANG_SANXUAT C ON A.masp = C.item_number
		) A INNER JOIN tr_material B ON A.mact = B.mavt
		GROUP BY A.order_number, A.masp, B.nhom, B.mavt, B.mota, B.quycach, B.mausac, B.dvt, B.soluong1kg, B.mancc, B.loaitien, A.loaicapphat
	END
	ELSE IF @loaidonhang = 'HTR'
	BEGIN
		SELECT A.order_number, A.fsc_id, B.masp, C.nhom, C.mavt, B.tensp AS mota, B.quycach, B.mausac, B.dvt, C.mancc,
			A.order_qty AS soluong_donhang,
			A.order_qty AS soluongcan,
			C.dongia,
			thanhtien = A.order_qty * C.dongia,
			C.loaitien, NULL AS loaicapphat, NULL as ghichu
		FROM (
		SELECT A.order_number, A.fsc_id, A.item_number, B.mact, A.order_qty
		FROM #DONHANG_SANXUAT A
			CROSS APPLY (SELECT TOP 1 * FROM tr_chitiet_hangtrang HT WHERE A.item_number = HT.masp ORDER BY HT.id DESC) AS B
		) A INNER JOIN tr_sanpham B ON A.item_number = B.masp
			INNER JOIN tr_material C ON A.mact = C.mavt

	END
	ELSE IF @loaidonhang = 'VENEER'
	BEGIN
		SELECT A.order_number, A.masp, B.nhom, B.mavt, B.mota, B.quycach, B.mausac, B.dvt, B.soluong1kg, B.mancc, 
			SUM(DISTINCT A.order_qty) AS soluong_donhang, 
			SUM(A.soluongcan) AS soluongcan,
			SUM(DISTINCT B.dongia) AS dongia, 
			SUM(A.soluongcan * B.dongia) AS thanhtien,
			B.loaitien, A.loaicapphat, NULL as ghichu
		FROM (
			SELECT A.order_number, B.masp, B.mact, A.order_qty, B.soluong, B.soluong * A.order_qty AS soluongcan, 
				N'Trước sơn' AS loaicapphat
			FROM #DONHANG_SANXUAT A
				INNER JOIN tr_dinhmuc_veneer B ON A.item_number = B.masp
		) A INNER JOIN tr_material B ON A.mact = B.mavt
		GROUP BY A.order_number, A.masp, B.nhom, B.mavt, B.mota, B.quycach, B.mausac, B.dvt, B.soluong1kg, B.mancc, B.loaitien, A.loaicapphat
	END
	ELSE IF @loaidonhang = 'PHOI'
	BEGIN
		SELECT A.order_number, B.masp, A.tensp, B.mact, B.chitiet, B.nguyenlieu, B.dayy_tc, B.rong_tc, B.dai_tc, 
			A.order_qty, B.soluong_tc, B.m3_tc,
			soluongcan = B.soluong_tc * A.order_qty,
			sokhoican = B.m3_tc * A.order_qty,
			NULL as ghichu
		FROM #DONHANG_SANXUAT A
			INNER JOIN tr_dinhmuc_govan B ON A.item_number = B.masp
		WHERE COALESCE(B.nguyenlieu, '') NOT IN ('', '0')
	END

	DROP TABLE #DONHANG_SANXUAT;

END

