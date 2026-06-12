-- PARAMS:
-- @OrderNumber nvarchar
-- @ItemNumber nvarchar


CREATE PROC [dbo].[TR_CONT_DETAIL_Search]
(
	@OrderNumber NVARCHAR(MAX),
	@ItemNumber NVARCHAR(MAX)
)
AS
BEGIN
	SELECT NULL as cont_id, 
		B.id,
		A.order_number, A.cust_po_number,
		C.masp_khachhang,
		C.masp,
		C.tensp as [description], C.dvt,
		B.order_qty, B.ship_qty,
		remain_qty = (B.order_qty - B.ship_qty) ,
		input_qty = (B.order_qty - B.ship_qty)
	INTO #order
	FROM tr_order A
		INNER JOIN tr_order_detail B ON A.order_number = B.order_number
		INNER JOIN tr_sanpham C ON B.item_number = C.masp
	WHERE B.f_cancelled = 'N' AND A.f_cancelled = 'N'
		--and b.choduyet = 1
		AND A.order_number = @OrderNumber
		AND B.item_number = @ItemNumber

	SELECT B.*, ISNULL(a.quantity, 0) quantity
	FROM tr_tonkho_thanhpham A
		RIGHT JOIN #order B ON a.order_number = b.order_number and a.product_code = b.masp
END

