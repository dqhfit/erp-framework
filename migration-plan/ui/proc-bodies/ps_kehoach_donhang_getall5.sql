-- PARAMS:
-- @formName nvarchar
-- @filter nvarchar



CREATE PROC [dbo].[PS_KEHOACH_DONHANG_GETALL5] (@formName NVARCHAR (200), @filter nvarchar(200))
AS
BEGIN

   DECLARE @COLUMNS   NVARCHAR (MAX);
   -- Lấy danh sách cột động
   SELECT @COLUMNS = STRING_AGG (QUOTENAME (columnName), ',')
   FROM tr_gridview_column
   WHERE formName = @formName;

   -- Bảng tạm: Đơn hàng
   CREATE TABLE #DONHANG
   (
      order_number    NVARCHAR (50) COLLATE SQL_Latin1_General_CP1_CI_AI,
      makhachhang     NVARCHAR (100) COLLATE SQL_Latin1_General_CP1_CI_AI,
      hehang          NVARCHAR (100) COLLATE SQL_Latin1_General_CP1_CI_AI,
      soluong         DECIMAL (18, 2),
      sokhoi          DECIMAL (18, 4),
	  m3_tc			  DECIMAL (18, 4),
	  socont          DECIMAL (18, 2)
   );

   INSERT INTO #DONHANG
      SELECT A.order_number,
             A.customer,
             A.[range],
             SUM (B.order_qty),
             SUM (B.order_qty * C.m3_tc),
			 SUM (DISTINCT C.m3_tc),
			 SUM(DISTINCT A.cont_qty)
      FROM tr_order A
           JOIN tr_order_detail B ON A.order_number = B.order_number
           JOIN tr_sanpham C ON B.item_number = C.masp
      WHERE     A.f_cancelled = 'N'
            AND B.f_cancelled = 'N'
            AND A.Finished = 0
            AND EXISTS (SELECT 1 FROM ps_kehoach_donhang D WHERE D.madonhang = A.order_number)
      GROUP BY A.order_number, A.customer, A.[range];

   -- Bảng tạm: Chênh lệch ngày
   CREATE TABLE #TINHNGAY
   (
      madonhang                NVARCHAR (50) COLLATE SQL_Latin1_General_CP1_CI_AI,
      columnName               NVARCHAR (100) COLLATE SQL_Latin1_General_CP1_CI_AI,
      chenh_lech_ngay_chuoi    NVARCHAR (MAX) COLLATE SQL_Latin1_General_CP1_CI_AI
   );

   INSERT INTO #TINHNGAY
      SELECT s.madonhang,
             t.columnName,
             STRING_AGG(B.tenkhac + ': ' + CAST(DATEDIFF (DAY, tr.ngaykehoach, s.ngaykehoach) AS VARCHAR), CHAR (13) + CHAR (10)) AS chenh_lech_ngay_chuoi
      FROM tr_gridview_column t
           JOIN ps_kehoach_donhang s ON s.columnName = t.ngaysau 
           JOIN ps_kehoach_donhang tr ON tr.columnName = t.ngaytruoc AND tr.typeID = s.typeID AND tr.madonhang = s.madonhang AND s.lansanxuat = tr.lansanxuat
           LEFT JOIN tr_common B ON s.typeID = B.ma AND B.phanloai = 9
      WHERE t.formName = @formName AND t.tinhngay = 1
      GROUP BY s.madonhang, t.columnName;

   -- Bảng tạm: Kế hoạch
   CREATE TABLE #KEHOACH
   (
      madonhang      NVARCHAR (50) COLLATE SQL_Latin1_General_CP1_CI_AI,
      makhachhang    NVARCHAR (100) COLLATE SQL_Latin1_General_CP1_CI_AI,
      hehang         NVARCHAR (100) COLLATE SQL_Latin1_General_CP1_CI_AI,
      columnName     NVARCHAR (100) COLLATE SQL_Latin1_General_CP1_CI_AI,
	  lansanxuat     INT,
      soluong        DECIMAL (18, 2),
      sokhoi         DECIMAL (18, 4),
      [value]        NVARCHAR (MAX) COLLATE SQL_Latin1_General_CP1_CI_AI,
	  sapxep int,
	  hoanthanh bit,
	  soluong_donhang int,
	  socont float,
	  trangthai nvarchar(50)
   );

   INSERT INTO #KEHOACH
      SELECT A.madonhang,
             B.makhachhang,
             B.hehang,
             A.columnName,
			 A.lansanxuat,
             MAX (COALESCE(A.soluong_kehoach, B.soluong)),
             --MAX (B.sokhoi),
			 MAX(COALESCE(A.sokhoi_kehoach, B.sokhoi)),
             STRING_AGG (A.[value], CHAR (13) + CHAR (10)) WITHIN GROUP (ORDER BY A.stt),
			 A.sapxep, A.hoanthanh, 
			 SUM(DISTINCT B.soluong),
			 MAX (COALESCE(A.socont_kehoach, B.socont)),
			 A.trangthai
      FROM (SELECT A.madonhang,
                   A.typeID,
                   B.tenkhac,
                   B.stt,
                   A.columnName,
				   A.lansanxuat, 
				   A.soluong_kehoach, 
				   A.sokhoi_kehoach, A.socont_kehoach,
				   A.sapxep, A.hoanthanh, ST.[name] AS trangthai,
                   CASE
                      WHEN C.tinhngay = 1 THEN T.chenh_lech_ngay_chuoi
                      WHEN C.isText = 1 THEN A.ghichu
                      WHEN A.ngaykehoach IS NULL THEN NULL
                      ELSE B.tenkhac + ': ' + FORMAT (A.ngaykehoach, 'dd/MM/yyyy')
                   END AS [value]
            FROM ps_kehoach_donhang A
                 LEFT JOIN tr_common B ON A.typeID = B.ma AND B.phanloai = 9
                 LEFT JOIN tr_gridview_column C ON A.columnName = C.columnName AND C.formName = @formName
                 LEFT JOIN #TINHNGAY T ON T.madonhang = A.madonhang  AND T.columnName = A.columnName
				 LEFT JOIN ps_kehoach_donhang_trangthai ST ON COALESCE(A.trangthai,1) = ST.id
			WHERE COALESCE(A.trangthai, 1) IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@filter, ','))
			--WHERE (A.hoanthanh = CASE 
			--						WHEN @filter = 0 THEN CONVERT(bit, 0)
			--						WHEN @filter = 1 THEN CONVERT(bit, 1)
			--						ELSE A.hoanthanh
			--					END) -- OR A.hienthi = 1
			) A JOIN #DONHANG B ON A.madonhang = B.order_number 
      GROUP BY A.madonhang,
               B.makhachhang,
               B.hehang,
               A.columnName, A.lansanxuat, A.sapxep, A.hoanthanh, A.trangthai;

   -- Dynamic PIVOT
   DECLARE @SQL   NVARCHAR (MAX);
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

