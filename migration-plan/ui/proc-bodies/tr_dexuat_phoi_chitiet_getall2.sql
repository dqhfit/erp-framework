-- PARAMS:
-- @dexuat_id uniqueidentifier

CREATE PROC [dbo].[TR_DEXUAT_PHOI_CHITIET_GETALL2](@dexuat_id uniqueidentifier)
AS
SELECT *,CONCAT(dayy_yc,'*',rong_yc, '*', dai_yc) as quycach
FROM tr_dexuat_phoi_chitiet
WHERE dexuat_id = @dexuat_id and IsCancel = 0 



