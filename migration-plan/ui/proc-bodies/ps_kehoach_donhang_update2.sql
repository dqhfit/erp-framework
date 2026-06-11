-- PARAMS:
-- @madonhang nvarchar
-- @typeID nvarchar
-- @columnName nvarchar
-- @ngaykehoach date
-- @ghichu nvarchar

CREATE PROC [dbo].[PS_KEHOACH_DONHANG_UPDATE2]
(
	@madonhang nvarchar(200),
	@typeID nvarchar(200),
	@columnName nvarchar(200),
	@ngaykehoach date,
	@ghichu nvarchar(max) = NULL
)
AS
BEGIN
	IF NOT EXISTS (SELECT 1 FROM ps_kehoach_donhang WHERE madonhang = @madonhang AND typeID = @typeID AND columnName = @columnName)
	BEGIN
		INSERT INTO ps_kehoach_donhang(madonhang, typeID, columnName, ngaykehoach) VALUES (@madonhang, @typeID, @columnName, @ngaykehoach);
	END
	ELSE
	BEGIN
		UPDATE ps_kehoach_donhang
		SET ngaykehoach = @ngaykehoach
		WHERE madonhang = @madonhang
			AND typeID = @typeID
			AND columnName = @columnName
	END

	EXEC PS_KEHOACH_DONHANG_HEAD_CREATE @madonhang;
END
