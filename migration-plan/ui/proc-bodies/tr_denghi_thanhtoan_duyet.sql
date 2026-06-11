-- PARAMS:
-- @id uniqueidentifier
-- @type int
-- @nguoiduyet nvarchar
-- @ngayduyet datetime


CREATE PROC [dbo].[TR_DENGHI_THANHTOAN_DUYET]
(
	@id uniqueidentifier, 
	@type int,
	@nguoiduyet nvarchar(50),
	@ngayduyet datetime
)
AS
IF @type = 0 --trưởng bộ phận
BEGIN
	UPDATE tr_denghi_thanhtoan
	SET truongbophan = @nguoiduyet,
		ngayduyet2 = @ngayduyet
	WHERE id = @id
END
ELSE IF @type = 1 --BAN GIÁM ĐỐC
BEGIN
	UPDATE tr_denghi_thanhtoan
	SET nguoiduyet = @nguoiduyet,
		ngayduyet = @ngayduyet
	WHERE id = @id
END





