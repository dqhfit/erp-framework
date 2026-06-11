-- PARAMS:
-- @baoGiaID uniqueidentifier


CREATE   PROCEDURE [dbo].[TR_BAOGIA_HTR_GOVAN_DELETEALL]
(
	@baoGiaID uniqueidentifier
)
AS
DELETE tr_baogia_htr_govan
WHERE baoGiaID = @baoGiaID


