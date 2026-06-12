-- PARAMS:
-- @orderNumber nvarchar
-- @itemNumber nvarchar


CREATE PROC [dbo].[TR_TONGHOP_CHITIET_DONHANG]
(
	@orderNumber nvarchar(max),
	@itemNumber nvarchar(max)
)
AS
BEGIN
	DECLARE @DONHANG_SANXUAT table
	(
		madonhang nvarchar(200),
		masp nvarchar(200),
		soluong_donhang int
	)

	IF LEN(@itemNumber) > 0
	BEGIN
		INSERT INTO @DONHANG_SANXUAT(madonhang, masp, soluong_donhang)
		SELECT A.order_number, B.item_number, SUM(B.order_qty)
		FROM tr_order A
			INNER JOIN tr_order_detail B ON A.order_number = B.order_number
		WHERE A.order_number IN (SELECT LTRIM(RTRIM([value])) FROM dbo.fn_Split(@orderNumber, ','))
			AND B.item_number IN (SELECT LTRIM(RTRIM([value])) FROM dbo.fn_Split(@itemNumber, ','))
		GROUP BY A.order_number, B.item_number
	END
	ELSE
	BEGIN
		INSERT INTO @DONHANG_SANXUAT(madonhang, masp, soluong_donhang)
		SELECT A.order_number, B.item_number, SUM(B.order_qty)
		FROM tr_order A
			INNER JOIN tr_order_detail B ON A.order_number = B.order_number
		WHERE A.order_number IN (SELECT LTRIM(RTRIM([value])) FROM dbo.fn_Split(@orderNumber, ','))
		GROUP BY A.order_number, B.item_number
	END

	SELECT A.madonhang, A.masp, A.soluong_donhang,
		B.mact, B.stt, B.chitiet, B.nguyenlieu, 
		B.dayy_tc, B.rong_tc, B.dai_tc, B.soluong_tc,
		m3_tc = CASE 
				WHEN ISNULL(B.nguyenlieu,'') <> '' AND ISNULL(B.nguyenlieu,'') <> '0' 
				THEN (B.dayy_tc * B.rong_tc * B.dai_tc * B.soluong_tc) / 1000000000
				ELSE 0
			END,
		B.ghichu
	FROM @DONHANG_SANXUAT A
		INNER JOIN tr_dinhmuc_govan B ON A.masp = B.masp
	WHERE B.mact NOT IN ('000', '')
	ORDER BY A.madonhang, A.masp, B.stt
END


