-- PARAMS:
-- @id uniqueidentifier
-- @nguoiduyet nvarchar


CREATE PROC [dbo].[TR_BAOCAO_HANGLOI_DUYET](@id uniqueidentifier, @nguoiduyet nvarchar(50))
AS
BEGIN
	UPDATE tr_baocao_hangloi
	SET nguoiduyet = @nguoiduyet
	WHERE id = @id
END

