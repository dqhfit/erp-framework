-- PARAMS:
-- @id int OUTPUT
-- @sopx nvarchar
-- @loaiphieu int
-- @lenhcapphat nvarchar
-- @donhang nvarchar
-- @makho nvarchar
-- @nguoinhan nvarchar
-- @ghichu nvarchar
-- @nguoitao nvarchar
-- @ngaytao datetime
-- @active bit
-- @nguoixacnhan nvarchar
-- @ngayxacnhan datetime
-- @xacnhan bit
-- @IsXuat bit
-- @ngayxuat datetime
-- @RefType int
-- @phieuyeucau nvarchar
-- @maddh nvarchar
-- @mucdich int

CREATE PROC [dbo].[TR_PHIEUXUAT_INSERT2]
(
	@id int OUT,
	@sopx nvarchar(50),
	@loaiphieu int,
	@lenhcapphat nvarchar(MAX),
	@donhang nvarchar(200),
	@makho nvarchar(50),
	@nguoinhan nvarchar(MAX),
	@ghichu nvarchar(MAX),
	@nguoitao nvarchar(50),
	@ngaytao datetime,
	@active bit,
	@nguoixacnhan nvarchar(50) = NULL,
	@ngayxacnhan datetime = NULL,
	@xacnhan bit = NULL,
	@IsXuat bit = 1,
	@ngayxuat datetime = NULL,
	@RefType int = NULL,
	@phieuyeucau nvarchar(max) = NULL,	@maddh nvarchar(50) = NULL,
	@mucdich int = NULL
)
AS
BEGIN
	INSERT INTO tr_phieuxuat
	(
		sopx,
		loaiphieu,
		lenhcapphat,
		donhang,
		makho,
		nguoinhan,
		ghichu,
		nguoitao,
		ngaytao,
		active,
		nguoixacnhan,
		ngayxacnhan,
		xacnhan,
		IsXuat,
		ngayxuat,
		RefType,
		phieuyeucau,
		maddh,
		mucdich
	)
	VALUES
	(
		@sopx,
		@loaiphieu,
		@lenhcapphat,
		@donhang,
		@makho,
		@nguoinhan,
		@ghichu,
		@nguoitao,
		@ngaytao,
		@active,
		@nguoixacnhan,
		@ngayxacnhan,
		@xacnhan,
		@IsXuat,
		@ngayxuat,
		@RefType,
		@phieuyeucau,
		@maddh,
		@mucdich
	)
	SET @id = SCOPE_IDENTITY()
END

