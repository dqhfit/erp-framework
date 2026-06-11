-- PARAMS:
-- @id_dathang nvarchar
-- @sopn nvarchar
-- @mavt nvarchar
-- @slnhap decimal
-- @soluong_du decimal
-- @ghichu nvarchar
-- @ngaynhap datetime
-- @nguoinhap nvarchar
-- @idchitiet nvarchar
-- @gianhap money
-- @tigia money
-- @BatchNo nvarchar
-- @FscId int
-- @NhomNguyenLieu int
-- @MaLoNguyenLieu2 nvarchar
-- @loaitien nvarchar


CREATE   PROCEDURE [dbo].[TR_CTPHIEUNHAP_INSERT3]
(	@id_dathang nvarchar(MAX),	@sopn nvarchar(50),	@mavt nvarchar(MAX),	@slnhap decimal(18, 3),	@soluong_du decimal(18, 3),	@ghichu nvarchar(MAX),	@ngaynhap datetime,	@nguoinhap nvarchar(50),	@idchitiet nvarchar(50),	@gianhap money,	@tigia money,

	@BatchNo NVARCHAR(20) = null,
	@FscId int = NULL,
	@NhomNguyenLieu int = NULL,
	@MaLoNguyenLieu2 nvarchar(50) = NULL,
	@loaitien nvarchar(50) = NULL
)
AS
BEGIN
	IF @slnhap + @soluong_du > 0
	BEGIN
		INSERT INTO tr_ctphieunhap
		(			id_dathang,			sopn,			mavt,			slnhap,			soluong_du,			ghichu,			ngaynhap,			nguoinhap,			idchitiet,			gianhap,			tigia,
			BatchNo,
			FscId, NhomNguyenLieu, MaLoNguyenLieu2, loaitien
		)
		VALUES
		(			@id_dathang,			@sopn,			@mavt,			@slnhap,			@soluong_du,			@ghichu,			@ngaynhap,			@nguoinhap,			@idchitiet,			@gianhap,			@tigia,
			@BatchNo,
			@FscId, @NhomNguyenLieu, @MaLoNguyenLieu2, @loaitien
		)
	END
END

