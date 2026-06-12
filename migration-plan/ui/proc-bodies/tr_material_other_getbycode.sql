-- PARAMS:
-- @mact nvarchar

--------------------------------------------------
CREATE PROCEDURE TR_MATERIAL_OTHER_GETBYCODE(@mact nvarchar(50))
AS
SELECT * FROM tr_material_other
WHERE mact = @mact
