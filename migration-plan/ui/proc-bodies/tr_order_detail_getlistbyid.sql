-- PARAMS:
-- @id int


CREATE PROC [dbo].[TR_ORDER_DETAIL_GETLISTBYID](@id int)
AS
SELECT A.*, B.masp, B.tensp, B.masp_khachhang, B.nguyenlieu, B.mausac
FROM tr_order_detail A
    INNER JOIN tr_sanpham B ON A.item_number = B.masp
WHERE A.f_cancelled = 'N'
    --AND B.active = 1
    AND A.id = @id
