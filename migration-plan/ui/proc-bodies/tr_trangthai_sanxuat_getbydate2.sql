-- PARAMS:
-- @tungay date
-- @denngay date


CREATE PROC [dbo].[TR_TRANGTHAI_SANXUAT_GETBYDATE2]
(
	@tungay date,
	@denngay date
)
AS
--DECLARE	@tungay date = '2024-01-01'
--DECLARE	@denngay date = '2024-01-28'
DECLARE @columns nvarchar(MAX) = ''
DECLARE @sql nvarchar(MAX) = ''

SELECT @columns += QUOTENAME(c_location) + ',' 
FROM trtb_m_location_process
ORDER BY c_op, stt

SET @columns = LEFT(@columns, LEN(@columns) - 1)

DECLARE @donhang nvarchar(max) = ''
SELECT @donhang += QUOTENAME(madonhang,'''') + ','
FROM tr_trangthai_sanxuat
WHERE ngaythang BETWEEN @tungay AND @denngay
GROUP BY madonhang

SET @donhang = LEFT(@donhang, LEN(@donhang) - 1)

SET @sql = '
SELECT * 
INTO #TRANGTHAI_SANXUAT
FROM (
	SELECT madonhang, nguyenlieu, congdoan, sokhoi
	FROM tr_trangthai_sanxuat
	WHERE ngaythang BETWEEN @tungay AND @denngay
) T PIVOT (
	SUM(sokhoi)
	FOR congdoan IN (' + @columns + ')
) as pt

SELECT A.*, B.sokhoi 
INTO #TRANGTHAI_SANXUAT2
FROM #TRANGTHAI_SANXUAT A
	INNER JOIN (SELECT dondathang, nguyenlieu, 
					SUM(IIF(mact = ''000'', sokhoi_tinhche, (dayy_tc*rong_tc*dai_tc*soluong_can)/1000000000)) as sokhoi 
				FROM tr_pallet 
				WHERE dondathang IN (' + @donhang + ') 
				GROUP BY dondathang, nguyenlieu) B ON a.madonhang = b.dondathang AND a.nguyenlieu = b.nguyenlieu

SELECT madonhang, nguyenlieu, SUM(sokhoi) AS sokhoi_in
INTO #PHOIDAUVAO
FROM dqt_thongke_phoi
WHERE madonhang IN (' + @donhang + ')
GROUP BY madonhang, nguyenlieu

SELECT A.*, B.sokhoi_in
FROM #TRANGTHAI_SANXUAT2 A
	LEFT JOIN #PHOIDAUVAO B ON A.madonhang = B.madonhang AND A.nguyenlieu = B.nguyenlieu
'
EXECUTE sp_executesql @sql, N'@tungay date, @denngay date', @tungay, @denngay





