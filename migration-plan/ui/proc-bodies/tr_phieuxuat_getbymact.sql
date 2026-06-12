-- PARAMS:
-- @YEAR int
-- @MONTH int
-- @MACT nvarchar


CREATE PROC TR_PHIEUXUAT_GETBYMACT(@YEAR INT, @MONTH INT, @MACT NVARCHAR(200))
AS
SELECT A.makho, A.lenhcapphat, A.sopx
	, B.mact, C.mota, C.mausac, C.quycach, C.dvt
	, B.soluong
	, A.nguoinhan
	, A.ghichu
	, B.ghichu AS ghichu2
	, A.ngaytao
FROM tr_phieuxuat A
	INNER JOIN tr_ctphieuxuat B ON A.sopx = B.phieuxuat
	INNER JOIN tr_material C ON B.mact = C.mavt
WHERE A.active = 1
	AND YEAR(A.ngaytao) = @YEAR
	AND MONTH(A.ngaytao) = @MONTH
	AND B.mact = @MACT


