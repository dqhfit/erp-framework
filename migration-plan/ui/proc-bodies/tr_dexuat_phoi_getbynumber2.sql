-- PARAMS:
-- @sophieu nvarchar

CREATE PROC TR_DEXUAT_PHOI_GETBYNUMBER2(@sophieu nvarchar(50))
AS
BEGIN
	SELECT A.id, A.sophieu, B.tendexuat, C.FullName AS nguoidexuat, A.ngaydexuat, A.donhang, A.mucdich
	FROM tr_dexuat_phoi A
	LEFT JOIN tr_loai_dexuat B ON A.loaidexuat = B.madexuat
	LEFT JOIN SYS_USER C ON A.nguoidexuat = C.UserName
	WHERE A.sophieu = @sophieu
END

