-- PARAMS:
-- @makhuvuc nvarchar


CREATE PROC [dbo].[TR_TIENDO_CHUYENSON_GETBYKHUVUC]
(
	@makhuvuc nvarchar(50)
)
AS
BEGIN
	DECLARE @DANHSACH_DONHANG TABLE
	(
		madonhang nvarchar(200),
		hehang nvarchar(200)
	)

	INSERT INTO @DANHSACH_DONHANG (madonhang, hehang)
	SELECT order_number, [range] FROM tr_order WHERE Finished = 0 AND f_cancelled = 'N'

	SELECT A.makhuvuc, A.donhang, A.masp, A.mact, A.tenct,
		SUM(DISTINCT B.soluong_can) AS soluong_donhang,
		BUOC1 = SUM(CASE WHEN A.buocson = 'BUOC1' THEN A.soluong END),
		BUOC2 = SUM(CASE WHEN A.buocson = 'BUOC2' THEN A.soluong END),
		BUOC3 = SUM(CASE WHEN A.buocson = 'BUOC3' THEN A.soluong END),
		BUOC4 = SUM(CASE WHEN A.buocson = 'BUOC4' THEN A.soluong END),
		BUOC5 = SUM(CASE WHEN A.buocson = 'BUOC5' THEN A.soluong END),
		BUOC6 = SUM(CASE WHEN A.buocson = 'BUOC6' THEN A.soluong END),
		BUOC7 = SUM(CASE WHEN A.buocson = 'BUOC7' THEN A.soluong END),
		BUOC8 = SUM(CASE WHEN A.buocson = 'BUOC8' THEN A.soluong END),
		BUOC9 = SUM(CASE WHEN A.buocson = 'BUOC9' THEN A.soluong END),
		BUOC10 = SUM(CASE WHEN A.buocson = 'BUOC10' THEN A.soluong END),
		BUOC11 = SUM(CASE WHEN A.buocson = 'BUOC11' THEN A.soluong END),
		BUOC12 = SUM(CASE WHEN A.buocson = 'BUOC12' THEN A.soluong END),
		BUOC13 = SUM(CASE WHEN A.buocson = 'BUOC13' THEN A.soluong END),
		BUOC14 = SUM(CASE WHEN A.buocson = 'BUOC14' THEN A.soluong END),
		BUOC15 = SUM(CASE WHEN A.buocson = 'BUOC15' THEN A.soluong END)
	FROM tr_tiendo_chuyenson A INNER JOIN tr_release_govan B ON A.donhang = B.madonhang AND A.masp = B.masp AND A.mact = B.mact
	WHERE A.donhang IN (SELECT madonhang FROM @DANHSACH_DONHANG)
		AND A.makhuvuc = @makhuvuc
	GROUP BY A.makhuvuc, A.donhang, A.masp, A.mact, A.tenct
END

