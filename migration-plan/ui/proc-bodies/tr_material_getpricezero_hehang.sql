-- PARAMS:
-- @hehang nvarchar


CREATE PROC TR_MATERIAL_GETPRICEZERO_HEHANG(@hehang nvarchar(200))
AS
BEGIN
	SELECT B.mavt, C.mota, C.quycach, C.mausac, C.dvt, C.dongia, C.loaitien
	INTO #VATTU_NGUKIM
	FROM tr_sanpham A
		INNER JOIN tr_dinhmuc_ngukim B ON A.masp = B.masp
		INNER JOIN tr_material C ON B.mavt = C.mavt
	WHERE A.hehang = @hehang AND C.dongia <= 0
	GROUP BY B.mavt, C.mota, C.quycach, C.mausac, C.dvt, C.dongia, C.loaitien

	SELECT B.madonggoi, C.mota, C.quycach, C.mausac, C.dvt, C.dongia, C.loaitien
	INTO #VATTU_DONGGOI
	FROM tr_sanpham A
		INNER JOIN tr_dinhmuc_donggoi B ON A.masp = B.masp
		INNER JOIN tr_material C ON B.madonggoi = C.mavt
	WHERE A.hehang = @hehang AND C.dongia <= 0
	GROUP BY B.madonggoi, C.mota, C.quycach, C.mausac, C.dvt, C.dongia, C.loaitien

	SELECT mavt, mota, quycach, mausac, dvt, dongia, loaitien FROM #VATTU_NGUKIM
	UNION
	SELECT madonggoi, mota, quycach, mausac, dvt, dongia, loaitien FROM #VATTU_DONGGOI

	DROP TABLE #VATTU_NGUKIM
	DROP TABLE #VATTU_DONGGOI

END

