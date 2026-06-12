-- PARAMS:
-- @dondathang nvarchar
-- @columnName nvarchar
-- @lansanxuat int

CREATE PROC [dbo].[PS_KEHOACH_DONHANG_GETBYCOLUMN_DDH]
(
	@dondathang nvarchar(200),
	@columnName nvarchar(200),
    @lansanxuat int = 1
)
AS
BEGIN
	SELECT A.id, 
		COALESCE(a.dondathang, @dondathang) as madonhang, 
		COALESCE(a.typeID, B.ma) as typeID, 
		COALESCE(a.columnName, @columnName) AS columnName, 
        COALESCE(A.lansanxuat, @lansanxuat) AS lansanxuat,
		a.ngaykehoach, a.dondathang, B.ten, B.stt
	INTO #KEHOACH
	FROM (SELECT * FROM ps_kehoach_donhang WHERE dondathang = @dondathang AND columnName = @columnName AND lansanxuat = @lansanxuat) A
		FULL JOIN (SELECT ma, ten, stt FROM tr_common WHERE phanloai = 9) B ON A.typeID = B.ma
	--ORDER BY B.stt	
	SELECT * FROM #KEHOACH
	ORDER BY stt
END
