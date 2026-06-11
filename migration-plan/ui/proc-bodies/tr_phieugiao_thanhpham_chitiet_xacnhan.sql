-- PARAMS:
-- @id int
-- @xacnhan bit
-- @nguoixacnhan nvarchar


CREATE PROCEDURE [dbo].[TR_PHIEUGIAO_THANHPHAM_CHITIET_XACNHAN]
(
	@id int,
	@xacnhan bit,
	@nguoixacnhan nvarchar(50)
)
AS
BEGIN
	DECLARE @phieugiao_id int;
	DECLARE @madonhang nvarchar(200);
	DECLARE @masp nvarchar(200);
	DECLARE @mathung nvarchar(50);
	DECLARE @soluong int;
	DECLARE @ngayxacnhan datetime = GETDATE();

	SELECT @phieugiao_id = phieugiao_id, @madonhang = madonhang, @masp = masp, @mathung = mathung, @soluong = soluong
	FROM tr_phieugiao_thanhpham_chitiet
	WHERE id = @id

	IF @xacnhan = 1
	BEGIN
		EXEC TR_TONKHO_THANHPHAM2_CREATE @madonhang, @masp, @mathung, @soluong;

		EXEC TR_TONKHO_THANHPHAM2_GIAODICH_INSERT 'IN', @madonhang, @masp, @mathung, @soluong, @ngayxacnhan;
	END
	
	UPDATE tr_phieugiao_thanhpham_chitiet
	SET xacnhan = @xacnhan, nguoixacnhan = @nguoixacnhan, ngayxacnhan = @ngayxacnhan
	WHERE id = @id

	EXEC TR_PHIEUGIAO_THANHPHAM_AUTOFINISH @phieugiao_id;
END

