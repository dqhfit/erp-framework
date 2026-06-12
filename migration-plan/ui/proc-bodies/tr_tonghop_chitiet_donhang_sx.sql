-- PARAMS:
-- @madonhang nvarchar


CREATE PROC [dbo].[TR_TONGHOP_CHITIET_DONHANG_SX](@madonhang nvarchar(max))
AS
BEGIN
	DECLARE @tb_donhang TABLE
	(
		donhang nvarchar(200),
		masp nvarchar(200),
		soluong_donhang int
	)

	INSERT INTO @tb_donhang(donhang, masp, soluong_donhang)
	SELECT A.order_number, B.item_number, SUM(B.order_qty) AS order_qty
	FROM tr_order A
		INNER JOIN tr_order_detail B ON A.order_number = B.order_number
	WHERE A.choduyet = 1 AND A.f_cancelled = 'N'
		AND B.f_cancelled = 'N'
		AND A.order_number IN (SELECT LTRIM(RTRIM([value])) FROM dbo.fn_Split(@madonhang, ','))
	GROUP BY A.order_number, B.item_number

	SELECT A.*, B.donhang, B.soluong_donhang,
		tongsoluong = A.soluong_tc * B.soluong_donhang,
		VNC.loaihang AS tenveneer_matchinh,
		VNP.loaihang AS tenveneer_matphu,
		VNDC.loaihang AS tenveneer_dan_canh,
		CASE 
			WHEN A.dai_tc > 0 AND A.dai_tc <= 999 THEN N'Ngắn'
			WHEN A.dai_tc >= 1000 AND A.dai_tc <= 1599 THEN N'Trung'
			WHEN A.dai_tc >= 1600 THEN N'Dài'
		END AS loaichitiet
	FROM tr_dinhmuc_govan A
		INNER JOIN @tb_donhang B ON A.masp = B.masp
		LEFT JOIN tr_baogia_chiphi_veneer VNC ON A.veneer_matchinh = VNC.id
		LEFT JOIN tr_baogia_chiphi_veneer VNP ON A.veneer_matphu = VNP.id
		LEFT JOIN tr_baogia_chiphi_veneer VNDC ON A.veneer_dan_canh = VNDC.id
	WHERE A.nguyenlieu NOT IN ('', '0')
		AND mact <> '000'
END

