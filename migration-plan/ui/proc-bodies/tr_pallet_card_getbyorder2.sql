-- PARAMS:
-- @madonhang nvarchar
-- @masp nvarchar

CREATE   PROC [dbo].[TR_PALLET_CARD_GETBYORDER2]
(
	@madonhang nvarchar(200), 
	@masp nvarchar(200)
)
AS
BEGIN
	SELECT A.id, A.donhang, A.masp, A.mahtr, 
		A.mact, A.stt, A.tenct, A.nguyenlieu,
		a.dayy_tc, a.rong_tc, a.dai_tc, a.soluong_tc,
		B.card_no, B.card_type, B.soluong,
		B.issue_date, B.reissue_date, B.reissue_qty, B.card_seq
	INTO #PALLET_CARD
	FROM tr_pallet A
		INNER JOIN tr_pallet_card B ON A.id = B.pallet_id
	WHERE A.donhang = @madonhang --AND (A.mahtr = @mahtr OR A.masp = @mahtr)
		AND A.active = 1 AND B.active = 1 AND A.isOrderNumber = 1
	--ORDER BY B.card_no, B.card_seq

	IF LEN(ISNULL(@masp,'')) > 0
	BEGIN
		SELECT * FROM #PALLET_CARD
		WHERE masp = @masp AND mact NOT IN ('000')
		ORDER BY card_no, card_seq
	END
	ELSE
	BEGIN
		SELECT * FROM #PALLET_CARD
		WHERE mact = '000'
		ORDER BY card_no, card_seq
	END

	DROP TABLE #PALLET_CARD;
END


