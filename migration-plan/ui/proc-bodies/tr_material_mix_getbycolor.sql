-- PARAMS:
-- @mausac nvarchar


CREATE PROC TR_MATERIAL_MIX_GETBYCOLOR
(
    @mausac nvarchar(50)
)
AS
SELECT * FROM tr_material_mix
WHERE mausac = @mausac
