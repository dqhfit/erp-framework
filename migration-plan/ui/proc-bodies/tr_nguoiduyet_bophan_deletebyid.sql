-- PARAMS:
-- @id uniqueidentifier


CREATE PROC TR_NGUOIDUYET_BOPHAN_DELETEBYID(@id uniqueidentifier)
AS
BEGIN
	DELETE tr_nguoiduyet_bophan
	WHERE id = @id
END

