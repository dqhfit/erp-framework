-- PARAMS:
-- @ngaythang date


CREATE PROC [dbo].[TR_BAOCAO_CHUYENSON_GETDATA]
(
	@ngaythang date
)
AS
BEGIN
	--SELECT A.congdoan, A.madonhang, A.masp1
	--INTO #CONGDOAN_DONHANG
	--FROM tr_trangthai_sanxuat A
	--WHERE A.ngaythang = @ngaythang
	--	AND A.congdoan IN ('SON01-PROD', 'SCT01-PROD', 'SCT1-PROD', 'DG01-PROD', 'DG02-PROD', 'UV03-PROD')
	--GROUP BY A.congdoan, A.madonhang, A.masp1

	SELECT A.congdoan, B.n_location AS tencongdoan, A.madonhang AS donhang, A.masp1 AS masp, A.mact, A.tenct, A.dayy, A.rong, A.dai, SUM(A.soluong) AS soluong
	FROM tr_trangthai_sanxuat A INNER JOIN trtb_m_location B ON A.congdoan = B.c_location
	WHERE A.ngaythang = @ngaythang
		AND A.congdoan IN ('SON01-PROD', 'SCT01-PROD', 'SCT1-PROD', 'DG01-PROD', 'DG02-PROD', 'UV03-PROD')
	GROUP BY A.congdoan, B.n_location, A.madonhang, A.masp1, A.mact, A.tenct, A.dayy, A.rong, A.dai

	--DROP TABLE #CONGDOAN_DONHANG;
END

