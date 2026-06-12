-- PARAMS:
-- @nam int
-- @thang int
-- @macongdoan nvarchar


CREATE PROC [dbo].[TR_MUCTIEU_SANXUAT2_GETM3_HOANTHANH]
(
	@nam int,
	@thang int,
	@macongdoan nvarchar(max)
)
AS
BEGIN
	--DECLARE	@nam int = 2025
	--DECLARE @thang int = 5
	--DECLARE @macongdoan nvarchar(max) = 'DP09'
	SELECT ngaythang, sokhoi
	INTO #THONGKE_SANLUONG
	FROM (
		SELECT ngaythang,
			sokhoi = SUM(CASE 
				WHEN A.mact = '000' AND A.congdoan <> 'SCT01-PROD' THEN A.sokhoi * A.soluong 
				WHEN A.mact = '000' AND A.congdoan = 'SCT01-PROD' THEN 0 
			ELSE IIF(ISNULL(nguyenlieu, '') IN ('', '0'), 0, A.sokhoi) END)
		FROM tr_trangthai_sanxuat A
		WHERE YEAR(ngaythang) = @nam AND MONTH(ngaythang) = @thang
			AND congdoan = CONCAT(@macongdoan, '-PROD')
		GROUP BY ngaythang
		UNION ALL
		SELECT CONVERT(date, ngaytao) AS ngaythang, SUM(sokhoi) as sokhoi
		FROM dqt_pallet_chitiet
		WHERE YEAR(ngaytao) = @nam AND MONTH(ngaytao) = @thang AND congdoan = @macongdoan
		GROUP BY CONVERT(date, ngaytao)
	) A

	DECLARE @ngaythang date;
	DECLARE @sokhoi float;
	DECLARE CUR CURSOR LOCAL FOR
		SELECT ngaythang, sokhoi FROM #THONGKE_SANLUONG
	OPEN CUR;
	FETCH NEXT FROM CUR INTO @ngaythang, @sokhoi;
	WHILE @@FETCH_STATUS = 0
	BEGIN
		IF EXISTS (SELECT 1 FROM tr_muctieu_sanxuat2_chitiet WHERE ngaythang = @ngaythang AND macongdoan = @macongdoan)
		BEGIN
			UPDATE tr_muctieu_sanxuat2_chitiet
			SET sokhoi_hoanthanh = @sokhoi
			WHERE ngaythang = @ngaythang AND macongdoan = @macongdoan 
		END
		FETCH NEXT FROM CUR INTO @ngaythang, @sokhoi;
	END
	CLOSE CUR;
	DEALLOCATE CUR;

	DROP TABLE #THONGKE_SANLUONG;
END

