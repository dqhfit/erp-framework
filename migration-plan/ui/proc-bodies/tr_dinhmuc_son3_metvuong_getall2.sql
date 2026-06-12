-- PARAMS:
-- @mausac nvarchar


CREATE   PROC [dbo].[TR_DINHMUC_SON3_METVUONG_GETALL2](@mausac nvarchar(50))
AS
BEGIN
	SELECT * FROM (
		SELECT A.masp, A.tensp, A.hehang, A.mausac, A.matson, B.metvuong
		FROM (
			SELECT A.masp, A.tensp, A.hehang, A.mausac, B.ma AS matson
			FROM tr_sanpham A CROSS JOIN (SELECT ma, ten FROM tr_common WHERE phanloai = 5) B
			WHERE A.mausac = @mausac
		) A LEFT JOIN tr_dinhmuc_son3_metvuong B ON A.masp = B.masp AND A.matson = B.matson
	) AS T
	PIVOT (
		SUM(metvuong)
		FOR matson IN ([MAT_A], [MAT_B], [MAT_C], [MAT_D], [MAT_E], [MAT_F], [MAT_G], [MAT_H])
	) AS PV
	ORDER BY PV.masp
END

