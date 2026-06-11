-- PARAMS:
-- @id uniqueidentifier


CREATE PROC TR_KEHOACH_HANGTRANG3_DELETEBYID(@id uniqueidentifier)
AS
BEGIN
	DELETE tr_kehoach_hangtrang3 WHERE id = @id;
END

