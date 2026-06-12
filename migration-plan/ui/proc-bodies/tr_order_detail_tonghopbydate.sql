-- PARAMS:
-- @tungay date
-- @denngay date


CREATE PROC TR_ORDER_DETAIL_TONGHOPBYDATE
(
	@tungay date,
	@denngay date
)
AS
BEGIN
	SELECT A.order_date, A.customer, A.order_number, A.cust_po_number,
		C.masp, C.tensp, C.tensp_vn, C.hehang,
		B.order_qty, B.price, B.amount
	FROM tr_order A
		INNER JOIN tr_order_detail B ON A.order_number = B.order_number
		INNER JOIN tr_sanpham C ON B.item_number = C.masp
	WHERE A.f_cancelled = 'N' AND B.f_cancelled = 'N'
		AND A.order_date BETWEEN @tungay AND @denngay
END

