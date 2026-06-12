-- PARAMS:
-- @fromDate date
-- @toDate date


CREATE PROC [dbo].[TR_BAOCAO_HANGLOI_GETALL3]
(
	@fromDate date,
	@toDate date
)
AS
BEGIN
	--DECLARE @fromDate date = '2025-05-01'
	--DECLARE @toDate date = '2025-05-17'
	SELECT bophanlamloi, dondathang, donhang, nguyenlieu, SUM(sokhoi) AS sokhoi, SUM(soluong) AS soluong
	INTO #BAOCAO_HANGLOI
	FROM (
		SELECT  
			bophanlamloi = REPLACE(loc1.n_location, N'[Hoàn thành]', ''), 
			dondathang = tbh.donhang,
			donhang = SUBSTRING(tbh.donhang, CHARINDEX('-', tbh.donhang) + 1, LEN(tbh.donhang) - 1),
			dm.nguyenlieu,
			soluong,
			sokhoi = (dayy * rong * dai * soluong) / 1000000000
		FROM tr_baocao_hangloi tbh
			LEFT JOIN trtb_m_location loc1 ON loc1.c_location = tbh.bophanlamloi
			LEFT JOIN tr_dinhmuc_govan dm ON tbh.masp1 = dm.masp AND tbh.mact = dm.mact
		WHERE tbh.ngaythang BETWEEN @fromDate AND @toDate AND tbh.bophanlamloi IS NOT NULL
	) A
	GROUP BY bophanlamloi, dondathang, donhang, nguyenlieu

	SELECT A.maddh, B.nguyenlieu, SUM(A.soluong * B.m3_tc) AS sokhoi
	INTO #DONDATHANG
	FROM tr_dondathang_chitiet A
		INNER JOIN tr_dinhmuc_govan B ON A.masp = B.masp
	WHERE A.maddh IN (SELECT DISTINCT dondathang FROM #BAOCAO_HANGLOI)
		AND B.nguyenlieu NOT IN ('', '0')
	GROUP BY A.maddh, B.nguyenlieu

	--SELECT * FROM #DONDATHANG;
	SELECT A.*, B.sokhoi AS sokhoi_donhang, 
		phantram = (CASE WHEN B.sokhoi = 0 THEN 0 ELSE A.sokhoi / B.sokhoi END) * 100
	FROM #BAOCAO_HANGLOI A
		LEFT JOIN #DONDATHANG B ON A.dondathang = B.maddh AND A.nguyenlieu = B.nguyenlieu

	DROP TABLE #DONDATHANG, #BAOCAO_HANGLOI;
END


