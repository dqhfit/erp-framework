-- PARAMS:
-- @id uniqueidentifier


CREATE PROC TR_BAOCAO_HANGLOI_HOANTHANH(@id uniqueidentifier)
AS
BEGIN
	UPDATE tr_baocao_hangloi
	SET daxuly = 1
	WHERE id = @id
END

