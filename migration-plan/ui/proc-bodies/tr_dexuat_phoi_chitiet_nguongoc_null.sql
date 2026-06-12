-- PARAMS:
-- @id uniqueidentifier

CREATE PROC [dbo].[TR_DEXUAT_PHOI_CHITIET_NGUONGOC_NULL]
(
	@id uniqueidentifier	
)
AS
UPDATE tr_dexuat_phoi_chitiet
	SET 
		nguongoc_giao = '',
		dayy_giao = '',
		rong_giao = '',
		dai_giao = '',
		sothanh_giao = 0,
		sokhoi_giao = 0 
	WHERE id = @id


