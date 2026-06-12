-- PARAMS:
-- @maddh nvarchar

CREATE PROC [dbo].[TR_DONDATHANG_GET3](@maddh NVARCHAR(50))
AS
BEGIN
	SELECT * FROM tr_dondathang
	WHERE maddh = @maddh
END
