-- PARAMS:
-- @id uniqueidentifier
-- @soluongdaxuly int


create PROC [dbo].[pb_chitiet_phieubuhang_UPDATESL]
(
	@id uniqueidentifier,
	@soluongdaxuly int
)
AS
UPDATE pb_chitiet_phieubuhang
SET soluongdaxuly = @soluongdaxuly
WHERE id_chitiet_phieubu = @id


