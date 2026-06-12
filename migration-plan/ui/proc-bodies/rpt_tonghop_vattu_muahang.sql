-- PARAMS:
-- @BEGINDATE date
-- @ENDDATE date
-- @MAVT nvarchar


CREATE PROC RPT_TONGHOP_VATTU_MUAHANG
(
    @BEGINDATE DATE,
    @ENDDATE DATE,
    @MAVT NVARCHAR(200)
)
AS

--DECLARE @BEGINDATE DATE = CAST('2020-08-01' AS DATE)
--DECLARE @ENDDATE DATE = CAST('2020-08-22' AS DATE)
SELECT B.mavt, B.mota, B.quycach, B.mausac, B.dvt
    , SUM(A.soluong) AS soluong
    , SUM(A.sl_danhan) AS sl_danhan
    , SUM(A.thanhtien) AS thanhtien
INTO #DONDATHANG
FROM tr_dondathang_chitiet A, tr_material B
WHERE A.chitiet = B.idxuong
    AND A.active = 1
    AND CAST(A.create_date AS DATE) BETWEEN @BEGINDATE AND @ENDDATE
GROUP BY B.mavt, B.mota, B.quycach, B.mausac, B.dvt

SELECT B.mact, C.mota, C.quycach, C.mausac, C.dvt 
    , SUM(B.soluong) AS soluong_xuat
INTO #XUATKHO
FROM tr_phieuxuat A, tr_ctphieuxuat B, tr_material C
WHERE A.sopx = B.phieuxuat
    AND B.mact = C.idxuong
    AND A.active = 1
    AND CAST(A.ngaytao AS DATE) BETWEEN @BEGINDATE AND @ENDDATE
GROUP BY B.mact, C.mota, C.quycach, C.mausac, C.dvt 

SELECT mavt, SUM(soluong) AS soluong 
INTO #TONKHO
FROM tr_tonkho_sum WITH(NOLOCK)
GROUP BY mavt

IF (@MAVT = '' OR @MAVT IS NULL)
BEGIN
    SELECT A.mavt, A.mota, A.quycach, A.mausac, A.dvt
	   , A.soluong AS soluong_dat
	   , A.sl_danhan AS soluong_danhan
	   , A.thanhtien
	   , ISNULL(B.soluong_xuat, 0) AS soluong_xuat
	   , ISNULL(C.soluong, 0) AS soluong_tonkho
    FROM #DONDATHANG A
	   LEFT JOIN #XUATKHO B ON A.mavt = B.mact
	   LEFT JOIN #TONKHO C ON A.mavt = C.mavt
END
ELSE
BEGIN
    SELECT A.mavt, A.mota, A.quycach, A.mausac, A.dvt
	   , A.soluong AS soluong_dat
	   , A.sl_danhan AS soluong_danhan
	   , A.thanhtien
	   , ISNULL(B.soluong_xuat, 0) AS soluong_xuat
	   , ISNULL(C.soluong, 0) AS soluong_tonkho
    FROM #DONDATHANG A
	   LEFT JOIN #XUATKHO B ON A.mavt = B.mact
	   LEFT JOIN #TONKHO C ON A.mavt = C.mavt
    WHERE A.mavt = @MAVT
END

DROP TABLE #DONDATHANG
DROP TABLE #XUATKHO
DROP TABLE #TONKHO
