-- PARAMS:
-- @idxuong nvarchar
-- @mavt nvarchar
-- @tenvt nvarchar
-- @tenvt_en nvarchar
-- @mota nvarchar
-- @quycach nvarchar
-- @dayy nvarchar
-- @rong nvarchar
-- @dai nvarchar
-- @cao nvarchar
-- @dacdiem nvarchar
-- @mausac nvarchar
-- @dvt nvarchar
-- @soluong1kg float
-- @nguyenlieu nvarchar
-- @nhom nvarchar
-- @mancc nvarchar
-- @tenncc nvarchar
-- @dongia decimal
-- @dongia_goc decimal
-- @dongia_ban decimal
-- @loaitien nvarchar
-- @hinhanh nvarchar
-- @ghichu nvarchar
-- @kho nvarchar
-- @dobuc nvarchar
-- @solop nvarchar
-- @seq7 nvarchar
-- @seg8 nvarchar
-- @seg9 nvarchar
-- @seq10 nvarchar
-- @xuatxu nvarchar
-- @xoa nvarchar
-- @create_by nvarchar
-- @create_date datetime
-- @update_by nvarchar
-- @update_date datetime
-- @van_tieuchuan nvarchar
-- @van_mat1 nvarchar
-- @van_mat2 nvarchar
-- @duongkinhtrong decimal
-- @duongkinhngoai decimal
-- @heren nvarchar
-- @duongkinh nvarchar
-- @mavt_ncc nvarchar

CREATE PROC [dbo].[TR_MATERIAL_INSERT2]
(
	@idxuong nvarchar(200),
	@mavt nvarchar(200),
	@tenvt nvarchar(MAX),
	@tenvt_en nvarchar(MAX),
	@mota nvarchar(MAX),
	@quycach nvarchar(MAX),
	@dayy nvarchar(50),
	@rong nvarchar(50),
	@dai nvarchar(50),
	@cao nvarchar(50),
	@dacdiem nvarchar(MAX),
	@mausac nvarchar(MAX),
	@dvt nvarchar(MAX),
	@soluong1kg float,
	@nguyenlieu nvarchar(MAX),
	@nhom nvarchar(MAX),
	@mancc nvarchar(MAX),
	@tenncc nvarchar(MAX),
	@dongia decimal(18, 3),
	@dongia_goc decimal(18, 3),
	@dongia_ban decimal(18, 3),
	@loaitien nvarchar(50),
	@hinhanh nvarchar(MAX),
	@ghichu nvarchar(MAX),
	@kho nvarchar(50),
	@dobuc nvarchar(50),
	@solop nvarchar(50),
	@seq7 nvarchar(100),
	@seg8 nvarchar(50),
	@seg9 nvarchar(50),
	@seq10 nvarchar(50),
	@xuatxu nvarchar(200),
	@xoa nvarchar(2),
	@create_by nvarchar(50),
	@create_date datetime,
	@update_by nvarchar(50),
	@update_date datetime,
	@van_tieuchuan nvarchar(200)='',
	@van_mat1 nvarchar(200)='',
	@van_mat2 nvarchar(200)='',
	@duongkinhtrong decimal(18, 2) = 0,
	@duongkinhngoai decimal(18, 2) = 0,
	@heren nvarchar(50)='',
	@duongkinh nvarchar(50) = '',
	@mavt_ncc nvarchar(50) = null
)
AS
BEGIN
	DECLARE @xacnhan bit = 1
	IF(@kho = N'BAO BÌ' or @kho = N'HÓA CHẤT' or @kho = N'NGŨ KIM')
	BEGIN
		SET @xacnhan = 0
	END

	INSERT INTO tr_material
	(
		idxuong,
		mavt,
		tenvt,
		tenvt_en,
		mota,
		quycach,
		dayy,
		rong,
		dai,
		cao,
		dacdiem,
		mausac,
		dvt,
		soluong1kg,
		nguyenlieu,
		nhom,
		mancc,
		tenncc,
		dongia,
		dongia_goc,
		--dongia_ban,
		loaitien,
		hinhanh,
		ghichu,
		kho,
		dobuc,
		solop,
		seq7,
		seg8,
		seg9,
		seq10,
		xuatxu,
		xoa,
		create_by,
		create_date,
		update_by,
		update_date,
		van_tieuchuan,
		van_mat1,
		van_mat2,
		duongkinhtrong,
		duongkinhngoai,
		heren,
		duongkinh,
		xacnhan,
		mavt_ncc
	)
	VALUES
	(
		@idxuong,
		@mavt,
		@tenvt,
		@tenvt_en,
		@mota,
		@quycach,
		@dayy,
		@rong,
		@dai,
		@cao,
		@dacdiem,
		@mausac,
		@dvt,
		@soluong1kg,
		@nguyenlieu,
		@nhom,
		@mancc,
		@tenncc,
		@dongia,
		@dongia_goc,
		--@dongia_ban,
		@loaitien,
		@hinhanh,
		@ghichu,
		@kho,
		@dobuc,
		@solop,
		@seq7,
		@seg8,
		@seg9,
		@seq10,
		@xuatxu,
		@xoa,
		@create_by,
		@create_date,
		@update_by,
		@update_date,
		@van_tieuchuan,
		@van_mat1,
		@van_mat2,
		@duongkinhtrong,
		@duongkinhngoai,
		@heren,
		@duongkinh,
		@xacnhan,
		@mavt_ncc
	)

	INSERT INTO tr_material_baogia (mact, ngaytao, nguoitao, ngaysua, nguoisua)
	VALUES (@mavt, @create_date, @create_by, @update_date, @update_by);
END

