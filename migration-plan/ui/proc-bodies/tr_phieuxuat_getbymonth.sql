-- PARAMS:
-- @USERNAME nvarchar
-- @YEAR int
-- @MONTH int


CREATE PROC [dbo].[TR_PHIEUXUAT_GETBYMONTH]
(
	@USERNAME NVARCHAR(50),
	@YEAR INT,
	@MONTH INT
)
AS
SELECT @USERNAME AS username, @YEAR as nam, @MONTH as thang
	, A.makho, B.mact, C.mota, C.mausac, C.quycach, C.dvt
	, SUM(B.soluong) AS soluong_xuat
	, SUM(CASE WHEN DAY(A.ngaytao) = 1 THEN (B.soluong) ELSE 0 END) AS D1
	, SUM(CASE WHEN DAY(A.ngaytao) = 2 THEN (B.soluong) ELSE 0 END) AS D2
	, SUM(CASE WHEN DAY(A.ngaytao) = 3 THEN (B.soluong) ELSE 0 END) AS D3
	, SUM(CASE WHEN DAY(A.ngaytao) = 4 THEN (B.soluong) ELSE 0 END) AS D4
	, SUM(CASE WHEN DAY(A.ngaytao) = 5 THEN (B.soluong) ELSE 0 END) AS D5
	, SUM(CASE WHEN DAY(A.ngaytao) = 6 THEN (B.soluong) ELSE 0 END) AS D6
	, SUM(CASE WHEN DAY(A.ngaytao) = 7 THEN (B.soluong) ELSE 0 END) AS D7
	, SUM(CASE WHEN DAY(A.ngaytao) = 8 THEN (B.soluong) ELSE 0 END) AS D8
	, SUM(CASE WHEN DAY(A.ngaytao) = 9 THEN (B.soluong) ELSE 0 END) AS D9
	, SUM(CASE WHEN DAY(A.ngaytao) = 10 THEN (B.soluong) ELSE 0 END) AS D10
	, SUM(CASE WHEN DAY(A.ngaytao) = 11 THEN (B.soluong) ELSE 0 END) AS D11
	, SUM(CASE WHEN DAY(A.ngaytao) = 12 THEN (B.soluong) ELSE 0 END) AS D12
	, SUM(CASE WHEN DAY(A.ngaytao) = 13 THEN (B.soluong) ELSE 0 END) AS D13
	, SUM(CASE WHEN DAY(A.ngaytao) = 14 THEN (B.soluong) ELSE 0 END) AS D14
	, SUM(CASE WHEN DAY(A.ngaytao) = 15 THEN (B.soluong) ELSE 0 END) AS D15
	, SUM(CASE WHEN DAY(A.ngaytao) = 16 THEN (B.soluong) ELSE 0 END) AS D16
	, SUM(CASE WHEN DAY(A.ngaytao) = 17 THEN (B.soluong) ELSE 0 END) AS D17
	, SUM(CASE WHEN DAY(A.ngaytao) = 18 THEN (B.soluong) ELSE 0 END) AS D18
	, SUM(CASE WHEN DAY(A.ngaytao) = 19 THEN (B.soluong) ELSE 0 END) AS D19
	, SUM(CASE WHEN DAY(A.ngaytao) = 20 THEN (B.soluong) ELSE 0 END) AS D20
	, SUM(CASE WHEN DAY(A.ngaytao) = 21 THEN (B.soluong) ELSE 0 END) AS D21
	, SUM(CASE WHEN DAY(A.ngaytao) = 22 THEN (B.soluong) ELSE 0 END) AS D22
	, SUM(CASE WHEN DAY(A.ngaytao) = 23 THEN (B.soluong) ELSE 0 END) AS D23
	, SUM(CASE WHEN DAY(A.ngaytao) = 24 THEN (B.soluong) ELSE 0 END) AS D24
	, SUM(CASE WHEN DAY(A.ngaytao) = 25 THEN (B.soluong) ELSE 0 END) AS D25
	, SUM(CASE WHEN DAY(A.ngaytao) = 26 THEN (B.soluong) ELSE 0 END) AS D26
	, SUM(CASE WHEN DAY(A.ngaytao) = 27 THEN (B.soluong) ELSE 0 END) AS D27
	, SUM(CASE WHEN DAY(A.ngaytao) = 28 THEN (B.soluong) ELSE 0 END) AS D28
	, SUM(CASE WHEN DAY(A.ngaytao) = 29 THEN (B.soluong) ELSE 0 END) AS D29
	, SUM(CASE WHEN DAY(A.ngaytao) = 30 THEN (B.soluong) ELSE 0 END) AS D30
	, SUM(CASE WHEN DAY(A.ngaytao) = 31 THEN (B.soluong) ELSE 0 END) AS D31
FROM tr_phieuxuat A
	INNER JOIN tr_ctphieuxuat B ON A.sopx = B.phieuxuat
	INNER JOIN tr_material C ON B.mact = C.mavt
WHERE A.active = 1
	AND YEAR(A.ngaytao) = @YEAR
	AND MONTH(A.ngaytao) = @MONTH
GROUP BY A.makho, B.mact, C.mota, C.mausac, C.quycach, C.dvt




