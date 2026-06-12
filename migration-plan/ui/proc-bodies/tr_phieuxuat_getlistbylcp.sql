-- PARAMS:
-- @lenhcapphat nvarchar


CREATE PROC TR_PHIEUXUAT_GETLISTBYLCP(@lenhcapphat nvarchar(50))
AS
SELECT A.sopx, A.lenhcapphat, A.nguoinhan,
	B.mact, C.mota, C.quycach, C.mausac, C.dvt,
	B.soluong, B.ghichu
FROM tr_phieuxuat A
	INNER JOIN tr_ctphieuxuat B ON A.sopx = B.phieuxuat
	INNER JOIN tr_material C ON B.mact = C.mavt
WHERE A.lenhcapphat = @lenhcapphat
	AND A.active = 1

