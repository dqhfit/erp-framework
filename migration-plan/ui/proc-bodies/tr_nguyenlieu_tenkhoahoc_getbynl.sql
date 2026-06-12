-- PARAMS:
-- @id_nguyenlieu nvarchar


CREATE   PROCEDURE TR_NGUYENLIEU_TENKHOAHOC_GETBYNL
(
	@id_nguyenlieu nvarchar(50)
)
AS
BEGIN
	SELECT * FROM tr_nguyenlieu_tenkhoahoc
	WHERE id_nguyenlieu = @id_nguyenlieu
END

