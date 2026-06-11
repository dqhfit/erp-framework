-- PARAMS:
-- @id_baocao uniqueidentifier


CREATE PROC TR_BAOCAO_CHUYENSON_HIENDIEN_DELETEALL (@id_baocao uniqueidentifier)
AS
BEGIN
	DELETE tr_baocao_chuyenson_hiendien WHERE id_baocao = @id_baocao
END

