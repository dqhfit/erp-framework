-- PARAMS:
-- @baoGiaID uniqueidentifier



CREATE PROC [dbo].[TR_BAOGIA3_TONGHOP_DELETEALL](@baoGiaID uniqueidentifier)
AS
BEGIN
	DELETE tr_baogia3_tonghop
	WHERE baoGiaID = @baoGiaID
END


