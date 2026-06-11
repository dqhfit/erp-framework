-- PARAMS:
-- @MASP nvarchar
-- @BAOGIAID uniqueidentifier

CREATE PROC [dbo].[TR_BAOGIA_DELETE2](@MASP NVARCHAR(MAX), @BAOGIAID UNIQUEIDENTIFIER)
AS
BEGIN
	DELETE tr_baogia_govan WHERE masp = @MASP AND baoGiaID = @BAOGIAID;
	DELETE tr_baogia_ngukim WHERE masp = @MASP AND baoGiaID = @BAOGIAID;
	DELETE tr_baogia_donggoi WHERE masp = @MASP AND baoGiaID = @BAOGIAID;
	DELETE tr_baogia_son WHERE masp = @MASP AND baoGiaID = @BAOGIAID;
	DELETE tr_baogia_thanhpham WHERE masp = @MASP AND baoGiaID = @BAOGIAID;
	DELETE tr_baogia_other WHERE baoGiaID = @BAOGIAID
	DELETE tr_baogia_govan_giacong WHERE baoGiaID = @BAOGIAID
END


