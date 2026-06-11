-- PARAMS:
-- @masp nvarchar
-- @tigia float
-- @tongdongia_sanpham decimal OUTPUT
-- @tongdongia_metvuong decimal OUTPUT


CREATE PROC [dbo].[TINHGIA_NGUYENLIEU_SON]
(
	@masp nvarchar(200),
	@tigia float = 25400,
	@tongdongia_sanpham decimal(18, 2) OUT,
	@tongdongia_metvuong decimal(18, 2) OUT
)
AS
BEGIN
	-- SET @masp = 'CRL-DW-5-03-F_AKZ010_AA';

	SELECT 
		@tongdongia_metvuong = SUM(IIF(C.loaitien = 'USD', A.soluong * C.dongia * @tigia, A.soluong * C.dongia)),
		@tongdongia_sanpham = SUM(IIF(C.loaitien = 'USD', A.soluong * B.metvuong * C.dongia * @tigia, A.soluong * B.metvuong * C.dongia))
	FROM tr_dinhmuc_son3 A
		INNER JOIN tr_dinhmuc_son3_metvuong B ON A.matson = B.matson AND A.masp = B.masp
		INNER JOIN tr_material C ON A.mact = C.mavt
	WHERE A.masp = @masp
END


