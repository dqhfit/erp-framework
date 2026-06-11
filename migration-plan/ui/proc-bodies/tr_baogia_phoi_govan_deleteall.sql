-- PARAMS:
-- @baoGiaID uniqueidentifier



CREATE PROC [dbo].[TR_BAOGIA_PHOI_GOVAN_DELETEALL](@baoGiaID uniqueidentifier)
AS
BEGIN
	DELETE tr_baogia_phoi_govan
	WHERE baoGiaID = @baoGiaID
END

