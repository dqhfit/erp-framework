-- PARAMS:
-- @baoGiaID uniqueidentifier


CREATE   PROCEDURE [dbo].[TR_BAOGIA3_DONGGOI_DELETEALL]
(
	@baoGiaID uniqueidentifier
)
AS
DELETE tr_baogia3_donggoiWHERE baoGiaID = @baoGiaID

