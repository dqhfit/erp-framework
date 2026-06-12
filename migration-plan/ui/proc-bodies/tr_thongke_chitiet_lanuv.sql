-- PARAMS:
-- @madonhang nvarchar


CREATE PROC [dbo].[TR_THONGKE_CHITIET_LANUV](@madonhang nvarchar(200))
AS
BEGIN
	DECLARE @DONHANG_TEMP TABLE
	(
		masp nvarchar(200),
		soluong int
	)
	INSERT INTO @DONHANG_TEMP(masp, soluong)
	SELECT B.item_number, B.order_qty
	FROM tr_order A
	INNER JOIN tr_order_detail B ON A.order_number = B.order_number
	WHERE A.order_number = @madonhang


	SELECT A.masp, B.mact, B.stt, B.chitiet, B.nguyenlieu,
		B.dayy_tc, B.rong_tc, B.dai_tc, B.soluong_tc,
		soluong_donhang = A.soluong * B.soluong_tc,
		B.fsc_id, 
		COALESCE(FSC.fsc_name, 'Non FSC') AS fsc_name,
		B.uv_matchinh1, UVMC.loai_uv AS loai_uv_matchinh1, 
		B.uv_matphu1, UVMP.loai_uv AS loai_uv_matphu1,
		B.uv_canhdai1, UVCD.loai_uv AS loai_uv_canhdai1, 
		B.uv_canhngan1, UVCN.loai_uv AS loai_uv_canhngan1,
		B.ghichu, B.uv_code
	FROM @DONHANG_TEMP A
	INNER JOIN tr_dinhmuc_govan B ON A.masp = B.masp
	LEFT JOIN tr_tinhtrang_fsc FSC ON B.fsc_id = FSC.fsc_id
	LEFT JOIN tr_loai_uv UVMC ON B.uv_matchinh1 = UVMC.id
	LEFT JOIN tr_loai_uv UVMP ON B.uv_matphu1 = UVMP.id
	LEFT JOIN tr_loai_uv UVCD ON B.uv_canhdai1 = UVCD.id
	LEFT JOIN tr_loai_uv UVCN ON B.uv_canhngan1 = UVCN.id
	WHERE B.uv_matchinh1 IS NOT NULL
		OR B.uv_matphu1 IS NOT NULL
		OR B.uv_canhdai1 IS NOT NULL
		OR B.uv_canhngan1 IS NOT NULL
	ORDER BY A.masp, B.stt
END

