-- PARAMS:
-- @id uniqueidentifier

CREATE PROCEDURE [dbo].[TR_PHIEUYEUCAU_CANCEL2](@id uniqueidentifier)
AS
BEGIN
	UPDATE tr_phieuyeucau_chitiet
	SET active = 0
	WHERE phieuyeucau_id = @id

	UPDATE tr_phieuyeucau
	SET active = 0
	WHERE id = @id
END
