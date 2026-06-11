-- PARAMS:
-- @baoGiaID uniqueidentifier


CREATE   PROCEDURE [dbo].[TR_BAOGIA3_NGUKIM_DELETEALL]
(
	@baoGiaID uniqueidentifier
)
AS
DELETE tr_baogia3_ngukimWHERE baoGiaID = @baoGiaID

