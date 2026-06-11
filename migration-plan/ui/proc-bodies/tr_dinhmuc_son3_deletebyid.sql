-- PARAMS:
-- @id uniqueidentifier


CREATE   PROC TR_DINHMUC_SON3_DELETEBYID(@id uniqueidentifier)
AS
DELETE tr_dinhmuc_son3
WHERE id = @id

