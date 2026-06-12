-- PARAMS:
-- @congdoan nvarchar
-- @madonhang nvarchar


CREATE PROC [dbo].[TR_KEHOACH_HANGTRANG_GETBYORDER](@congdoan nvarchar(50), @madonhang nvarchar(200))
AS
BEGIN
	SELECT * FROM tr_kehoach_hangtrang A
	WHERE A.madonhang = @madonhang AND A.congdoan = @congdoan
		AND A.ngaybatdau_sanxuat IS NOT NULL
END

