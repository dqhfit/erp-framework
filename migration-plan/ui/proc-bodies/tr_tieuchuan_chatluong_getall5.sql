-- PARAMS:
-- @dondathang nvarchar
-- @productList nvarchar


CREATE   PROC [dbo].[TR_TIEUCHUAN_CHATLUONG_GETALL5]
(
	@dondathang nvarchar(50),
	@productList nvarchar(max)
)
AS
--DECLARE @dondathang nvarchar(50) = 'DQH-VFM13/0524'
--DECLARE @productList nvarchar(max) = 'WGAL-NH-5-51-0_TL, WGAL-NH-5-13-H_TL'

DECLARE @columns nvarchar(MAX) = ''
DECLARE @sql nvarchar(MAX) = ''

SELECT @columns += QUOTENAME(c_location) + ',' 
FROM trtb_m_location_process
WHERE location_type = 'PROD'
ORDER BY c_op, stt

SET @columns = LEFT(@columns, LEN(@columns) - 1)

SET @sql = '
SELECT A.id, A.dondathang, A.masp, A.mahtr, A.stt, A.mact, A.tenct, A.nguyenlieu 
INTO #PHIEUPALLET
FROM tr_pallet A
WHERE A.dondathang = @dondathang
	AND A.masp IN (SELECT LTRIM(RTRIM([value])) FROM dbo.fn_Split(@productList, '',''))
	AND (A.nguyenlieu <> ''0'' AND A.nguyenlieu <> '''')

SELECT * FROM (
	SELECT B.id, 
		B.dondathang, B.masp, B.mahtr, B.stt, B.mact, B.tenct, B.nguyenlieu, 
		A.congdoan, 
		A.soluongloi
	FROM tr_tieuchuan_chatluong A
		RIGHT JOIN #PHIEUPALLET B ON A.pallet_id = B.id
) T PIVOT (
	SUM(soluongloi)
	FOR congdoan IN (' + @columns + ')
) AS pt

DROP TABLE #PHIEUPALLET
'
EXECUTE sp_executesql @sql, N'@dondathang nvarchar(50), @productList nvarchar(max)', @dondathang, @productList


