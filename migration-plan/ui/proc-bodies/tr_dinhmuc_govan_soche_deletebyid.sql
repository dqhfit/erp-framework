-- PARAMS:
-- @id uniqueidentifier

CREATE PROC TR_DINHMUC_GOVAN_SOCHE_DELETEBYID
(
	@id uniqueidentifier
)
AS
DELETE tr_dinhmuc_govan_soche
WHERE id = @id
