-- PARAMS:
-- @id uniqueidentifier
-- @huongxuly nvarchar


CREATE PROC TR_BAOCAO_HANGLOI_HUONGXULY
(
	@id uniqueidentifier,
	@huongxuly nvarchar(max)
)
AS
BEGIN
	UPDATE tr_baocao_hangloi
	SET huongxuly = @huongxuly
	WHERE id = @id
END


