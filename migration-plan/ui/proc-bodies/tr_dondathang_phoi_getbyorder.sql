-- PARAMS:
-- @order_number nvarchar
-- @isTotal bit

CREATE PROC [dbo].[TR_DONDATHANG_PHOI_GETBYORDER]
(
  @order_number NVARCHAR(MAX),
  @isTotal bit = 0
)
AS
DECLARE @DONHANG TABLE
(
  order_number    NVARCHAR (200),
  item_number     NVARCHAR (200),
  order_qty       INT
)
IF @isTotal = 0
BEGIN
  INSERT INTO @DONHANG
     SELECT A.order_number, B.item_number, B.order_qty
     FROM tr_order A
          INNER JOIN tr_order_detail B ON A.order_number = B.order_number
     WHERE     A.f_cancelled = 'N'
           AND B.f_cancelled = 'N'
           AND A.order_number IN
                  (SELECT RTRIM (LTRIM ([value]))
                   FROM dbo.fn_Split (@order_number, ','))
END
ELSE
BEGIN
  INSERT INTO @DONHANG
     SELECT @order_number AS order_number, B.item_number, SUM(B.order_qty) order_qty
     FROM tr_order A
          INNER JOIN tr_order_detail B ON A.order_number = B.order_number
     WHERE     A.f_cancelled = 'N'
           AND B.f_cancelled = 'N'
           AND A.order_number IN
                  (SELECT RTRIM (LTRIM ([value]))
                   FROM dbo.fn_Split (@order_number, ','))
      GROUP BY B.item_number
END
SELECT A.order_number,
       B.masp, C.tensp,
       B.mact,
       B.chitiet,
       B.nguyenlieu,
       B.dayy_sc,
       B.rong_sc,
       B.dai_sc,
       B.soluong_sc,
       a.order_qty,
       soluong_dathang = B.soluong_sc * a.order_qty,
       B.ghichu
FROM @DONHANG A 
	INNER JOIN tr_dinhmuc_govan_soche B ON A.item_number = B.masp
	INNER JOIN tr_sanpham C ON A.item_number = C.masp
WHERE B.dayy_sc > 0 AND B.rong_sc > 0 AND B.dai_sc > 0
