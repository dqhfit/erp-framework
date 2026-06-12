-- PARAMS:
-- (khong co tham so)



CREATE   PROC [dbo].[TR_TRANGTHAI_SANXUAT_GETBYDONHANG5]
AS
BEGIN

	SELECT A.maddh, A.donhang, C.hehang, SUM(B.soluong * C.cbm) AS CBM
	INTO #DONDATHANG_HEHANG
	FROM tr_dondathang A
		INNER JOIN tr_dondathang_chitiet B ON A.maddh = B.maddh
		LEFT JOIN tr_sanpham C ON B.masp = C.masp
	WHERE A.trangthai IN ('0', '1', '2') AND B.chitiet LIKE 'W%'
		AND A.active = 1
	GROUP BY A.maddh, A.donhang, C.hehang;

	SELECT A.maddh, 
		STRING_AGG(A.donhang, ', ') AS donhang,
		STRING_AGG(A.hehang, ', ') AS hehang,
		SUM(A.CBM)/68 AS cont
	INTO #DONDATHANG
	FROM #DONDATHANG_HEHANG A
	GROUP BY A.maddh;

	SELECT dondathang, SUM(soluong_can) AS soluong_can
	INTO #PALLET
	FROM tr_pallet A
	WHERE A.active = 1 AND A.isCreateCard = 1 AND A.dondathang IN (SELECT maddh FROM #DONDATHANG)
	GROUP BY dondathang;

	SELECT madonhang, congdoan, SUM(soluong) AS soluong_hoanthanh
	INTO #SANXUAT
	FROM tr_trangthai_sanxuat A
	WHERE A.madonhang IN (SELECT maddh FROM #DONDATHANG) AND pcard IS NOT NULL
	GROUP BY madonhang, congdoan;

	SELECT madonhang, donhang, hehang, cont, [DP09-IN], [DP09-PROD], [DH06-IN], [DH06-PROD], [DH07-IN], [DH07-PROD]
	FROM (
		SELECT B.madonhang, C.donhang, C.hehang, C.cont, B.congdoan, 
			SUM(B.soluong_hoanthanh) OVER (PARTITION BY B.madonhang, C.donhang, C.hehang, C.cont, B.congdoan) / A.soluong_can AS phantram
		FROM #PALLET A
			INNER JOIN #SANXUAT B ON A.dondathang = B.madonhang
			INNER JOIN #DONDATHANG C ON A.dondathang = C.maddh
		--WHERE B.congdoan = 'DH07-IN'
		WHERE B.congdoan IN ('DP09-IN', 'DP09-PROD', 'DH06-IN', 'DH06-PROD', 'DH07-IN', 'DH07-PROD')
	) T
	PIVOT (
		SUM(phantram)
		FOR congdoan IN ([DP09-IN], [DP09-PROD], [DH06-IN], [DH06-PROD], [DH07-IN], [DH07-PROD])
	) AS PT;

	DROP TABLE #DONDATHANG_HEHANG, #DONDATHANG, #PALLET, #SANXUAT;
END


