-- PARAMS:
-- @trangthai int


CREATE PROC [dbo].[TR_KEHOACH_GIAOHANG_GETLISTBYSTATUS](@trangthai int)
AS
IF @trangthai = 0
BEGIN
    SELECT * FROM tr_kehoach_giaohang
    WHERE ISNULL(trangthai, 0) IN (0, 1)
    ORDER BY ketthuc, batdau, ngaygiaohang
END
ELSE
BEGIN
    SELECT * FROM tr_kehoach_giaohang
    WHERE ISNULL(trangthai, 0) = @trangthai
    ORDER BY ketthuc, batdau, ngaygiaohang
END

