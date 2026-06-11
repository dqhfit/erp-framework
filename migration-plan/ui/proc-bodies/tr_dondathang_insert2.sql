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
-- @mahoso nvarchar
-- @macongty nvarchar

CREATE PROC [dbo].[TR_DONDATHANG_INSERT2] 
(
	@maddh NVARCHAR (200),
	@tenddh NVARCHAR (MAX),
	@mancc NVARCHAR (MAX),
	@tenncc NVARCHAR (MAX),
	@loaidonhang NVARCHAR (50),
	@loaiddh NVARCHAR (50),
	@loaithanhtoan INT,
	@ngaydat DATE,
	@ngaygiao DATE,
	@ngayyeucau DATE,
	@trangthai NVARCHAR (2),
	@pheduyet NVARCHAR (2),
	@donhang NVARCHAR (MAX),
	@lan_sua INT,
	@ngayduyet DATETIME,
	@nguoiduyet NVARCHAR (50),
	@ngayky DATETIME,
	@nguoiky NVARCHAR (50),
	@IsShowSign BIT,
	@create_by NVARCHAR (50),
	@create_date DATETIME,
	@update_by NVARCHAR (50),
	@update_date DATETIME,
	@active BIT,
	@kehoach_sanxuat INT,
	@id_maddhmaddh NVARCHAR (200),
	@ghichu NVARCHAR (MAX),
	@ChuKyTP NVARCHAR (MAX),
	@ChuKyGD NVARCHAR (MAX),
	@ChuKyNV NVARCHAR (MAX),
	@ngayky_nhanvien DATETIME,
	@mahoso nvarchar(50) = NULL,
	@macongty nvarchar(50) = NULL
)
AS
BEGIN
--IF @create_by = 'yenlinh'
--   BEGIN
--      SET @trangthai = '0'
--      SET @pheduyet = '1'
--   END
--
--SET @trangthai = '0'
--SET @pheduyet = '1'

INSERT INTO tr_dondathang 
(
	maddh,
	tenddh,
	mancc,
	tenncc,
	loaidonhang,
	loaiddh,
	loaithanhtoan,
	ngaydat,
	ngaygiao,
	ngayyeucau,
	trangthai,
	pheduyet,
	donhang,
	lan_sua,
	ngayduyet,
	nguoiduyet,
	ngayky,
	nguoiky,
	IsShowSign,
	create_by,
	create_date,
	update_by,
	update_date,
	active,
	kehoach_sanxuat,
	id_maddhmaddh,
	ghichu,
	ChuKyTP,
	ChuKyGD,
	ChuKyNV,
	ngayky_nhanvien,
	mahoso, macongty
) VALUES (
	@maddh,
	@tenddh,
	@mancc,
	@tenncc,
	@loaidonhang,
	@loaiddh,
	@loaithanhtoan,
	@ngaydat,
	@ngaygiao,
	@ngayyeucau,
	@trangthai,
	@pheduyet,
	@donhang,
	@lan_sua,
	@ngayduyet,
	@nguoiduyet,
	@ngayky,
	@nguoiky,
	@IsShowSign,
	@create_by,
	@create_date,
	@update_by,
	@update_date,
	@active,
	@kehoach_sanxuat,
	@id_maddhmaddh,
	@ghichu,
	@ChuKyTP,
	@ChuKyGD,
	@ChuKyNV,
	@ngayky_nhanvien,
	@mahoso, @macongty
)
END
