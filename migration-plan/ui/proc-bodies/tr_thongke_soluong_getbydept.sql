-- PARAMS:
-- @khuvuc nvarchar
-- @madonhang nvarchar

CREATE PROCEDURE [dbo].[TR_THONGKE_SOLUONG_GETBYDEPT]
(
  @khuvuc nvarchar(50),
  @madonhang nvarchar(max)
)
AS
--THÔNG TIN SỐ LƯỢNG ĐÃ THỐNG KÊ CỦA ĐƠN HÀNG
DECLARE @THONGKE_SOLUONG TABLE
(
  BOPHAN NVARCHAR(200),
  MADONHANG NVARCHAR(MAX),
  MASP NVARCHAR(MAX),
  ORDER_ID INT,
  soluong_hoanthanh INT
)

INSERT INTO @THONGKE_SOLUONG(BOPHAN, MADONHANG, MASP, ORDER_ID, soluong_hoanthanh)
SELECT BOPHAN, MADONHANG, MASP, ORDER_ID, SUM(SOLUONG) 
FROM tr_thongke_soluong WITH(NOLOCK)
WHERE BOPHAN = @khuvuc AND MADONHANG IN (SELECT LTRIM(RTRIM([value])) FROM dbo.fn_Split(@madonhang, ','))
GROUP BY BOPHAN, MADONHANG, MASP, ORDER_ID

--THÔNG TIN ĐƠN HÀNG
DECLARE @THONGTIN_DONHANG TABLE
(
  order_number NVARCHAR(200),
  cust_po_number NVARCHAR(MAX),
  id INT,
  item_number NVARCHAR(200),
  [description] NVARCHAR(MAX),
  order_qty INT
)

INSERT INTO @THONGTIN_DONHANG(order_number, cust_po_number, id, item_number, [description], order_qty)
SELECT A.order_number, A.cust_po_number, B.id, B.item_number, C.tensp, B.order_qty
FROM tr_order A
  INNER JOIN tr_order_detail B ON A.order_number = B.order_number
  INNER JOIN tr_sanpham C ON B.item_number = C.masp
WHERE A.f_cancelled = 'N' 
	--AND A.Finished = 0 
	AND A.choduyet = 1
  AND A.order_number IN (SELECT LTRIM(RTRIM([value])) FROM dbo.fn_Split(@madonhang, ','))
  

SELECT A.order_number, A.cust_po_number, a.item_number, a.[description], 
	a.order_qty, a.id, ISNULL(B.soluong_hoanthanh, 0) AS soluong_hoanthanh
FROM @THONGTIN_DONHANG A
  LEFT JOIN @THONGKE_SOLUONG B ON A.order_number = B.MADONHANG AND a.id = b.ORDER_ID
ORDER BY A.id
