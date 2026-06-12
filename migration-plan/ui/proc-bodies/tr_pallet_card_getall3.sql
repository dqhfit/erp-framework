-- PARAMS:
-- @madonhang nvarchar
-- @mahtr nvarchar

CREATE   PROC [dbo].[TR_PALLET_CARD_GETALL3](@madonhang nvarchar(50), @mahtr nvarchar(50))
AS
BEGIN
	SELECT A.id, A.dondathang, A.masp, A.mahtr, 
		A.mact, B.mact_snap, 
		A.stt, B.stt_snap, 
		A.tenct, B.tenct_snap, 
		A.nguyenlieu, B.nguyenlieu_snap,
		a.dayy_tc, B.dayy_tc_snap, 
		a.rong_tc, B.rong_tc_snap, 
		a.dai_tc, B.dai_tc_snap, 
		a.soluong_tc, B.soluong_tc_snap,
		B.card_no, B.card_type, B.soluong,
		B.issue_date, B.reissue_date, B.reissue_qty, B.card_seq,
		pallet_obj1 = CONCAT_WS('-', A.mact, A.tenct, A.nguyenlieu, A.dayy_sc, A.rong_tc, A.dai_tc, A.soluong_tc),
		pallet_obj2 = CONCAT_WS('-', B.mact_snap, B.tenct_snap, B.nguyenlieu_snap, B.dayy_sc_snap, B.rong_tc_snap, B.dai_tc_snap, B.soluong_tc_snap)
	INTO #PALLET_CARD
	FROM tr_pallet A
		INNER JOIN tr_pallet_card B ON A.id = B.pallet_id
	WHERE A.dondathang = @madonhang --AND (A.mahtr = @mahtr OR A.masp = @mahtr)
		AND A.active = 1 AND B.active = 1
	--ORDER BY B.card_no, B.card_seq

	IF LEN(ISNULL(@mahtr,'')) > 0
	BEGIN
		SELECT * FROM #PALLET_CARD
		WHERE (mahtr = @mahtr OR masp = @mahtr) AND mact NOT IN ('000')
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

