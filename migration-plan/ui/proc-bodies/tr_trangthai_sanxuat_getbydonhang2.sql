-- PARAMS:
-- @madonhang nvarchar



CREATE PROC [dbo].[TR_TRANGTHAI_SANXUAT_GETBYDONHANG2]
(
	@madonhang nvarchar(50)
)
AS
BEGIN
	DECLARE @columns nvarchar(MAX) = ''
	DECLARE @sql nvarchar(MAX) = ''

	SELECT @columns += QUOTENAME(c_location) + ',' 
	FROM trtb_m_location
	WHERE isShow = 1 AND active = 1
	ORDER BY c_op, stt

	SET @columns = LEFT(@columns, LEN(@columns) - 1)

	SELECT A.madonhang, A.masp, A.masp1, A.stt, A.mact, A.tenct,
		A.nguyenlieu, A.dayy, A.rong, A.dai, 
		soluong = CASE WHEN process_type = 'IN' AND A.ngaygiao IS NULL THEN 0 ELSE A.soluong END, 
		A.soluong_can,
		A.congdoan, A.isCreateCard
	INTO #TRANGTHAI_SANXUAT
	FROM (
	SELECT madonhang = ISNULL(B.dondathang, A.madonhang), 
			masp = ISNULL(B.mahtr, A.masp), 
			masp1 = ISNULL(B.masp, A.masp1), 
			B.stt,
			mact = ISNULL(B.mact, A.mact), 
			tenct = ISNULL(B.tenct, A.tenct),
			nguyenlieu = ISNULL(B.nguyenlieu, A.nguyenlieu),
			dayy = ISNULL(B.dayy_tc, A.dayy), 
			rong = ISNULL(B.rong_tc, A.rong), 
			dai = ISNULL(B.dai_tc, A.dai), 
			soluong = CAST(ISNULL(A.soluong, 0) AS int),
			B.soluong_can,
			A.congdoan,
			process_type = IIF(COALESCE(A.congdoan, '') = '', NULL, SUBSTRING(A.congdoan, CHARINDEX('-', A.congdoan) + 1, LEN(A.congdoan))),
			B.isCreateCard, A.ngaygiao
	FROM (SELECT * FROM tr_trangthai_sanxuat WHERE pcard IS NOT NULL AND madonhang = @madonhang) A
		RIGHT JOIN (SELECT * FROM tr_pallet WHERE dondathang = @madonhang AND active = 1 AND isCreateCard = 1) B ON A.madonhang = B.dondathang AND A.masp1 = B.masp AND A.mact = B.mact
	) A

	SET @sql = '
	SELECT * FROM (
		SELECT * FROM #TRANGTHAI_SANXUAT
	) T PIVOT (
		SUM(soluong)
		FOR congdoan IN (' + @columns + ')
	) as pt
	ORDER BY pt.masp, pt.stt'

	EXECUTE sp_executesql @sql;

	DROP TABLE #TRANGTHAI_SANXUAT;
END

