-- PARAMS:
-- @masp nvarchar


CREATE   PROC TR_DINHMUC_SON3_TONGHOP (@masp nvarchar(200))
AS
BEGIN
	SELECT A.masp, A.mact, B.mota, B.dvt, B.dongia, A.soluong, thanhtien = B.dongia * A.soluong
	FROM (
		SELECT A.masp, A.mact, SUM(A.soluong * COALESCE(B.metvuong, 0)) AS soluong
		FROM tr_dinhmuc_son3 A
			INNER JOIN tr_dinhmuc_son3_metvuong B ON A.masp = B.masp AND A.matson = B.matson
		WHERE A.masp = @masp
		GROUP BY A.masp, A.mact
	) A INNER JOIN tr_material B ON A.mact = B.mavt
	WHERE A.soluong > 0
END
