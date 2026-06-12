-- PARAMS:
-- @madonhang nvarchar
-- @columnName nvarchar
-- @lansanxuat int

CREATE PROC [dbo].[PS_KEHOACH_DONHANG_GETBYCOLUMN]
(
	@madonhang nvarchar(200),
	@columnName nvarchar(200),
    @lansanxuat int = 1
)
AS
BEGIN
	--SELECT A.*, B.ten, B.stt
	--FROM (SELECT * FROM ps_kehoach_donhang WHERE madonhang = @madonhang AND columnName = @columnName) A
	--	FULL JOIN (SELECT ma, ten, stt FROM tr_common WHERE phanloai = 9) B ON A.typeID = B.ma
	--ORDER BY B.stt	
	SELECT A.id, 
		COALESCE(a.madonhang, @madonhang) as madonhang, 
		COALESCE(a.typeID, B.ma) as typeID, 
		COALESCE(a.columnName, @columnName) AS columnName, 
        COALESCE(A.lansanxuat, @lansanxuat) AS lansanxuat,
		a.ngaykehoach, a.dondathang, B.ten, B.stt
	INTO #KEHOACH
	FROM (SELECT * FROM ps_kehoach_donhang WHERE madonhang = @madonhang AND columnName = @columnName AND lansanxuat = @lansanxuat) A
		FULL JOIN (SELECT ma, ten, stt FROM tr_common WHERE phanloai = 9) B ON A.typeID = B.ma
	--ORDER BY B.stt	
	SELECT * FROM #KEHOACH
	ORDER BY stt
END
