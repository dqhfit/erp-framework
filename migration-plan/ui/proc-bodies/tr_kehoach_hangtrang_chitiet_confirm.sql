-- PARAMS:
-- @id_chitiet uniqueidentifier
-- @xacnhan bit


CREATE   PROC TR_KEHOACH_HANGTRANG_CHITIET_CONFIRM
(
	@id_chitiet uniqueidentifier,
	@xacnhan bit
)
AS
BEGIN
	UPDATE tr_kehoach_hangtrang_chitiet
	SET xacnhan = @xacnhan
	WHERE id_chitiet = @id_chitiet
END

