-- PARAMS:
-- @ContID nvarchar


CREATE PROC [dbo].[TR_CONT_DETAIL_Get2](@ContID NVARCHAR(MAX))
AS
select a.cont_id, b.id
	,  b.order_number, b.cust_po_number
	, c.masp_khachhang
	, a.masp, c.tensp as [description], c.dvt
	, b.order_qty, b.ship_qty
	, (b.order_qty - b.ship_qty) as remain_qty
	, (b.order_qty - b.ship_qty)  as input_qty
into #order
from tr_ctcont a, tr_order_detail b, tr_sanpham c
where a.order_id = b.id
	and c.masp = b.item_number
	and b.f_cancelled = 'N'
	and b.choduyet = 1
	and a.cont_id = @ContID

select b.*, ISNULL(a.quantity, 0) quantity
from tr_tonkho_thanhpham a
	right join #order b ON a.order_number = b.order_number and a.product_code = b.masp
