-- PARAMS:
-- @order_number nvarchar

CREATE PROC [dbo].[TR_ORDER_DETAIL_GETLISTBYORDER](@order_number NVARCHAR(200))
AS
BEGIN
	DECLARE @malo_nguyenlieu NVARCHAR(4000);
	EXEC DQT_THONGKE_PHOI_GETMALO @order_number, 2, @malo_nguyenlieu OUTPUT;

	SELECT A.*, 
		B.masp, B.tensp, B.tensp_vn, B.masp_khachhang, B.nguyenlieu, B.mausac, B.hehang,
		B.quycach, b.bemat_sanpham, b.ketcau, b.n_weight, b.g_weight,
		B.dai, B.rong, B.cao,
		@malo_nguyenlieu as malo_nguyenlieu,
		b.carton_qty,
		remain_qty = A.order_qty - A.ship_qty
	FROM tr_order_detail A
		INNER JOIN tr_sanpham B ON A.item_number = B.masp
	WHERE A.f_cancelled = 'N'
		AND A.order_number = @order_number
END


