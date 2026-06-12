-- PARAMS:
-- (khong co tham so)


CREATE   PROC [dbo].[TR_MATERIAL_GETALL5]
AS
BEGIN
	SELECT A.mact, A.BOM, STRING_AGG(A.hehang, '; ') AS hehang
	INTO #MATERIAL_HEHANG
	FROM (
		SELECT a.mact, B.hehang, 'SON' as BOM 
		FROM tr_dinhmuc_son A 
			INNER JOIN tr_sanpham B ON A.masp = B.masp
		WHERE LEN(A.mact) > 0 
		GROUP BY a.mact, B.hehang
		UNION 
		SELECT a.mavt, B.hehang, 'NKI' as BOM 
		FROM tr_dinhmuc_ngukim a 
			INNER JOIN tr_sanpham B ON A.masp = B.masp
		WHERE LEN(A.mavt) > 0
		GROUP BY a.mavt, B.hehang
		UNION 
		SELECT a.madonggoi, B.hehang, 'DGO' as BOM 
		FROM tr_dinhmuc_donggoi A
			INNER JOIN tr_sanpham B ON A.masp = B.masp
		GROUP BY a.madonggoi, B.hehang
	) A 
	GROUP BY A.mact, A.BOM

	SELECT A.hehang, A.BOM,
		B.nhom, B.mavt, B.mota, B.quycach, B.mausac,
		B.dvt, B.tenncc, B.ghichu, B.kho, B.seg8,
		b.van_tieuchuan, b.van_mat1, b.van_mat2,
		ISNULL(b.soluong1kg, 0) AS soluong1kg,
		b.tenvt_en, b.id, B.duongkinhtrong, B.duongkinhngoai, B.heren,
		B.duongkinh, B.dacdiem, ISNULL(B.xacnhan,0) as xacnhan,
		B.create_by as nguoitao,
		B.create_date as ngaytao,
		B.update_by as nguoisua,
		B.update_date as ngaysua,
		b.xuatxu, b.mavt_ncc
	FROM #MATERIAL_HEHANG A
		RIGHT JOIN tr_material B ON A.mact = B.mavt
	WHERE B.xoa = 'N' 

	DROP TABLE #MATERIAL_HEHANG
END

