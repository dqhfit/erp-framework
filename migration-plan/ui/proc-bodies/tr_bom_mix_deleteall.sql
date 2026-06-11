-- PARAMS:
-- @mact_mix nvarchar


CREATE PROC TR_BOM_MIX_DELETEALL(@mact_mix nvarchar(100))
AS
DELETE tr_bom_mix
WHERE mact_mix = @mact_mix

