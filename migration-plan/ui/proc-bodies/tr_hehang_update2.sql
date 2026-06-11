-- PARAMS:
-- @id int
-- @tenhh nvarchar
-- @ghichu nvarchar
-- @khachhang nvarchar
-- @heso float

CREATE PROC [dbo].[TR_HEHANG_Update2]
(
	@id int,
	@tenhh NVARCHAR(MAX),
	@ghichu NVARCHAR(MAX),
	@khachhang nvarchar(50),
	@heso float = 1.0
)
AS
BEGIN
	DECLARE @oldValue nvarchar(50)
	SELECT @oldValue = tenhh FROM tr_hehang WHERE id = @id

	UPDATE tr_hehang
	SET ghichu = @ghichu,
	  tenhh = @tenhh,
	  khachhang = @khachhang,
	  heso = @heso
	WHERE id = @id

	UPDATE tr_sanpham
	SET hehang = @tenhh
	WHERE hehang = @oldValue

	UPDATE tr_banve
	SET hehang = @tenhh
	WHERE hehang = @oldValue

	UPDATE tr_sanpham_nhamay
	SET hehang = @tenhh
	WHERE hehang = @oldValue

	UPDATE tr_nguoiphutrach_kythuat
	SET hehang = @tenhh
	WHERE hehang = @oldValue
END
