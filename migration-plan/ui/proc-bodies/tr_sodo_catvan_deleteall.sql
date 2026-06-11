-- PARAMS:
-- @head_id uniqueidentifier


CREATE PROC TR_SODO_CATVAN_DELETEALL
(
	@head_id uniqueidentifier
)
AS
BEGIN
	DELETE tr_sodo_catvan WHERE head_id = @head_id
END

