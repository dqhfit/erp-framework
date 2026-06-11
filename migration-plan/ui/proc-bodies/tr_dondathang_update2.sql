-- PARAMS:
-- @maddh nvarchar
-- @tenddh nvarchar
-- @mancc nvarchar
-- @tenncc nvarchar
-- @loaidonhang nvarchar
-- @loaiddh nvarchar
-- @loaithanhtoan int
-- @ngaydat date
-- @ngaygiao date
-- @ngayyeucau date
-- @trangthai nvarchar
-- @pheduyet nvarchar
-- @donhang nvarchar
-- @lan_sua int
-- @ngayduyet datetime
-- @nguoiduyet nvarchar
-- @ngayky datetime
-- @nguoiky nvarchar
-- @IsShowSign bit
-- @create_by nvarchar
-- @create_date datetime
-- @update_by nvarchar
-- @update_date datetime
-- @active bit
-- @kehoach_sanxuat int
-- @id_maddhmaddh nvarchar
-- @ghichu nvarchar
-- @ChuKyTP nvarchar
-- @ChuKyGD nvarchar
-- @ChuKyNV nvarchar
-- @ngayky_nhanvien datetime
-- @columnName nvarchar

CREATE PROC [dbo].[TR_DONDATHANG_UPDATE2]
(
	@maddh nvarchar(200),
	@tenddh nvarchar(MAX),
	@mancc nvarchar(MAX),
	@tenncc nvarchar(MAX),
	@loaidonhang nvarchar(50),
	@loaiddh nvarchar(50),
	@loaithanhtoan int,
	@ngaydat date,
	@ngaygiao date,
	@ngayyeucau date,
	@trangthai nvarchar(2),
	@pheduyet nvarchar(2),
	@donhang nvarchar(MAX),
	@lan_sua int,
	@ngayduyet datetime,
	@nguoiduyet nvarchar(50),
	@ngayky datetime,
	@nguoiky nvarchar(50),
	@IsShowSign bit,
	@create_by nvarchar(50),
	@create_date datetime,
	@update_by nvarchar(50),
	@update_date datetime,
	@active bit,
	@kehoach_sanxuat int,
	@id_maddhmaddh nvarchar(200),
	@ghichu nvarchar(MAX),
	@ChuKyTP nvarchar(MAX),
	@ChuKyGD nvarchar(MAX),
	@ChuKyNV nvarchar(MAX),
	@ngayky_nhanvien datetime,
	@columnName nvarchar(50) = NULL
)
AS
UPDATE tr_dondathang
SET
	tenddh = @tenddh,
	mancc = @mancc,
	tenncc = @tenncc,
	loaidonhang = @loaidonhang,
	loaiddh = @loaiddh,
	loaithanhtoan = @loaithanhtoan,
	ngaydat = @ngaydat,
	ngaygiao = @ngaygiao,
	ngayyeucau = @ngayyeucau,
	trangthai = @trangthai,
	pheduyet = @pheduyet,
	donhang = @donhang,
	lan_sua = @lan_sua,
	ngayduyet = @ngayduyet,
	nguoiduyet = @nguoiduyet,
	ngayky = @ngayky,
	nguoiky = @nguoiky,
	IsShowSign = @IsShowSign,
	update_by = @update_by,
	update_date = @update_date,
	active = @active,
	kehoach_sanxuat = @kehoach_sanxuat,
	id_maddhmaddh = @id_maddhmaddh,
	ghichu = @ghichu,
	ChuKyTP = @ChuKyTP,
	ChuKyGD = @ChuKyGD,
	ChuKyNV = @ChuKyNV,
	ngayky_nhanvien = @ngayky_nhanvien,
	columnName = @columnName
WHERE maddh = @maddh
