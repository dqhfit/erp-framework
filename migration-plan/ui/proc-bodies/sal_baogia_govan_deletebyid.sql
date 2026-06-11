-- PARAMS:
-- @idBaoGia uniqueidentifier


CREATE PROCEDURE SAL_BAOGIA_GOVAN_DELETEBYID(@idBaoGia uniqueidentifier)
AS
BEGIN
	DELETE sal_baogia_govan_chitiet WHERE idBaoGia = @idBaoGia;
	DELETE sal_baogia_govan WHERE idBaoGia = @idBaoGia;
END

