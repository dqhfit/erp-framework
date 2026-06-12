-- PARAMS:
-- @order_number nvarchar

CREATE PROC [dbo].[TR_ORDER_EXAMPLE_DETAIL_GETLISTBYORDER](@order_number NVARCHAR(200))
AS
SELECT A.*, B.masp, B.tensp, B.tensp_vn, B.masp_khachhang, B.nguyenlieu, B.mausac
FROM tr_order_example_detail A
    INNER JOIN tr_sanpham B ON A.item_number = B.masp
WHERE A.f_cancelled = 'N'
    AND B.active = 1
    AND A.order_number = @order_number
