-- PARAMS:
-- @id uniqueidentifier


CREATE PROC TR_DINHMUC_VATTU_TIEUHAO_DELETEBYID(@id uniqueidentifier)
AS
BEGIN
	DELETE tr_dinhmuc_vattu_tieuhao
	WHERE id = @id
END

