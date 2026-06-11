-- PARAMS:
-- @year int
-- @month int
-- @macongdoan nvarchar


CREATE   PROCEDURE [dbo].[TR_MUCTIEU_SANXUAT_DELETEALL](@year int, @month int, @macongdoan nvarchar(50))
AS
BEGIN
	DELETE tr_muctieu_sanxuat
	WHERE YEAR(ngaythang) = @year AND MONTH(ngaythang) = @month AND macongdoan = @macongdoan
END

