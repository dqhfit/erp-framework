-- PARAMS:
-- @order_number nvarchar

CREATE PROC [dbo].[TR_ORDER_DETAIL_GETBYMULTIPLEORDER2](@order_number nvarchar(max))
AS
BEGIN
	SELECT A.order_number, C.hehang, C.masp, C.masp_khachhang, C.tensp, C.tensp_vn, B.order_qty, B.price
	FROM tr_order a
		INNER JOIN tr_order_detail b on a.order_number = b.order_number
		INNER JOIN tr_sanpham c on b.item_number = c.masp
	WHERE a.f_cancelled = 'N'
		AND b.f_cancelled = 'N'
		and a.choduyet = 1
		--and c.active = 1
		and a.order_number in (SELECT RTRIM(LTRIM([value])) FROM dbo.fn_Split(@order_number, ','))
END





