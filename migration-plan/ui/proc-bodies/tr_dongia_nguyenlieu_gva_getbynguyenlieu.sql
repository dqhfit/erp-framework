-- PARAMS:
-- @id_nguyenlieu nvarchar

CREATE PROC [dbo].[TR_DONGIA_NGUYENLIEU_GVA_GETBYNGUYENLIEU](@id_nguyenlieu nvarchar(200))
AS
BEGIN
	DECLARE @gianhap float;
	EXEC TR_NGUYENLIEU_GVA_GIANHAP @id_nguyenlieu, @gianhap OUTPUT;

	SELECT A.*, COALESCE(A.gianhap, @gianhap) AS gianhap1
	FROM tr_dongia_nguyenlieu_gva A
	WHERE id_nguyenlieu = @id_nguyenlieu
	ORDER BY nguyenlieu, dayy, dai_tu, dai_den
END

