-- PARAMS:
-- @id uniqueidentifier


CREATE PROC SAL_BAOGIA_GOVAN_CHITIET_DELETEBYID(@id uniqueidentifier)
AS
BEGIN
	DELETE sal_baogia_govan_chitiet
	WHERE id = @id
END

