-- PARAMS:
-- @congdoan nvarchar


CREATE PROC TR_KEHOACH_HANGTRANG_GETALL2(@congdoan nvarchar(50))
AS
BEGIN
	SELECT A.madonhang, A.congdoan, STRING_AGG(A.hehang, ', ') AS hehang, SUM(DISTINCT soluong_donhang) AS soluong_donhang
	FROM (
		SELECT A.madonhang, A.congdoan, B.hehang, SUM(A.soluong_donhang) AS soluong_donhang
		FROM tr_kehoach_hangtrang A
			INNER JOIN tr_sanpham B ON A.masp = B.masp
		WHERE A.congdoan = @congdoan
		GROUP BY A.madonhang, A.congdoan, B.hehang
	) A
	GROUP BY A.madonhang, A.congdoan
END

