-- PARAMS:
-- @Type nvarchar
-- @WHS nvarchar
-- @DateFrom date
-- @DateTo date


CREATE PROC [dbo].[RPT_BAOCAO_NHAPXUAT]
(
	@Type NVARCHAR(50),
	@WHS NVARCHAR(50),
	@DateFrom DATE,
	@DateTo DATE
)
AS
IF @Type = 'OUT'
BEGIN
	SELECT b.phieuxuat,
		   b.mact,
		   b.soluong,
		   b.ghichu,
		   A.makho,
		   CAST (A.ngaytao AS date) ngaytao
	INTO #PHIEUXUAT
	  FROM tr_phieuxuat a WITH(NOLOCK), tr_ctphieuxuat b WITH(NOLOCK)
	WHERE A.sopx = B.phieuxuat AND A.active = 1
		AND CAST (A.ngaytao AS date) BETWEEN @DateFrom AND @DateTo

	SELECT A.mact, B.tenvt, B.mota
		, A.soluong, B.dvt
		, B.nhom, A.ngaytao
		, A.phieuxuat AS sophieu, A.ghichu
		, A.makho
	FROM #PHIEUXUAT A LEFT JOIN tr_material B
		ON A.mact = ISNULL(B.idxuong, B.mavt)
	WHERE A.makho = @WHS
	ORDER BY A.ngaytao, A.phieuxuat, A.mact
END
---///**************************///---
IF @Type = 'IN'
BEGIN
	SELECT A.sopn,
		   B.mavt AS mact,
		   B.slnhap as soluong,
		   B.ghichu,
		   A.makho,
		   CAST (A.ngaynhap AS date) ngaytao
	INTO #PHIEUNHAP
	  FROM tr_phieunhap A WITH(NOLOCK), tr_ctphieunhap B WITH(NOLOCK)
	WHERE A.sopn = B.sopn AND A.active = 1
		AND CAST (A.ngaynhap AS date) BETWEEN @DateFrom AND @DateTo

	SELECT A.mact, B.tenvt, B.mota
		, A.soluong, B.dvt
		, B.nhom, A.ngaytao
		, A.sopn AS sophieu, A.ghichu
		, A.makho
	FROM #PHIEUNHAP A LEFT JOIN tr_material B
		ON A.mact = ISNULL(B.idxuong, B.mavt)
	WHERE A.makho = @WHS
	ORDER BY A.ngaytao, A.sopn, A.mact
END



