-- PARAMS:
-- @id uniqueidentifier

CREATE PROC TR_DEXUAT_BANGMAU_CANCEL(@id uniqueidentifier)
AS
UPDATE tr_dexuat_bangmau_chitiet
SET active = 0
WHERE dexuat_id = @id

UPDATE tr_dexuat_bangmau
SET active = 0
WHERE id = @id
