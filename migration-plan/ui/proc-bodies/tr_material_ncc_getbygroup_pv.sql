-- PARAMS:
-- @nhom nvarchar


CREATE   PROC TR_MATERIAL_NCC_GETBYGROUP_PV(@nhom nvarchar(max))
AS
BEGIN
	SELECT A.*, B.mota, B.quycach, B.mausac
	INTO #MATERIAL_NCC
	FROM tr_material_ncc A 
		INNER JOIN tr_material B ON A.Ma_NVL = B.mavt
	WHERE A.TuNgay = (SELECT MAX(TuNgay) FROM tr_material_ncc WHERE Ma_NCC = A.Ma_NCC)
		AND LEN(Ma_NCC) > 0 AND B.xoa = 'N'
		AND B.nhom IN (SELECT LTRIM(RTRIM([value])) FROM STRING_SPLIT(@nhom, ','))
		

	DECLARE @columns nvarchar(max);
	DECLARE @sql nvarchar(max);

	SELECT @columns = COALESCE(@columns + ',', '') + QUOTENAME(Ma_NCC) 
	FROM #MATERIAL_NCC
	GROUP BY Ma_NCC

	SET @sql = '
	SELECT * FROM (
	SELECT A.Ma_NCC, A.Ma_NVL, A.mota, A.quycach, A.mausac, A.DonGia
	FROM #MATERIAL_NCC A
	) AS T
	PIVOT (
		MAX(DonGia)
		FOR Ma_NCC IN (' + @columns + ')
	) AS PT '

	EXEC sp_executesql @sql
	DROP TABLE #MATERIAL_NCC;
END
