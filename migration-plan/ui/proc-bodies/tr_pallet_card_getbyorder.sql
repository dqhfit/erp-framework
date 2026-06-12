-- PARAMS:
-- @donhang nvarchar

--DECLARE @donhang NVARCHAR(200)
CREATE   PROC TR_PALLET_CARD_GETBYORDER(@donhang NVARCHAR(200))
AS
SELECT A.donhang, C.hehang, B.card_no, A.masp, C.tensp, C.mausac, C.quycach, B.soluong, B.reissue_qty, B.issue_date
FROM tr_pallet A
	INNER JOIN tr_pallet_card B ON A.id = B.pallet_id
	INNER JOIN tr_sanpham C ON A.masp = C.masp
WHERE A.isOrderNumber = 1 AND A.active = 1 AND A.donhang = @donhang
