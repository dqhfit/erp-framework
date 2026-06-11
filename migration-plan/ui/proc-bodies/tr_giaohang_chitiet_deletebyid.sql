-- PARAMS:
-- @id uniqueidentifier


CREATE PROC TR_GIAOHANG_CHITIET_DELETEBYID (@id UNIQUEIDENTIFIER)
AS
BEGIN
	DELETE tr_giaohang_chitiet WHERE id = @id
END

