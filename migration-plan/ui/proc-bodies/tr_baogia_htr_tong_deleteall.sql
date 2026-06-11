-- PARAMS:
-- @baoGiaID uniqueidentifier


CREATE   PROCEDURE [dbo].[TR_BAOGIA_HTR_TONG_DELETEALL]
(	@baoGiaID uniqueidentifier
)
AS
DELETE tr_baogia_htr_tong
WHERE baoGiaID = @baoGiaID

