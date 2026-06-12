-- PARAMS:
-- @nam nvarchar
-- @thang nvarchar
-- @bophan nvarchar
-- @trangthai nvarchar


CREATE PROC [dbo].[PS_KEHOACH_DONHANG_GETALL7]
(
	@nam nvarchar(max),
	@thang nvarchar(max),
	@bophan nvarchar(max),
	@trangthai nvarchar(max)
)
AS
BEGIN
	SELECT *
	INTO #GRIDCOLUMN
	FROM tr_gridview_column
	WHERE mabophan IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@bophan, ','))
		AND formName = 'frmKeHoachSanXuatPO2'
		AND COALESCE(isText, 0) = 0



	SELECT A.sapxep, A.lansanxuat, A.dondathang AS madonhang, A.columnName, A.typeID, A.soluong_kehoach, A.socont_kehoach, A.sokhoi_kehoach,
		ngaykehoach = CASE
						WHEN A.typeID = 'NGAYBATDAU' THEN N'B.đầu: ' + FORMAT(A.ngaykehoach, N'dd/MM/yyyy')
						WHEN A.typeID = 'NGAYKETTHUC' THEN N'K.thúc: ' + FORMAT(A.ngaykehoach, N'dd/MM/yyyy')
						WHEN A.typeID = 'NGAYHOANTHANH' THEN N'H.thành: ' + FORMAT(A.ngaykehoach, N'dd/MM/yyyy')
						ELSE NULL
					END
	INTO #KEHOACH
	FROM ps_kehoach_donhang A
	WHERE A.madonhang IS NULL AND A.dondathang IS NOT NULL
		 AND A.trangthai IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@trangthai, ','))
		 AND A.columnName IN (SELECT columnName FROM #GRIDCOLUMN)
		 AND A.typeID IN ('NGAYBATDAU', 'NGAYKETTHUC', 'NGAYHOANTHANH')
		 AND YEAR(A.ngaykehoach) IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@nam, ','))
		 AND MONTH(A.ngaykehoach) IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@thang, ','))

	SELECT A.maddh, C.customer AS makhachhang, C.hehang, SUM(B.soluong) AS order_qty, ROUND(SUM(B.soluong * C.cbm)/68, 1) AS cont_qty, SUM(B.soluong * C.m3_tc) AS m3_tc
	INTO #DONHANG
	FROM tr_dondathang A
		INNER JOIN tr_dondathang_chitiet B ON A.maddh = B.maddh
		INNER JOIN tr_sanpham C ON B.masp = C.masp
	WHERE A.maddh IN (SELECT madonhang FROM #KEHOACH)
	GROUP BY A.maddh, C.customer, C.hehang

	SELECT A.sapxep, A.lansanxuat, A.madonhang, A.makhachhang, A.hehang, A.columnName,
		soluong_donhang = SUM(DISTINCT A.soluong_donhang),
		soluong_kehoach = SUM(DISTINCT A.soluong_kehoach), 
		sokhoi_kehoach = SUM(DISTINCT A.sokhoi_kehoach), 
		socont_kehoach = SUM(DISTINCT A.socont_kehoach),
		ngaykehoach = STRING_AGG(A.ngaykehoach, '<br>') WITHIN GROUP (ORDER BY CASE 
				WHEN A.typeID = 'NGAYBATDAU' THEN 1 
				WHEN A.typeID = 'NGAYKETTHUC' THEN 2
				WHEN A.typeID = 'NGAYHOANTHANH' THEN 3
			END)
	INTO #KEHOACH2
	FROM (
		SELECT A.sapxep, A.lansanxuat, 
			A.madonhang, B.makhachhang, B.hehang, 
			A.columnName, A.typeID, 
			B.order_qty AS soluong_donhang,
			soluong_kehoach = COALESCE(A.soluong_kehoach, B.order_qty), 
			sokhoi_kehoach = COALESCE(A.sokhoi_kehoach, B.m3_tc),
			socont_kehoach = COALESCE(A.socont_kehoach, B.cont_qty), 
			A.ngaykehoach
		FROM #KEHOACH A
			LEFT JOIN #DONHANG B ON A.madonhang = B.maddh
		
	) A
	GROUP BY A.sapxep, A.lansanxuat, A.madonhang, A.makhachhang, A.hehang, A.columnName
	ORDER BY A.sapxep, A.madonhang, A.lansanxuat
			
	--SELECT A.* FROM #KEHOACH2 A
	
	DECLARE @columns nvarchar(max);
	DECLARE @sql nvarchar(max);
	SELECT @columns = COALESCE(@columns + ', ', '') + QUOTENAME(columnName) FROM #GRIDCOLUMN
	
	SET @sql = '
	SELECT * FROM (
	SELECT A.sapxep, A.lansanxuat, A.madonhang, A.makhachhang, A.hehang,
		A.soluong_donhang, A.soluong_kehoach, A.sokhoi_kehoach, A.socont_kehoach,
		A.columnName, A.ngaykehoach
	FROM #KEHOACH2 A
	) A
	PIVOT (
		MAX(ngaykehoach)
		FOR columnName IN (' + @columns + ')
	) PV
	ORDER BY PV.sapxep, PV.lansanxuat, PV.madonhang '

	EXECUTE sp_executesql @sql;
	SELECT * FROM #GRIDCOLUMN ORDER BY visibleIndex

	DROP TABLE #GRIDCOLUMN, #DONHANG, #KEHOACH, #KEHOACH2;
END

