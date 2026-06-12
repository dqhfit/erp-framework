-- PARAMS:
-- @madonhang nvarchar
-- @mahtr nvarchar


CREATE   PROC [dbo].[TR_PALLET_CARD_GETALL2](@madonhang nvarchar(50), @mahtr nvarchar(50))
AS
--SELECT * 
--FROM tr_pallet_card A
--WHERE EXISTS (SELECT id FROM tr_pallet WHERE id = A.pallet_id AND active = 1 AND dondathang = @madonhang AND (mahtr = @mahtr OR masp = @mahtr))
--	AND A.active = 1
--ORDER BY pallet_id, card_seq

SELECT A.*, B.mact, B.tenct
FROM tr_pallet_card A
	INNER JOIN tr_pallet B ON A.pallet_id = B.id
WHERE A.active = 1 AND B.dondathang = @madonhang
	AND (B.masp = @mahtr OR B.mahtr = @mahtr)
ORDER BY pallet_id, card_seq
