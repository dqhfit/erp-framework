-- PARAMS:
-- @id int OUTPUT
-- @lenhcapphat nvarchar
-- @phieuxuat nvarchar
-- @makho nvarchar
-- @mact nvarchar
-- @soluong decimal
-- @ghichu nvarchar
-- @ngaytao datetime
-- @nguoitao nvarchar
-- @id_pyc_chitiet uniqueidentifier
-- @id_chitiet_dathang int
-- @id_chitiet_lcp int
-- @BatchNo nvarchar
-- @id_chitiet_phieunhap int

CREATE   PROCEDURE [dbo].[TR_CTPHIEUXUAT_INSERT2]
(
	@id int OUT,	@lenhcapphat nvarchar(50),	@phieuxuat nvarchar(50),	@makho nvarchar(50),	@mact nvarchar(MAX),	@soluong decimal(18, 3),	@ghichu nvarchar(MAX),	@ngaytao datetime,	@nguoitao nvarchar(50),	@id_pyc_chitiet uniqueidentifier,
	@id_chitiet_dathang int = null,
	@id_chitiet_lcp int = null,
	@BatchNo nvarchar(50) = null,
	@id_chitiet_phieunhap int = NULL
)
AS
BEGIN
	INSERT INTO tr_ctphieuxuat
	(		lenhcapphat,		phieuxuat,		makho,		mact,		soluong,		ghichu,		ngaytao,		nguoitao,		id_pyc_chitiet,
		id_chitiet_dathang,
		id_chitiet_lcp,
		BatchNo,
		id_chitiet_phieunhap
	)
	VALUES
	(		@lenhcapphat,		@phieuxuat,		@makho,		@mact,		@soluong,		@ghichu,		@ngaytao,		@nguoitao,		@id_pyc_chitiet,
		@id_chitiet_dathang,
		@id_chitiet_lcp,
		@BatchNo,
		@id_chitiet_phieunhap
	)
	SET @id = SCOPE_IDENTITY()
END

