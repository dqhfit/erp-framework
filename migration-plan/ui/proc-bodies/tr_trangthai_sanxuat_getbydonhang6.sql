-- PARAMS:
-- @madonhang nvarchar
-- @congdoan nvarchar
-- @trangthai nvarchar
-- @loaipallet nvarchar


CREATE PROC [dbo].[TR_TRANGTHAI_SANXUAT_GETBYDONHANG6]
(
	@madonhang nvarchar(200),
	@congdoan nvarchar(50),
	@trangthai nvarchar(50),
	@loaipallet nvarchar(10) = NULL
)
AS
BEGIN
	DECLARE @sql nvarchar(max);
	DECLARE @sql2 nvarchar(max);
	DECLARE @sql3 nvarchar(max);

	DECLARE @ParmDefinition AS NVARCHAR (500);

	SET @ParmDefinition = N'@madonhang nvarchar(200), @congdoan nvarchar(50), @trangthai nvarchar(50), @loaipallet nvarchar(10) = NULL';

	SET @sql = N'SELECT A.*, ';
	SET @sql = @sql + CHAR(13) + CHAR(10) + N'B.FullName AS tennguoinhan, ';
	SET @sql = @sql + CHAR(13) + CHAR(10) + N'C.FullName AS tennguoigiao ';
	SET @sql = @sql + CHAR(13) + CHAR(10) + N'FROM tr_trangthai_sanxuat A ';
	SET @sql = @sql + CHAR(13) + CHAR(10) + N'LEFT JOIN SYS_USER B ON A.nguoinhan = B.UserName ';
	SET @sql = @sql + CHAR(13) + CHAR(10) + N'LEFT JOIN SYS_USER C ON A.nguoitao = C.UserName ';
	SET @sql = @sql + CHAR(13) + CHAR(10) + N'WHERE congdoan = @congdoan ';
	SET @sql = @sql + CHAR(13) + CHAR(10) + N'AND madonhang = @madonhang ';

	IF @trangthai = 'HOANTHANH'
	BEGIN
		SET @sql2 = N' AND ngaygiao IS NOT NULL AND nguoinhan IS NOT NULL';

		--SELECT A.*, 
		--	B.FullName AS tennguoinhan,
		--	C.FullName AS tennguoigiao
		--FROM tr_trangthai_sanxuat A
		--	LEFT JOIN SYS_USER B ON A.nguoinhan = B.UserName
		--	LEFT JOIN SYS_USER C ON A.nguoitao = C.UserName
		--WHERE congdoan = @congdoan
		--	AND madonhang = @madonhang
		--	AND ngaygiao IS NOT NULL
		--	AND nguoinhan IS NOT NULL
		--ORDER BY ngaygiao DESC
	END
	ELSE
	BEGIN
		SET @sql2 = N' AND ngaygiao IS NULL AND nguoinhan IS NULL';
		--SELECT A.*, 
		--	B.FullName AS tennguoinhan,
		--	C.FullName AS tennguoigiao
		--FROM tr_trangthai_sanxuat A
		--	LEFT JOIN SYS_USER B ON A.nguoinhan = B.UserName
		--	LEFT JOIN SYS_USER C ON A.nguoitao = C.UserName
		--WHERE congdoan = @congdoan
		--	AND madonhang = @madonhang
		--	AND ngaygiao IS NULL
		--	AND nguoinhan IS NULL
		--ORDER BY ngaythang DESC
	END

	IF @loaipallet = N'CHITIET'
	BEGIN
		SET @sql3 = ' AND A.mact <> ''000''';
	END
	ELSE IF @loaipallet = N'SANPHAM'
	BEGIN
		SET @sql3 = ' AND A.mact = ''000''';
	END
	ELSE
	BEGIN
		SET @sql3 = '';
	END

	SET @sql = @sql + CHAR(13) + CHAR(10) + @sql2 + CHAR(13) + CHAR(10) + @sql3;

	EXECUTE sp_executesql @sql, @ParmDefinition, 
						@madonhang = @madonhang, 
						@congdoan = @congdoan, 
						@trangthai = @trangthai, 
						@loaipallet = @loaipallet;

END


