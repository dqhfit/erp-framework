-- PARAMS:
-- @id uniqueidentifier
-- @nguongoc nvarchar
-- @dayy nvarchar
-- @rong nvarchar
-- @dai nvarchar
-- @sothanh float
-- @sokhoi float

CREATE PROC [dbo].[TR_DEXUAT_PHOI_CHITIET_NGUONGOC]
(
	@id uniqueidentifier,
	@nguongoc nvarchar(500),
	@dayy nvarchar(500),
	@rong nvarchar(500),
	@dai nvarchar(500),
	@sothanh float,
	@sokhoi float
)
AS
DECLARE @nguongoc_giao nvarchar(max)

DECLARE @dayy_giao nvarchar(max)
DECLARE @rong_giao nvarchar(max)
DECLARE @dai_giao nvarchar(max)

DECLARE @sothanh_giao float
DECLARE @sokhoi_giao float

SELECT @nguongoc_giao = nguongoc_giao, @sothanh_giao = sothanh_giao,@sokhoi_giao = sokhoi_giao,
	@dayy_giao = dayy_giao, @rong_giao = rong_giao, @dai_giao = dai_giao
FROM tr_dexuat_phoi_chitiet WHERE id = @id
IF(@nguongoc_giao = '')
BEGIN
	UPDATE tr_dexuat_phoi_chitiet
	SET 
		nguongoc_giao = @nguongoc,
		dayy_giao = @dayy,
		rong_giao = @rong,
		dai_giao = @dai,
		sothanh_giao = @sothanh_giao + @sothanh,
		sokhoi_giao = @sokhoi_giao + @sokhoi
	WHERE id = @id
END
ELSE
BEGIN
	UPDATE tr_dexuat_phoi_chitiet
	SET nguongoc_giao = CONCAT(@nguongoc_giao,'-',@nguongoc),
		dayy_giao = CONCAT(@dayy_giao,'-',@dayy),
		rong_giao = CONCAT(@rong_giao,'-',@rong),
		dai_giao = CONCAT(@dai_giao,'-',@dai),
		sothanh_giao = @sothanh_giao + @sothanh,
		sokhoi_giao = @sokhoi_giao + @sokhoi
	WHERE id = @id
END



