-- PARAMS:
-- @id uniqueidentifier

CREATE PROC TR_THAYDOI_KYTHUAT_CANCEL(@id uniqueidentifier)
AS
UPDATE tr_thaydoi_kythuat
SET active = 0
WHERE id = @id
