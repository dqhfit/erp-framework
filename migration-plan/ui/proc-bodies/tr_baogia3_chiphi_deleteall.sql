-- PARAMS:
-- @baoGiaID uniqueidentifier


CREATE   PROC [dbo].[TR_BAOGIA3_CHIPHI_DELETEALL](@baoGiaID uniqueidentifier)
AS
BEGIN
	DELETE tr_baogia3_chiphi
	WHERE baoGiaID = @baoGiaID
END;

