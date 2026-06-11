-- PARAMS:
-- @id uniqueidentifier


CREATE PROC TR_DINHMUC_SON3_MAUSON_DELETEBYID(@id uniqueidentifier)
AS
BEGIN
	DELETE tr_dinhmuc_son3_mauson
	WHERE id = @id
END

