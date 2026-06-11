-- PARAMS:
-- @bophan nvarchar
-- @nam nvarchar
-- @thang nvarchar


CREATE PROC [dbo].[PS_KEHOACH_DONHANG_TOTAL_CONT2](@bophan nvarchar(max), @nam NVARCHAR(200), @thang nvarchar(200))
AS
BEGIN
	--DECLARE @bophan nvarchar(max) = 'SON, SAL';
	SELECT A.columnName, columnCaption, mabophan, macongdoan
	INTO #GRIDCOLUMN
	FROM tr_gridview_column A
	WHERE A.mabophan IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@bophan, ','))
		AND A.tinhtong = 1
		AND A.formName = 'frmKeHoachSanXuatPO2'


	SELECT mabophan, tenbophan, tenkhac, macongdoan, columnCaption, nam, thang,
		soluong_cont = SUM(soluong_cont_KETHUC - soluong_cont_HOANTHANH),
		soluong_cont_KETHUC = SUM(soluong_cont_KETHUC),
		soluong_cont_HOANTHANH = SUM(soluong_cont_HOANTHANH)
	INTO #KEHOACH_CONT
	FROM (
		SELECT B.mabophan, BP.tenbophan, BP.tenkhac, B.macongdoan, B.columnCaption,
			nam = YEAR(A.ngaykehoach), 
			thang = MONTH(A.ngaykehoach),
			soluong_cont_KETHUC = COALESCE(A.socont_kehoach, C.cont_qty),
			0 as soluong_cont_HOANTHANH
		FROM ps_kehoach_donhang A
			INNER JOIN #GRIDCOLUMN B ON A.columnName = B.columnName
			LEFT JOIN tr_order C ON A.madonhang = C.order_number
			LEFT JOIN tr_bophan BP ON B.mabophan = BP.mabophan
		WHERE YEAR(A.ngaykehoach) IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@nam, ','))
			AND MONTH(A.ngaykehoach) IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@thang, ','))
			AND A.madonhang IS NOT NULL
			AND A.typeID = 'NGAYKETTHUC'
	) A
	GROUP BY mabophan, tenbophan, tenkhac, macongdoan, columnCaption, nam, thang

	SELECT mabophan, tenbophan, tenkhac, macongdoan, columnCaption, nam,
		T1 = SUM(CASE WHEN A.thang = 1 THEN soluong_cont END),
		T2 = SUM(CASE WHEN A.thang = 2 THEN soluong_cont END),
		T3 = SUM(CASE WHEN A.thang = 3 THEN soluong_cont END),
		T4 = SUM(CASE WHEN A.thang = 4 THEN soluong_cont END),
		T5 = SUM(CASE WHEN A.thang = 5 THEN soluong_cont END),
		T6 = SUM(CASE WHEN A.thang = 6 THEN soluong_cont END),
		T7 = SUM(CASE WHEN A.thang = 7 THEN soluong_cont END),
		T8 = SUM(CASE WHEN A.thang = 8 THEN soluong_cont END),
		T9 = SUM(CASE WHEN A.thang = 9 THEN soluong_cont END),
		T10 = SUM(CASE WHEN A.thang = 10 THEN soluong_cont END),
		T11 = SUM(CASE WHEN A.thang = 11 THEN soluong_cont END),
		T12 = SUM(CASE WHEN A.thang = 12 THEN soluong_cont END)
	FROM #KEHOACH_CONT A
	GROUP BY mabophan, tenbophan, tenkhac, macongdoan, columnCaption, nam
	/*
	SELECT B.mabophan, BP.tenbophan, BP.tenkhac, B.macongdoan, B.columnCaption,
		nam = YEAR(A.ngaykehoach), 
		--thang = MONTH(A.ngaykehoach),
		T1 = SUM(CASE WHEN MONTH(A.ngaykehoach) = 1 THEN COALESCE(A.socont_kehoach, C.cont_qty) END),
		T2 = SUM(CASE WHEN MONTH(A.ngaykehoach) = 2 THEN COALESCE(A.socont_kehoach, C.cont_qty) END),
		T3 = SUM(CASE WHEN MONTH(A.ngaykehoach) = 3 THEN COALESCE(A.socont_kehoach, C.cont_qty) END),
		T4 = SUM(CASE WHEN MONTH(A.ngaykehoach) = 4 THEN COALESCE(A.socont_kehoach, C.cont_qty) END),
		T5 = SUM(CASE WHEN MONTH(A.ngaykehoach) = 5 THEN COALESCE(A.socont_kehoach, C.cont_qty) END),
		T6 = SUM(CASE WHEN MONTH(A.ngaykehoach) = 6 THEN COALESCE(A.socont_kehoach, C.cont_qty) END),
		T7 = SUM(CASE WHEN MONTH(A.ngaykehoach) = 7 THEN COALESCE(A.socont_kehoach, C.cont_qty) END),
		T8 = SUM(CASE WHEN MONTH(A.ngaykehoach) = 8 THEN COALESCE(A.socont_kehoach, C.cont_qty) END),
		T9 = SUM(CASE WHEN MONTH(A.ngaykehoach) = 9 THEN COALESCE(A.socont_kehoach, C.cont_qty) END),
		T10 = SUM(CASE WHEN MONTH(A.ngaykehoach) = 10 THEN COALESCE(A.socont_kehoach, C.cont_qty) END),
		T11 = SUM(CASE WHEN MONTH(A.ngaykehoach) = 11 THEN COALESCE(A.socont_kehoach, C.cont_qty) END),
		T12 = SUM(CASE WHEN MONTH(A.ngaykehoach) = 12 THEN COALESCE(A.socont_kehoach, C.cont_qty) END)
		--socont_kehoach = SUM(COALESCE(A.socont_kehoach, C.cont_qty))
		--sokhoi_kehoach = SUM(A.sokhoi_kehoach), 
		--soluong_kehoach = SUM(A.soluong_kehoach)
	FROM ps_kehoach_donhang A
		INNER JOIN #GRIDCOLUMN B ON A.columnName = B.columnName
		LEFT JOIN tr_order C ON A.madonhang = C.order_number
		LEFT JOIN tr_bophan BP ON B.mabophan = BP.mabophan
	WHERE A.ngaykehoach BETWEEN @minDay AND @maxDay
		AND A.madonhang IS NOT NULL
		AND A.typeID = 'NGAYKETTHUC'
		AND COALESCE(A.trangthai, 5) IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@trangthai, ','))
	GROUP BY B.mabophan, BP.tenbophan, BP.tenkhac, B.macongdoan, B.columnCaption, YEAR(A.ngaykehoach)
	*/
	DROP TABLE #GRIDCOLUMN, #KEHOACH_CONT;
END


