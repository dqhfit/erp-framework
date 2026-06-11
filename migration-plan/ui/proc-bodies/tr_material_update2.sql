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
-- @xacnhan bit
-- @nguoixacnhan nvarchar
-- @ngayxacnhan datetime
-- @id_xuatxu nvarchar
-- @mavt_ncc nvarchar

CREATE PROC [dbo].[TR_MATERIAL_UPDATE2]
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
	@xacnhan bit = 0,
	@nguoixacnhan nvarchar(50)='',
	@ngayxacnhan datetime = null,
	@id_xuatxu nvarchar(max) = null,
	@mavt_ncc nvarchar(50)
)
AS
UPDATE tr_material
SET
	tenvt = @tenvt,
	tenvt_en = @tenvt_en,
	mota = @mota,
	quycach = @quycach,
	dayy = @dayy,
	rong = @rong,
	dai = @dai,
	cao = @cao,
	dacdiem = @dacdiem,
	mausac = @mausac,
	dvt = @dvt,
	soluong1kg = @soluong1kg,
	nguyenlieu = @nguyenlieu,
	nhom = @nhom,
	mancc = @mancc,
	tenncc = @tenncc,
	dongia = @dongia,
	dongia_goc = @dongia_goc,
	--dongia_ban = @dongia_ban,
	loaitien = @loaitien,
	hinhanh = @hinhanh,
	ghichu = @ghichu,
	kho = @kho,
	dobuc = @dobuc,
	solop = @solop,
	seq7 = @seq7,
	seg8 = @seg8,
	seg9 = @seg9,
	seq10 = @seq10,
	xuatxu = @xuatxu,
	xoa = @xoa,
	update_by = @update_by,
	update_date = @update_date,
	van_mat1 = @van_mat1,
	van_mat2 = @van_mat2,
	van_tieuchuan = @van_tieuchuan,
	duongkinhtrong = @duongkinhtrong,
	duongkinhngoai = @duongkinhngoai,
	heren = @heren,
	duongkinh = @duongkinh,
	id_xuatxu = @id_xuatxu,
	--xacnhan = @xacnhan,
	--nguoixacnhan = @nguoixacnhan,
	--ngayxacnhan = @ngayxacnhan,
	mavt_ncc = @mavt_ncc
WHERE mavt = @mavt


