-- PARAMS:
-- @baoGiaID uniqueidentifier



CREATE PROC [dbo].[TR_BAOGIA_PHOI_TONG_DELETEALL](@baoGiaID uniqueidentifier)
AS
BEGIN
	DELETE tr_baogia_phoi_tong
	WHERE baoGiaID = @baoGiaID
END

