-- PARAMS:
-- @congdoan nvarchar
-- @madonhang nvarchar


CREATE PROC [dbo].[TR_KEHOACH_HANGTRANG_CHITIET_DELETEALL](@congdoan nvarchar(50), @madonhang nvarchar(MAX))
AS
BEGIN
	UPDATE tr_kehoach_hangtrang_chitiet
	SET xacnhan = 1
	WHERE ngaythang < CAST(GETDATE() AS date)

	DELETE tr_kehoach_hangtrang_chitiet
	WHERE id_kehoach IN (
		SELECT id_kehoach FROM tr_kehoach_hangtrang 
		WHERE congdoan = @congdoan AND madonhang IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@madonhang,','))
			AND COALESCE(hoanthanh, 0) = 0 AND COALESCE(xacnhan, 0) = 0
	) AND COALESCE(xacnhan, 0) = 0
END

