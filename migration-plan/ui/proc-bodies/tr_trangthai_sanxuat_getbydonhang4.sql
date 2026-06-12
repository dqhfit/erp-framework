-- PARAMS:
-- (khong co tham so)



CREATE   PROC [dbo].[TR_TRANGTHAI_SANXUAT_GETBYDONHANG4]
AS
BEGIN
	DECLARE @columns nvarchar(MAX) = ''
	DECLARE @sql nvarchar(MAX) = ''

	SELECT @columns += QUOTENAME(c_location) + ',' 
	FROM trtb_m_location_process
	ORDER BY c_op, stt

	SET @columns = LEFT(@columns, LEN(@columns) - 1)

	SELECT A.maddh
	INTO #DONDATHANG
	FROM tr_dondathang A
		INNER JOIN tr_dondathang_chitiet B ON A.maddh = B.maddh
	WHERE A.trangthai IN ('0', '1', '2') AND B.chitiet LIKE 'W%'
		AND A.active = 1
	GROUP BY A.maddh

	SELECT dondathang, SUM(soluong_can) AS soluong_can
	INTO #PALLET
	FROM tr_pallet A
	WHERE A.active = 1 AND A.isCreateCard = 1 AND A.dondathang IN (SELECT maddh FROM #DONDATHANG)
	GROUP BY dondathang

	SELECT madonhang, congdoan, SUM(soluong) AS soluong_hoanthanh
	INTO #SANXUAT
	FROM tr_trangthai_sanxuat A
	WHERE A.madonhang IN (SELECT maddh FROM #DONDATHANG) AND pcard IS NOT NULL
	GROUP BY madonhang, congdoan

	SET @sql = '
	SELECT * FROM (
	SELECT B.madonhang, B.congdoan, A.soluong_can, B.soluong_hoanthanh
	FROM #PALLET A
		INNER JOIN #SANXUAT B ON A.dondathang = B.madonhang
	) T
	PIVOT (
		SUM(soluong_hoanthanh)
		FOR congdoan IN (' + @columns + ')
	) as PT'

	EXECUTE sp_executesql @sql;
	DROP TABLE #DONDATHANG, #PALLET, #SANXUAT;

END

