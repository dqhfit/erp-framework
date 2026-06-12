-- PARAMS:
-- @PurchaseOrderCode nvarchar

CREATE PROC [dbo].[TR_DONDATHANG_GET2]
(
	@PurchaseOrderCode NVARCHAR(200)
)
AS
select c.nhom
	, b.chitiet as mavt
	, c.mota as mota
	, c.dvt, c.quycach, c.mausac
	, SUM(b.soluong) soluong
	, b.masp
from tr_dondathang a, tr_dondathang_chitiet b, tr_material c
where b.chitiet = ISNULL(c.idxuong, c.mavt)
	and a.maddh = b.maddh
	and b.maddh = @PurchaseOrderCode
	and a.active = 1
	and b.active = 1
group by c.nhom, b.chitiet, c.mota, c.dvt, c.quycach, c.mausac, b.masp
ORDER BY b.chitiet
