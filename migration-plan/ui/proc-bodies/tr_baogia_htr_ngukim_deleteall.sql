-- PARAMS:
-- @baoGiaID uniqueidentifier


CREATE   PROCEDURE [dbo].[TR_BAOGIA_HTR_NGUKIM_DELETEALL]
(	@baoGiaID uniqueidentifier
)
AS
DELETE tr_baogia_htr_ngukim
WHERE baoGiaID = @baoGiaID



