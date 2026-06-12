-- PARAMS:
-- @masp nvarchar



CREATE PROC [dbo].[TR_BAOGIA3_TONGHOP_CREATE]
(
	@masp nvarchar(200)
)
AS
BEGIN

	DECLARE @columns nvarchar(MAX) = ''
	DECLARE @sql nvarchar(MAX) = ''

	SELECT @columns += QUOTENAME(mausac) + ',' 
	FROM tr_sanpham
	WHERE masp_nhamay = @masp AND active = 1
	GROUP BY mausac
	ORDER BY mausac

	IF(LEN(@columns) > 0)
	BEGIN
		SET @columns = LEFT(@columns, LEN(@columns) - 1)
	END
	SET @sql = '
	SELECT * FROM (
		SELECT * FROM tr_baogia3_tonghop
		WHERE 0 = 1
	) T
	PIVOT
	(
		SUM(sotien)
		FOR mausac IN (' + @columns +')
	) AS pt 
	ORDER BY nhom, tenchiphi'

	EXECUTE sp_executesql @sql

END

