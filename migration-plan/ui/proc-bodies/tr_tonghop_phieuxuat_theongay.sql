-- PARAMS:
-- @tungay date
-- @denngay date


CREATE   PROC [dbo].[TR_TONGHOP_PHIEUXUAT_THEONGAY](@tungay date, @denngay date)
AS
BEGIN
	SELECT B.mavt, 
		soluong = -(B.slnhap + B.soluong_du), 
		A.ghichu, CAST(A.ngaynhap AS date) AS ngaynhap,
		A.RefType, C.RefTypeName
	INTO #TRAHANG
	FROM tr_phieunhap A
		INNER JOIN tr_ctphieunhap B ON A.sopn = B.sopn
		LEFT JOIN tr_reftype C ON A.RefType = C.RefType
	WHERE A.RefType = 2012 
		--AND CAST(A.ngaynhap AS date) BETWEEN @tungay AND @denngay
		AND A.active = 1 AND A.makho = 'SON';

	SELECT B.mact, B.soluong, A.ghichu, 
		CAST(A.ngaytao AS date) AS ngaytao, 
		D.RefType, D.RefTypeName
	INTO #XUATHANG
	FROM tr_phieuxuat A
		INNER JOIN tr_ctphieuxuat B ON A.sopx = B.phieuxuat
		LEFT JOIN tr_reftype C ON A.RefType = C.RefType
		LEFT JOIN tr_reftype D ON A.mucdich = D.RefType
	WHERE A.active = 1 AND A.makho = 'SON'
		--AND CAST(A.ngaytao AS date) BETWEEN @tungay AND @denngay

	SELECT LTRIM(RTRIM(COALESCE(B.tenncc, ''))) AS tenncc, 
		CAST(A.ngayxuat AS date) AS ngayxuat, 
		A.RefTypeName, A.ghichu, 
		A.mavt, B.mota, B.quycach, B.mausac, B.dvt,
		B.dongia,
		SUM(A.soluong) AS soluong,
		SUM(A.soluong * B.dongia) AS thanhtien
	FROM (
		SELECT mavt, ghichu, soluong, ngaynhap AS ngayxuat, RefType, RefTypeName
		FROM #TRAHANG
		WHERE ngaynhap BETWEEN @tungay AND @denngay
		UNION ALL
		SELECT mact, ghichu, soluong, ngaytao, RefType, RefTypeName
		FROM #XUATHANG
		WHERE ngaytao BETWEEN @tungay AND @denngay
	) A INNER JOIN tr_material B ON A.mavt = B.mavt
	GROUP BY LTRIM(RTRIM(COALESCE(B.tenncc, ''))), CAST(A.ngayxuat AS date), A.RefTypeName, A.ghichu, A.mavt, B.mota, B.quycach, B.mausac, B.dvt, B.dongia
	ORDER BY 1,2

	DROP TABLE #TRAHANG, #XUATHANG;
END

