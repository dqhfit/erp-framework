-- PARAMS:
-- @formName nvarchar
-- @filter nvarchar



CREATE   PROC [dbo].[PS_KEHOACH_DONHANG_GETALL4]
(
	@formName nvarchar(200),
	@filter nvarchar(200)
)
AS
BEGIN

DECLARE @COLUMNS NVARCHAR(MAX);
-- Lấy danh sách cột động
SELECT @COLUMNS = STRING_AGG(QUOTENAME(columnName), ',')
FROM tr_gridview_column
WHERE formName = @formName;

-- Bảng tạm: Đơn hàng
CREATE TABLE #DONHANG (
    order_number NVARCHAR(50) COLLATE SQL_Latin1_General_CP1_CI_AI,
    makhachhang NVARCHAR(100) COLLATE SQL_Latin1_General_CP1_CI_AI,
    hehang NVARCHAR(MAX) COLLATE SQL_Latin1_General_CP1_CI_AI,
	donhang nvarchar(max) COLLATE SQL_Latin1_General_CP1_CI_AI,
    soluong DECIMAL(18,2),
    sokhoi DECIMAL(18,4),
	m3_tc DECIMAL(18,4),
);

INSERT INTO #DONHANG
SELECT A.maddh, A.customer, 
	hehang = STRING_AGG(hehang, ', ') WITHIN GROUP (ORDER BY hehang),
	A.donhang,
	SUM(DISTINCT A.soluong), 
	SUM(DISTINCT A.sokhoi), 
	SUM(DISTINCT A.m3_tc)
FROM (
	SELECT 
		A.maddh, 
		C.customer, 
		C.hehang, 
		A.donhang, 
		SUM(B.soluong) AS soluong, 
		SUM(B.soluong * C.m3_tc) AS sokhoi,
		SUM (DISTINCT C.m3_tc) AS m3_tc
	FROM tr_dondathang A
	JOIN tr_dondathang_chitiet B ON A.maddh = B.maddh 
	JOIN tr_sanpham C ON B.masp  = C.masp 
	WHERE A.active = 1 
	  AND B.active = 1
	  AND A.trangthai NOT IN ('-1')
	  AND EXISTS (
		  SELECT 1 
		  FROM ps_kehoach_donhang D 
		  WHERE D.dondathang = A.maddh
	  )
	GROUP BY A.maddh, C.customer, A.donhang, C.hehang
) A
GROUP BY A.maddh, A.customer, A.donhang

-- Bảng tạm: Chênh lệch ngày
CREATE TABLE #TINHNGAY (
    dondathang NVARCHAR(50) COLLATE SQL_Latin1_General_CP1_CI_AI,
    columnName NVARCHAR(100) COLLATE SQL_Latin1_General_CP1_CI_AI,
    chenh_lech_ngay_chuoi NVARCHAR(MAX)
);

INSERT INTO #TINHNGAY
SELECT 
    s.dondathang, t.columnName,
    STRING_AGG(
        B.tenkhac COLLATE SQL_Latin1_General_CP1_CI_AS + ': ' + 
        CAST(DATEDIFF(DAY, tr.ngaykehoach, s.ngaykehoach) AS VARCHAR), 
        CHAR(13) + CHAR(10)
    ) AS chenh_lech_ngay_chuoi
FROM tr_gridview_column t
JOIN ps_kehoach_donhang s 
    ON s.columnName  = t.ngaysau 
JOIN ps_kehoach_donhang tr 
    ON tr.columnName  = t.ngaytruoc 
    AND tr.typeID = s.typeID 
    AND tr.dondathang = s.dondathang 
LEFT JOIN tr_common B ON s.typeID = B.ma AND B.phanloai = 9
WHERE t.formName = @formName AND t.tinhngay = 1
GROUP BY s.dondathang, t.columnName;

-- Bảng tạm: Kế hoạch
CREATE TABLE #KEHOACH (
    dondathang NVARCHAR(50) COLLATE SQL_Latin1_General_CP1_CI_AI,
    makhachhang NVARCHAR(100) COLLATE SQL_Latin1_General_CP1_CI_AI,
    hehang NVARCHAR(max) COLLATE SQL_Latin1_General_CP1_CI_AI,
	donhang nvarchar(max),
    columnName NVARCHAR(100) COLLATE SQL_Latin1_General_CP1_CI_AI,
	lansanxuat     INT,
    soluong DECIMAL(18,2),
    sokhoi DECIMAL(18,4),
    [value] NVARCHAR(MAX),
	sapxep int,
	hoanthanh bit,
	soluong_donhang int,
	socont float,
	trangthai nvarchar(50)
);

INSERT INTO #KEHOACH
SELECT 
    A.dondathang, 
    B.makhachhang, 
    B.hehang, B.donhang, 
    A.columnName, 
	A.lansanxuat,
    MAX(COALESCE(A.soluong_kehoach, B.soluong)) AS soluong, 
	MAX(COALESCE(A.sokhoi_kehoach, B.sokhoi)) AS sokhoi, --MAX(B.sokhoi),
    STRING_AGG(A.value COLLATE SQL_Latin1_General_CP1_CI_AS, CHAR(13) + CHAR(10)) WITHIN GROUP (ORDER BY A.stt),
	A.sapxep, A.hoanthanh,
	SUM(DISTINCT B.soluong),
	MAX(A.socont_kehoach),
	 A.trangthai
FROM (
    SELECT 
        A.dondathang, 
        A.typeID, 
        B.tenkhac, 
        B.stt, 
        A.columnName,
		A.lansanxuat,
		A.soluong_kehoach, A.socont_kehoach, A.sokhoi_kehoach,
		A.sapxep, A.hoanthanh, ST.[name] as trangthai,
        CASE
            WHEN C.tinhngay = 1 THEN T.chenh_lech_ngay_chuoi
            WHEN C.isText = 1 THEN A.ghichu
            WHEN A.ngaykehoach IS NULL THEN NULL
			ELSE B.tenkhac + ': ' + FORMAT(A.ngaykehoach, 'dd/MM/yyyy')
        END AS [value]
    FROM ps_kehoach_donhang A
    LEFT JOIN tr_common B ON A.typeID = B.ma AND B.phanloai = 9
    LEFT JOIN tr_gridview_column C ON A.columnName = C.columnName AND C.formName = @formName
    LEFT JOIN #TINHNGAY T ON T.dondathang  = A.dondathang AND T.columnName  = A.columnName 
	LEFT JOIN ps_kehoach_donhang_trangthai ST ON COALESCE(A.trangthai,1) = ST.id
	WHERE COALESCE(A.trangthai, 1) IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@filter, ','))
	--WHERE (A.hoanthanh = CASE 
	--						WHEN @filter = 0 THEN CONVERT(bit, 0)
	--						WHEN @filter = 1 THEN CONVERT(bit, 1)
	--						ELSE A.hoanthanh
	--					END) -- OR A.hienthi = 1
) A
JOIN #DONHANG B ON A.dondathang = B.order_number 
GROUP BY A.dondathang, B.makhachhang, B.hehang, B.donhang, A.columnName, A.lansanxuat, A.sapxep, A.hoanthanh, A.trangthai;

-- Dynamic PIVOT
DECLARE @SQL NVARCHAR(MAX);
SET @SQL = '
SELECT * FROM #KEHOACH
PIVOT (
    MAX([value])
    FOR columnName IN (' + @COLUMNS + ')
) AS pvt ORDER BY COALESCE(sapxep, 9999)';

EXEC sp_executesql @SQL;

-- Xoá bảng tạm
DROP TABLE #TINHNGAY, #KEHOACH, #DONHANG;

END

