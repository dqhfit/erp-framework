-- PARAMS:
-- @donhang nvarchar
-- @uv int

	
CREATE   PROCEDURE [dbo].[TR_DINHMUC_SON3_MAUSON_GETBYORDER2]
(
	@donhang NVARCHAR(MAX),
	@uv int = 0
)
AS
BEGIN
	-- DECLARE @donhang NVARCHAR(MAX) = 'DQH-240, DQH-241'
	SELECT A.item_number, B.mausac, SUM(A.order_qty) AS soluong_donhang
	INTO #DONHANG_SANXUAT
	FROM tr_order_detail A INNER JOIN tr_sanpham B ON A.item_number = B.masp
	WHERE A.order_number IN (SELECT LTRIM(RTRIM([value])) FROM STRING_SPLIT(@donhang, ','))
	GROUP BY A.item_number, B.mausac

	SELECT A1.mausac, A1.matson, A1.tenmatson, A1.stt_buoc, A1.buoc, A1.donhot,
		dinhluong_buoc = A1.soluong,
		thanhtien_buoc = A1.thanhtien,

		dinhluong_matson = SUM(A1.soluong) OVER (PARTITION BY A1.mausac, A1.matson),
		thanhtien_matson = SUM(A1.thanhtien) OVER (PARTITION BY A1.mausac, A1.matson)
	FROM (
		SELECT A.mausac, A.matson, D.ten AS tenmatson, A.stt_buoc, A.buoc, A.donhot, 
			SUM(A.soluong) AS soluong, 
			SUM(A.soluong * A.dongia) AS thanhtien
		FROM (
			SELECT C.mausac, A.matson, A.stt_buoc, A.buoc, A.donhot, A.mact, A.soluong, D.dongia
			FROM tr_dinhmuc_son3 A
			INNER JOIN tr_dinhmuc_son3_metvuong B ON A.masp = B.masp AND A.matson = B.matson
			INNER JOIN #DONHANG_SANXUAT C ON A.masp = C.item_number
			INNER JOIN tr_material D ON A.mact = D.mavt
			WHERE A.makhuvuc = 'SON' AND A.soluong * B.metvuong > 0
				AND CASE WHEN COALESCE(A.tinhtrang_uv, '') = '' THEN 0 ELSE 1 END = @uv
			GROUP BY C.mausac, A.matson, A.stt_buoc, A.buoc, A.donhot, A.mact, A.soluong, D.dongia
		) A LEFT JOIN tr_common D ON A.matson = D.ma AND D.phanloai = 5
		GROUP BY A.mausac, A.matson, D.ten, A.stt_buoc, A.buoc, A.donhot
	) A1
	ORDER BY A1.mausac, A1.matson, A1.stt_buoc
	DROP TABLE #DONHANG_SANXUAT;
END

