-- PARAMS:
-- @baoGiaID uniqueidentifier


CREATE   PROCEDURE [dbo].[TR_BAOGIA3_SON_DELETEALL]
(	@baoGiaID uniqueidentifier
)
AS
DELETE tr_baogia3_sonWHERE baoGiaID = @baoGiaID

