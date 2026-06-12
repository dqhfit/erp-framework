-- PARAMS:
-- @pcard nvarchar


CREATE   PROC TR_TRANGTHAI_SANXUAT_GETBYPCARD2
(
	@pcard nvarchar(200)
)
AS
BEGIN
	SELECT TOP (1) a.madonhang, a.masp1, a.tenct, a.nguyenlieu, a.congdoan, c.n_op
	INTO #CONGDOANCUOICUNG
	FROM tr_trangthai_sanxuat A
		INNER JOIN trtb_m_location B ON A.congdoan = B.c_location
		INNER JOIN trtb_m_op C ON B.c_op = C.c_op
	WHERE A.pcard = @pcard
		AND A.congdoan LIKE '%PROD'
	ORDER BY A.ngaythang DESC

	DECLARE @congdoancuoi nvarchar(200);
	SELECT @congdoancuoi = n_op FROM #CONGDOANCUOICUNG;

	UPDATE tr_baocao_hangloi
	SET congdoanhientai = @congdoancuoi
	WHERE card_no = @pcard

	SELECT * FROM #CONGDOANCUOICUNG;
	DROP TABLE #CONGDOANCUOICUNG;
END
