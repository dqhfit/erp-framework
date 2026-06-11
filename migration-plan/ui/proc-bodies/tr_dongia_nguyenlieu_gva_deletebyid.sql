-- PARAMS:
-- @id int

CREATE PROC [dbo].[TR_DONGIA_NGUYENLIEU_GVA_DELETEBYID](@id int)
AS
BEGIN
	DELETE tr_dongia_nguyenlieu_gva WHERE id = @id
END

