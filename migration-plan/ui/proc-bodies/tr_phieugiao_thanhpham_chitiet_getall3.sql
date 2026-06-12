-- PARAMS:
-- @phieugiao_id int


CREATE   PROCEDURE [dbo].[TR_PHIEUGIAO_THANHPHAM_CHITIET_GETALL3](@phieugiao_id int)
AS
BEGIN
	SELECT A.*, B.tensp, C.fsc_id, FSC.fsc_name, B.nguyenlieu,
		soluong_danhan = IIF(A.xacnhan = 1, A.soluong, 0),
		NULL as nhomsanpham
	INTO #PHIEUGIAO_THANHPHAM
	FROM tr_phieugiao_thanhpham_chitiet A
		INNER JOIN tr_sanpham B ON A.masp = B.masp
		INNER JOIN tr_order C ON A.madonhang = C.order_number
		LEFT JOIN tr_tinhtrang_fsc FSC ON C.fsc_id = FSC.fsc_id
	WHERE A.phieugiao_id = @phieugiao_id
	
	ALTER TABLE #PHIEUGIAO_THANHPHAM ADD malo_nguyenlieu nvarchar(max);

	DECLARE @madonhang nvarchar(200);
	DECLARE CUR CURSOR LOCAL FOR
		SELECT madonhang FROM #PHIEUGIAO_THANHPHAM GROUP BY madonhang
	OPEN CUR;
	FETCH NEXT FROM CUR INTO @madonhang;
	WHILE @@FETCH_STATUS = 0
	BEGIN
		DECLARE @malo_nguyenlieu nvarchar(4000);
		SET @malo_nguyenlieu = NULL;

		EXEC DQT_THONGKE_PHOI_GETMALO @madonhang, 2, @malo_nguyenlieu OUTPUT;

		UPDATE #PHIEUGIAO_THANHPHAM
		SET malo_nguyenlieu = @malo_nguyenlieu
		WHERE madonhang = @madonhang

		FETCH NEXT FROM CUR INTO @madonhang;
	END
	CLOSE CUR;
	DEALLOCATE CUR;

	SELECT * FROM #PHIEUGIAO_THANHPHAM A
	ORDER BY A.madonhang, A.masp, A.mathung

	DROP TABLE #PHIEUGIAO_THANHPHAM;
END

