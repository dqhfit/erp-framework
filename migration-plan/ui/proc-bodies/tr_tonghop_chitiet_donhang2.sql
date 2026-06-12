-- PARAMS:
-- @donhang nvarchar
-- @dinhmuc nvarchar
-- @loaicapphat nvarchar
-- @masp nvarchar


CREATE PROC [dbo].[TR_TONGHOP_CHITIET_DONHANG2]
(
	@donhang nvarchar(50),
	@dinhmuc nvarchar(10),
	@loaicapphat nvarchar(50),
	@masp nvarchar(max)
)
AS
BEGIN
	SELECT A.order_number, B.item_number, B.order_qty
	INTO #DONHANG
	FROM tr_order A
		INNER JOIN tr_order_detail B ON A.order_number = B.order_number
	WHERE A.order_number = @donhang AND B.f_cancelled = 'N'

	DECLARE @LENHCAPPHAT TABLE
	(
		donhang nvarchar(200),
		masp nvarchar(200),
		mavt nvarchar(200),
		soluong_can float
	)

	IF @dinhmuc = 'NKI'
	BEGIN
		INSERT INTO @LENHCAPPHAT(donhang, masp, mavt, soluong_can)
		SELECT C.order_number, A.masp, A.mavt, 
			soluong_can = SUM(A.soluong * C.order_qty)
		FROM tr_dinhmuc_ngukim A
			INNER JOIN #DONHANG C ON A.masp = C.item_number
		WHERE 
			CASE 
				WHEN @loaicapphat = 'TRUOCSON' THEN A.HWforWW 
				WHEN @loaicapphat = 'SAUSON' THEN A.HWforPacking
				WHEN @loaicapphat = 'AI' THEN A.HWforAI
			END = 1
		GROUP BY C.order_number, A.masp, A.mavt
	END
	ELSE IF @dinhmuc = 'DGO'
	BEGIN
		INSERT INTO @LENHCAPPHAT(donhang, masp, mavt, soluong_can)
		SELECT C.order_number, A.masp, A.madonggoi, soluong_can = SUM(A.soluong * C.order_qty)
		FROM tr_dinhmuc_donggoi A
			INNER JOIN #DONHANG C ON A.masp = C.item_number
		GROUP BY C.order_number, A.masp, A.madonggoi
	END

	IF LEN(@masp) > 0
	BEGIN
		SELECT A.*, B.mota, B.quycach, B.mausac, B.dvt, B.nhom, 
		CASE 
			WHEN B.giatri_quydoi > 0 AND LEN(B.dvt_quydoi) > 0 THEN CONCAT(FORMAT(A.soluong_can * B.giatri_quydoi, '#,0.###'), ' ', B.dvt_quydoi)
			ELSE NULL
		END
		FROM @LENHCAPPHAT A
			INNER JOIN tr_material B ON A.mavt = B.mavt
		WHERE A.masp IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@masp, ','))
		ORDER BY A.masp, B.mota
	END
	ELSE
	BEGIN
		SELECT A.*, B.mota, B.quycach, B.mausac, B.dvt, B.nhom,
		CASE 
			WHEN B.giatri_quydoi > 0 AND LEN(B.dvt_quydoi) > 0 THEN CONCAT(FORMAT(A.soluong_can * B.giatri_quydoi, '#,0.###'), ' ', B.dvt_quydoi)
			ELSE NULL
		END as ghichu
		FROM @LENHCAPPHAT A
			INNER JOIN tr_material B ON A.mavt = B.mavt
		ORDER BY A.masp, B.mota
	END
	DROP TABLE #DONHANG;
END

