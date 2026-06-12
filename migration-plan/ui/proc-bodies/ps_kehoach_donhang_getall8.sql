-- PARAMS:
-- @nam int
-- @thang int
-- @bophan nvarchar


CREATE PROC [dbo].[PS_KEHOACH_DONHANG_GETALL8]
(
	@nam INT,
	@thang INT,
	@bophan nvarchar(max)
	--@trangthai nvarchar(max)
)
AS
BEGIN
	--DECLARE @nam INT = 2026;
	--DECLARE @thang INT = 1;
	--DECLARE @bophan nvarchar(max) = 'SON, DGO, SON1, SON2';
	--DECLARE @trangthai nvarchar(max)
	SELECT *
	INTO #GRIDCOLUMN
	FROM tr_gridview_column
	WHERE mabophan IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@bophan, ','))
		AND formName = 'frmKeHoachSanXuatPO2'
		AND COALESCE(isText, 0) = 0

	DECLARE @prev_year int;
	DECLARE @prev_month int;

	IF @thang = 1
	BEGIN
		SET @prev_year = @nam - 1;
		SET @prev_month = 12;
	END
	ELSE
	BEGIN
		SET @prev_year = @nam;
		SET @prev_month = @thang - 1
	END

	SELECT * 
	INTO #KEHOACH
	FROM (
		SELECT A.sapxep, A.lansanxuat, A.madonhang, A.columnName, A.typeID, A.soluong_kehoach, A.socont_kehoach, A.sokhoi_kehoach,
			ngaykehoach = CASE
							WHEN A.typeID = 'NGAYBATDAU' THEN N'B.đầu: ' + FORMAT(A.ngaykehoach, N'dd/MM/yyyy')
							WHEN A.typeID = 'NGAYKETTHUC' THEN N'K.thúc: ' + FORMAT(A.ngaykehoach, N'dd/MM/yyyy')
							WHEN A.typeID = 'NGAYHOANTHANH' THEN N'H.thành: ' + FORMAT(A.ngaykehoach, N'dd/MM/yyyy')
							ELSE NULL
						END
		--INTO #KEHOACH
		FROM ps_kehoach_donhang A
		WHERE A.dondathang IS NULL
			 --AND A.trangthai IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@trangthai, ','))
			 AND A.columnName IN (SELECT columnName FROM #GRIDCOLUMN)
			 AND A.typeID IN ('NGAYBATDAU', 'NGAYKETTHUC', 'NGAYHOANTHANH')
			 AND YEAR(A.ngaykehoach) = @nam
			 AND MONTH(A.ngaykehoach) = @thang
		UNION ALL
		SELECT A.sapxep, A.lansanxuat, A.madonhang, A.columnName, A.typeID, A.soluong_kehoach, A.socont_kehoach, A.sokhoi_kehoach,
			ngaykehoach = CASE
							WHEN A.typeID = 'NGAYBATDAU' THEN N'B.đầu: ' + FORMAT(A.ngaykehoach, N'dd/MM/yyyy')
							WHEN A.typeID = 'NGAYKETTHUC' THEN N'K.thúc: ' + FORMAT(A.ngaykehoach, N'dd/MM/yyyy')
							WHEN A.typeID = 'NGAYHOANTHANH' THEN N'H.thành: ' + FORMAT(A.ngaykehoach, N'dd/MM/yyyy')
							ELSE NULL
						END
		--INTO #KEHOACH
		FROM ps_kehoach_donhang A
		WHERE A.dondathang IS NULL
			 AND A.trangthai IN ('5', '6')
			 AND A.columnName IN (SELECT columnName FROM #GRIDCOLUMN)
			 AND A.typeID IN ('NGAYBATDAU', 'NGAYKETTHUC')
			 AND YEAR(A.ngaykehoach) IN (@nam, @prev_year)
			 AND MONTH(A.ngaykehoach) <= @prev_month
	) A

	SELECT A.order_number, A.customer AS makhachhang, A.[range] AS hehang, SUM(B.order_qty) AS order_qty, ROUND(SUM(B.order_qty * C.cbm)/68, 1) AS cont_qty, SUM(B.order_qty * C.m3_tc) AS m3_tc
	INTO #DONHANG
	FROM tr_order A
		INNER JOIN tr_order_detail B ON A.order_number = B.order_number
		INNER JOIN tr_sanpham C ON B.item_number = C.masp
	WHERE A.order_number IN (SELECT madonhang FROM #KEHOACH)
	GROUP BY A.order_number, A.customer, A.[range]

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
			LEFT JOIN #DONHANG B ON A.madonhang = B.order_number
		
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

