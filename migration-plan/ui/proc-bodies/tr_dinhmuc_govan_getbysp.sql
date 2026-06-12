-- PARAMS:
-- @masp nvarchar


CREATE PROC [dbo].[TR_DINHMUC_GOVAN_GETBYSP](@masp nvarchar(100))
AS
BEGIN
	--SELECT a.*, B.fsc_name, banve1 = REPLACE(a.banve, 'wwwroot', 'https://dongquochung.com')
	--into #temp
	--FROM tr_dinhmuc_govan a
	--	LEFT JOIN tr_tinhtrang_fsc B ON A.fsc_id = B.fsc_id
	--WHERE a.masp = @masp
	--	AND ISNULL(a.mact, '') <> '000'

	--select *--,(CASE WHEN ISNUMERIC(stt) = 1 THEN 0 ELSE 1 END) IsNum 
	--from #temp
	--ORDER BY LEFT(stt, 1), REPLACE(stt, LEFT(stt, 1), '')

	--DROP TABLE #temp
	SELECT A.*,
		B.fsc_name,
		banve1 = REPLACE(A.banve, 'wwwroot', 'https://dongquochung.com'),
		tenveneer_matchinh = VMC.loaihang,
		tenveneer_matphu = VMP.loaihang,
		tenveneer_dancanh = VDC.loaihang
	FROM tr_dinhmuc_govan A
		LEFT JOIN tr_tinhtrang_fsc B ON A.fsc_id = B.fsc_id
		LEFT JOIN tr_baogia_chiphi_veneer VMC ON A.veneer_matchinh = VMC.id
		LEFT JOIN tr_baogia_chiphi_veneer VMP ON A.veneer_matphu = VMP.id
		LEFT JOIN tr_baogia_chiphi_veneer VDC ON A.veneer_dan_canh = VDC.id
	WHERE A.masp = @masp AND COALESCE(A.mact, '') <> '000'
	ORDER BY A.stt
END

