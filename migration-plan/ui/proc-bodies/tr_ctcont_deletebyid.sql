-- PARAMS:
-- @id int

CREATE   PROCEDURE TR_CTCONT_DELETEBYID
(
	@id int
)
AS
BEGIN
	DELETE tr_ctcont
	WHERE id = @id
END

