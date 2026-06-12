-- PARAMS:
-- @madonhang nvarchar

CREATE   PROCEDURE TR_THONGKE_SON_CHITIET_GETBYORDER
(
	@madonhang nvarchar(max)
)
AS
BEGIN

	--DECLARE @madonhang nvarchar(max) = 'VF-0012-1';
	SELECT macongdoan, madonhang, masp, mact, SUM(soluong) AS soluong
	INTO #THONGKE_SOLUONG
	FROM tr_thongke_son_chitiet A
	WHERE A.madonhang IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@madonhang, ','))
	GROUP BY  macongdoan, madonhang, masp, mact

	SELECT A.order_number, B.masp, B.mact, B.stt, B.chitiet, B.nguyenlieu, B.id_nguyenlieu,
		B.dayy_tc, B.rong_tc, B.dai_tc, 
		soluong = B.soluong_tc * A.order_qty
	INTO #DONHANG
	FROM tr_order_detail A
		INNER JOIN tr_dinhmuc_govan B ON A.item_number = B.masp
	WHERE A.f_cancelled = 'N'
		AND A.order_number IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@madonhang, ','))
	ORDER BY A.order_number, B.masp, B.stt

	SELECT B.order_number AS madonhang, B.masp, B.mact, B.stt, 
		B.chitiet AS tenct, B.nguyenlieu, B.dayy_tc, B.rong_tc, B.dai_tc,
		soluong_can = B.soluong,
		soluong_hoanthanh = A.soluong,
		soluong_conlai = B.soluong - COALESCE(A.soluong, 0)
	FROM #THONGKE_SOLUONG A
		RIGHT JOIN #DONHANG B ON A.madonhang = B.order_number AND A.masp = B.masp AND A.mact = B.mact
	ORDER BY B.order_number, B.masp, B.stt


	DROP TABLE #THONGKE_SOLUONG, #DONHANG;
END

