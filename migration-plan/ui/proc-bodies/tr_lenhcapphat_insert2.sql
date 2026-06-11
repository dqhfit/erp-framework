-- PARAMS:
-- @LenhCapPhatID nvarchar
-- @LoaiDonHang nvarchar
-- @LoaiCapPhat nvarchar
-- @MaDonDatHang nvarchar
-- @MaDonHang nvarchar
-- @master_code nvarchar
-- @masp nvarchar
-- @mavt nvarchar
-- @mota nvarchar
-- @quycach nvarchar
-- @mausac nvarchar
-- @soluong_donhang decimal
-- @soluong decimal
-- @soluong_daphat decimal
-- @soluong_conlai decimal
-- @dvt nvarchar
-- @nhom nvarchar
-- @nguoitao nvarchar
-- @ngaytao datetime
-- @capphat bit
-- @active bit
-- @ghichu nvarchar
-- @vuotdinhmuc bit

CREATE PROC TR_LENHCAPPHAT_INSERT2
(
	@LenhCapPhatID nvarchar(50),
	@LoaiDonHang nvarchar(50),
	@LoaiCapPhat nvarchar(50),
	@MaDonDatHang nvarchar(MAX),
	@MaDonHang nvarchar(MAX),
	@master_code nvarchar(MAX),
	@masp nvarchar(MAX),
	@mavt nvarchar(MAX),
	@mota nvarchar(MAX),
	@quycach nvarchar(MAX),
	@mausac nvarchar(MAX),
	@soluong_donhang decimal(18, 3),
	@soluong decimal(18, 3),
	@soluong_daphat decimal(18, 3),
	@soluong_conlai decimal(18, 3),
	@dvt nvarchar(50),
	@nhom nvarchar(50),
	@nguoitao nvarchar(MAX),
	@ngaytao datetime,
	@capphat bit,
	@active bit,
	@ghichu nvarchar(MAX),
	@vuotdinhmuc bit
)
AS
INSERT INTO tr_lenhcapphat
(
	LenhCapPhatID,
	LoaiDonHang,
	LoaiCapPhat,
	MaDonDatHang,
	MaDonHang,
	master_code,
	masp,
	mavt,
	mota,
	quycach,
	mausac,
	soluong_donhang,
	soluong,
	soluong_daphat,
	soluong_conlai,
	dvt,
	nhom,
	nguoitao,
	ngaytao,
	capphat,
	active,
	ghichu,
	vuotdinhmuc
)
VALUES
(
	@LenhCapPhatID,
	@LoaiDonHang,
	@LoaiCapPhat,
	@MaDonDatHang,
	@MaDonHang,
	@master_code,
	@masp,
	@mavt,
	@mota,
	@quycach,
	@mausac,
	@soluong_donhang,
	@soluong,
	@soluong_daphat,
	@soluong_conlai,
	@dvt,
	@nhom,
	@nguoitao,
	@ngaytao,
	@capphat,
	@active,
	@ghichu,
	@vuotdinhmuc
)
