-- PARAMS:
-- @USERNAME nvarchar
-- @YEAR int
-- @MONTH int


CREATE PROC [dbo].[TR_PHIEUNHAP_GETBYMONTH](@USERNAME nvarchar(50), @YEAR INT, @MONTH INT)
AS
SELECT @USERNAME AS username, @YEAR as nam, @MONTH as thang
	, A.makho, B.mavt, C.mota, C.mausac, C.quycach, C.dvt
	, SUM(B.slnhap + B.soluong_du) AS soluong_nhap
	, SUM(CASE WHEN DAY(A.ngaynhap) = 1 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D1
	, SUM(CASE WHEN DAY(A.ngaynhap) = 2 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D2
	, SUM(CASE WHEN DAY(A.ngaynhap) = 3 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D3
	, SUM(CASE WHEN DAY(A.ngaynhap) = 4 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D4
	, SUM(CASE WHEN DAY(A.ngaynhap) = 5 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D5
	, SUM(CASE WHEN DAY(A.ngaynhap) = 6 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D6
	, SUM(CASE WHEN DAY(A.ngaynhap) = 7 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D7
	, SUM(CASE WHEN DAY(A.ngaynhap) = 8 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D8
	, SUM(CASE WHEN DAY(A.ngaynhap) = 9 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D9
	, SUM(CASE WHEN DAY(A.ngaynhap) = 10 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D10
	, SUM(CASE WHEN DAY(A.ngaynhap) = 11 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D11
	, SUM(CASE WHEN DAY(A.ngaynhap) = 12 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D12
	, SUM(CASE WHEN DAY(A.ngaynhap) = 13 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D13
	, SUM(CASE WHEN DAY(A.ngaynhap) = 14 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D14
	, SUM(CASE WHEN DAY(A.ngaynhap) = 15 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D15
	, SUM(CASE WHEN DAY(A.ngaynhap) = 16 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D16
	, SUM(CASE WHEN DAY(A.ngaynhap) = 17 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D17
	, SUM(CASE WHEN DAY(A.ngaynhap) = 18 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D18
	, SUM(CASE WHEN DAY(A.ngaynhap) = 19 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D19
	, SUM(CASE WHEN DAY(A.ngaynhap) = 20 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D20
	, SUM(CASE WHEN DAY(A.ngaynhap) = 21 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D21
	, SUM(CASE WHEN DAY(A.ngaynhap) = 22 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D22
	, SUM(CASE WHEN DAY(A.ngaynhap) = 23 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D23
	, SUM(CASE WHEN DAY(A.ngaynhap) = 24 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D24
	, SUM(CASE WHEN DAY(A.ngaynhap) = 25 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D25
	, SUM(CASE WHEN DAY(A.ngaynhap) = 26 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D26
	, SUM(CASE WHEN DAY(A.ngaynhap) = 27 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D27
	, SUM(CASE WHEN DAY(A.ngaynhap) = 28 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D28
	, SUM(CASE WHEN DAY(A.ngaynhap) = 29 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D29
	, SUM(CASE WHEN DAY(A.ngaynhap) = 30 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D30
	, SUM(CASE WHEN DAY(A.ngaynhap) = 31 THEN (B.slnhap + B.soluong_du) ELSE 0 END) AS D31
FROM tr_phieunhap A
	INNER JOIN tr_ctphieunhap B ON A.sopn = B.sopn
	INNER JOIN tr_material C ON B.mavt = C.mavt
WHERE A.active = 1
	AND YEAR(A.ngaynhap) = @YEAR
	AND MONTH(A.ngaynhap) = @MONTH
GROUP BY A.makho, B.mavt, C.mota, C.mausac, C.quycach, C.dvt

