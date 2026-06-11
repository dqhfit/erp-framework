-- PARAMS:
-- @id uniqueidentifier


CREATE PROC TR_SODO_CATVAN_HEAD_DELETED(@id uniqueidentifier)
AS
BEGIN
	DELETE tr_sodo_catvan_head WHERE id = @id;
END

