-- PARAMS:
-- @trangthai nvarchar


CREATE PROC [dbo].[TR_DONDATHANG_GETLISTHTR]
(
	@trangthai nvarchar(50) = 'ALL'
)
AS
BEGIN
	-- ALL trangthai IN ('0', '1', '2', '3')
	-- HOANTHANH trangthai IN ('3')
	-- CHUAHOANTHANH trangthai IN ('0', '1', '2')
	DECLARE @trangthai1 nvarchar(200);
	IF @trangthai = 'ALL'
		SET @trangthai1 = '0, 1, 2, 3';
	ELSE IF @trangthai = 'HOANTHANH'
		SET @trangthai1 = '3';
	ELSE IF @trangthai = 'CHUAHOANTHANH'
		SET @trangthai1 = '0, 1, 2';

	SELECT A.maddh, A.mancc, A.tenncc, A.ngaydat, A.donhang
	FROM tr_dondathang A WITH(NOLOCK)
		INNER JOIN tr_dondathang_chitiet B WITH(NOLOCK) ON A.maddh = B.maddh
	WHERE A.pheduyet = '1'
		AND A.trangthai NOT IN ('-1')
		AND A.active = 1
		AND A.loaiddh IN ('HTR', 'OTHER')
		AND B.chitiet LIKE 'W%'
		AND A.trangthai IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@trangthai1, ','))
	GROUP BY A.maddh, A.mancc, A.tenncc, A.ngaydat, A.donhang
	ORDER BY A.ngaydat DESC
END

