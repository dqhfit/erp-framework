-- PARAMS:
-- @madonhang nvarchar


CREATE   PROC [dbo].[TR_PALLET_CARD_GETALL4](@madonhang nvarchar(50))
AS
BEGIN
	SELECT A.*, B.mact, B.tenct
	FROM tr_pallet_card A
		INNER JOIN tr_pallet B ON A.pallet_id = B.id
	WHERE A.active = 1 AND B.dondathang = @madonhang
		AND B.mact = '000'
	ORDER BY pallet_id, card_seq
END

