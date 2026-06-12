-- PARAMS:
-- @order_number nvarchar

CREATE PROC [dbo].[TR_ORDER_DETAIL_GETBYMULTIPLEORDER](@order_number nvarchar(max))
AS
select c.hehang, c.masp, c.tensp, c.cbm, 
    SUM(B.order_qty) AS order_qty,
    SUM(B.test_run_qty) AS test_run_qty,
    SUM(b.order_qty) soluong_donhang
from tr_order a
	inner join tr_order_detail b on a.order_number = b.order_number
    inner join tr_sanpham c on b.item_number = c.masp
where a.f_cancelled = 'N'
    AND b.f_cancelled = 'N'
    and a.choduyet = 1
    and c.active = 1
    and a.order_number in (select RTRIM(LTRIM([value])) from dbo.fn_Split(@order_number, ','))
GROUP BY c.hehang, c.masp, c.tensp, c.cbm




