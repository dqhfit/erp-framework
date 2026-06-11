-- PARAMS:
-- @id int
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

CREATE   PROCEDURE [dbo].[TR_CTPHIEUXUAT_UPDATE2]
(
	@id int,	@lenhcapphat nvarchar(50),	@phieuxuat nvarchar(50),	@makho nvarchar(50),	@mact nvarchar(MAX),	@soluong decimal(18, 3),	@ghichu nvarchar(MAX),	@ngaytao datetime,	@nguoitao nvarchar(50),	@id_pyc_chitiet uniqueidentifier,
	@id_chitiet_dathang int = null,
	@id_chitiet_lcp int = null
)
AS
UPDATE tr_ctphieuxuat
SET	lenhcapphat = @lenhcapphat,	phieuxuat = @phieuxuat,	makho = @makho,	mact = @mact,	soluong = @soluong,	ghichu = @ghichu,	id_pyc_chitiet = @id_pyc_chitiet,
	id_chitiet_dathang = @id_chitiet_dathang,
	id_chitiet_lcp = @id_chitiet_lcp
WHERE id = @id

