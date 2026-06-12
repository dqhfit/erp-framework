-- PARAMS:
-- @ORDERNUMBER nvarchar

CREATE PROC [dbo].[TONGHOP_DONHANG](@ORDERNUMBER NVARCHAR(MAX))
AS
SELECT A.masp, A.tensp, A.hehang, SUM(B.order_qty) AS soluong, A.dvt, a.mausac 
FROM tr_sanpham A, tr_order_detail B
WHERE A.masp = B.item_number
	AND B.choduyet = 1
	AND B.Finished = 0
	AND B.f_cancelled = 'N'
	AND B.order_number IN (SELECT dbo.TRIM(value) FROM dbo.fn_Split(@ORDERNUMBER, ','))
GROUP BY A.masp, A.tensp, A.hehang, A.dvt, a.mausac 
ORDER BY masp
