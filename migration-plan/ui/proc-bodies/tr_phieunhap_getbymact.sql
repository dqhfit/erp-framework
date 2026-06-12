-- PARAMS:
-- @YEAR int
-- @MONTH int
-- @MACT nvarchar


CREATE PROC TR_PHIEUNHAP_GETBYMACT(@YEAR INT, @MONTH INT, @MACT NVARCHAR(200))
AS
SELECT A.makho, A.maddh, A.sopn
	, B.mavt, C.mota, C.mausac, C.quycach, C.dvt
	, B.slnhap + soluong_du as soluong
	, A.tenncc
	, A.ghichu
	, B.ghichu AS ghichu2
	, A.ngaynhap
FROM tr_phieunhap A
	INNER JOIN tr_ctphieunhap B ON A.sopn = B.sopn
	INNER JOIN tr_material C ON B.mavt = C.mavt
WHERE A.active = 1
	AND YEAR(A.ngaynhap) = @YEAR
	AND MONTH(A.ngaynhap) = @MONTH
	AND B.mavt = @MACT


