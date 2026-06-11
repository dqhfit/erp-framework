-- PARAMS:
-- @baoGiaID uniqueidentifier


CREATE   PROCEDURE [dbo].[TR_BAOGIA3_GOVAN_DELETEALL]
(	@baoGiaID uniqueidentifier
)
AS
DELETE tr_baogia3_govan
WHERE baoGiaID = @baoGiaID


