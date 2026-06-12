-- PARAMS:
-- @donhang nvarchar
-- @uv int

CREATE   PROC [dbo].[TR_DINHMUC_SON3_MAUSON_GETBYORDER](@donhang nvarchar(MAX), @uv int = 0)
AS
BEGIN
	--SELECT B.mausac
	--INTO #DONHANG
	--FROM tr_order_detail A INNER JOIN tr_sanpham B ON A.item_number = B.masp
	--WHERE A.order_number IN (SELECT LTRIM(RTRIM([value])) FROM STRING_SPLIT(@donhang, ','))
	--GROUP BY B.mausac

	--SELECT A.*, B.mota, B.dongia, B.loaitien,
	--	tonghonhop1 = SUM(soluong) OVER (PARTITION BY stt_buoc, buoc)
	--FROM tr_dinhmuc_son3_mauson A
	--	INNER JOIN tr_material B ON A.mact = B.mavt
	--WHERE mamau IN (SELECT mausac FROM #DONHANG)
	--ORDER BY t_sort, stt_buoc, stt, buoc

	--DROP TABLE #DONHANG;
	SELECT A.item_number, B.mausac
	INTO #DONHANG
	FROM tr_order_detail A INNER JOIN tr_sanpham B ON A.item_number = B.masp
	WHERE A.order_number IN (SELECT LTRIM(RTRIM([value])) FROM STRING_SPLIT(@donhang, ','))
	GROUP BY A.item_number, B.mausac

	SELECT A.masp, A.matson
	INTO #MATSON
	FROM tr_dinhmuc_son3_metvuong A
	WHERE masp IN (SELECT item_number FROM #DONHANG) AND COALESCE(A.metvuong, 0) > 0
	GROUP BY A.masp, A.matson

	SELECT DISTINCT A.* 
	FROM (
		SELECT C.mausac, A.matson, D.ten AS tenmatson, A.stt_buoc, A.buoc, A.donhot, A.thoigiankho, A.cachthuchien,
			tonghonhop1 = 0 --SUM(soluong) OVER (PARTITION BY stt_buoc, buoc)
		FROM tr_dinhmuc_son3 A
			INNER JOIN tr_material B ON A.mact = B.mavt
			INNER JOIN #DONHANG C ON A.masp = C.item_number
			INNER JOIN #MATSON MS ON A.masp = MS.masp AND A.matson = MS.matson
			LEFT JOIN tr_common D ON A.matson = D.ma AND D.phanloai = 5
		WHERE CASE WHEN COALESCE(A.tinhtrang_uv, '') = '' THEN 0 ELSE 1 END = @uv
	) A
	ORDER BY A.matson, A.stt_buoc, buoc

	DROP TABLE #DONHANG, #MATSON;
END
