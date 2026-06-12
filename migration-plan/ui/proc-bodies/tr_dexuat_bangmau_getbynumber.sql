-- PARAMS:
-- @sophieu nvarchar


CREATE PROC TR_DEXUAT_BANGMAU_GETBYNUMBER(@sophieu nvarchar(50))
AS
BEGIN
	SELECT A.id, A.sophieu, A.sophieu2, A.ngaydexuat, B.FullName AS nguoidexuat, A.mucdich, A.tieuchuan_go, A.tieuchuan_veneer
	FROM tr_dexuat_bangmau A LEFT JOIN SYS_USER B ON A.nguoitao = B.UserName
	WHERE A.sophieu = @sophieu
END

