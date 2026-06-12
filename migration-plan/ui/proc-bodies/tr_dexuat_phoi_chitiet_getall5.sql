-- PARAMS:
-- @dexuat_id uniqueidentifier

CREATE   PROC [dbo].[TR_DEXUAT_PHOI_CHITIET_GETALL5](@dexuat_id uniqueidentifier)
AS
BEGIN
	--SELECT *
	--FROM tr_dexuat_phoi_chitiet
	--WHERE dexuat_id = @dexuat_id and IsCancel = 0
	--ORDER BY nguyenlieu,dayy_yc ASC

	-- LẤY ĐƠN HÀNG SỬ DỤNG
	DECLARE @dondathang nvarchar(max);
	SELECT @dondathang = A.donhang
	FROM tr_dexuat_phoi A
	WHERE A.IsCancel = 0 AND A.id = @dexuat_id

	-- LẤY THÔNG TIN SỐ KHỐI TINH CHẾ CỦA ĐƠN HÀNG
	SELECT A.nguyenlieu, SUM(A.m3_tc) AS m3_tc
	INTO #SOKHOI_TINHCHE
	FROM (
	SELECT CASE
				WHEN B.nguyenlieu = N'BẠCH DƯƠNG' THEN N'Bạch Dương'
				WHEN B.nguyenlieu = N'CAO SU' THEN N'Cao Su'
				WHEN B.nguyenlieu = N'DẺ GAI' THEN N'Dẻ Gai ( Beech )'
				WHEN B.nguyenlieu = N'HỒ ĐÀO' THEN N'HỒ ĐÀO ( HICKORY )'
				WHEN B.nguyenlieu = N'SỒI ĐỎ' THEN N'Sồi Đỏ ( Red Oak )'
				WHEN B.nguyenlieu = N'SỒI' THEN N'Sồi Trắng ( White Oak )'
				WHEN B.nguyenlieu = N'THÔNG' THEN N'Thông'
				WHEN B.nguyenlieu = N'THÔNG CHÂU ÂU' THEN N'Thông'
				WHEN B.nguyenlieu = N'THÔNG FINGER A-A MỘNG NẰM' THEN N'Thông'
				WHEN B.nguyenlieu = N'THÔNG FINGER A-C MỘNG NẰM' THEN N'Thông'
				WHEN B.nguyenlieu = N'THÔNG FINGER C-C MỘNG ĐỨNG' THEN N'Thông'
				WHEN B.nguyenlieu = N'THÔNG FINGER C-C MỘNG NẰM' THEN N'Thông'
				WHEN B.nguyenlieu = N'THÔNG KHÔNG MẮT' THEN N'Thông'
				WHEN B.nguyenlieu = N'THÔNG PALET' THEN N'Thông'
				WHEN B.nguyenlieu = N'TRÀM' THEN N'Tràm'
				ELSE B.nguyenlieu
			END AS nguyenlieu,
		m3_tc = (B.dayy_tc * B.rong_tc * B.dai_tc * B.soluong_tc * A.soluong)/1000000000
	
	FROM tr_dondathang_chitiet A
		INNER JOIN tr_dinhmuc_govan B ON ISNULL(A.masp, dbo.ufn_MaHTR_To_MaSP(A.chitiet)) = B.masp
	WHERE A.maddh IN (SELECT LTRIM(RTRIM([value])) FROM dbo.fn_Split(@dondathang,','))
		AND B.nguyenlieu NOT IN ('', '0')
	) A
	GROUP BY A.nguyenlieu;

	SELECT A.*,
		sokhoi_tinhche = B.m3_tc,
		sokhoi_dexuat = SUM(A.sokhoi_yc) OVER (PARTITION BY A.nguyenlieu)
	FROM tr_dexuat_phoi_chitiet A
		LEFT JOIN #SOKHOI_TINHCHE B ON A.nguyenlieu = B.nguyenlieu
	WHERE A.dexuat_id = @dexuat_id and A.IsCancel = 0
	ORDER BY A.nguyenlieu, A.dayy_yc ASC

	DROP TABLE #SOKHOI_TINHCHE;
END

