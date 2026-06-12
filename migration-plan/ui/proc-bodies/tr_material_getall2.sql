-- PARAMS:
-- (khong co tham so)


CREATE PROC [dbo].[TR_MATERIAL_GETALL2]
AS
SELECT ISNULL(A.hehang, '') AS hehang
    , ISNULL(A.masp, '') AS masp
    , ISNULL(A.tensp, '') AS tensp
    , ISNULL(A.BOM, '') AS BOM
    , b.nhom
    , b.mavt
    , b.mota
    , b.quycach
    , b.mausac
    , b.dvt, b.tenncc, b.ghichu, b.kho, b.seg8
	, b.van_tieuchuan, b.van_mat1, b.van_mat2
    , ISNULL(b.soluong1kg, 0) AS soluong1kg
    , b.tenvt_en, b.id, B.duongkinhtrong, B.duongkinhngoai, B.heren
	, B.duongkinh
	, B.dacdiem
	, B.mavt_ncc
	, ISNULL(B.xacnhan,0) as xacnhan
	, B.create_by as nguoitao
	, B.create_date as ngaytao
	, B.update_by as nguoisua
	, B.update_date as ngaysua
FROM (
    SELECT A.masp, A.mact, A.BOM, B.hehang, B.tensp 
    FROM (
	   SELECT a.mact, a.masp, 'SON' as BOM 
	   FROM tr_dinhmuc_son A 
	   WHERE LEN(A.mact) > 0 
	   GROUP BY a.mact, a.masp
	   UNION 
	   SELECT a.mavt, a.masp, 'NKI' as BOM 
	   FROM tr_dinhmuc_ngukim a 
	   WHERE LEN(A.mavt) > 0
	   GROUP BY a.mavt, a.masp
	   UNION 
	   SELECT a.madonggoi, a.masp, 'DGO' as BOM 
	   FROM tr_dinhmuc_donggoi a 
	   GROUP BY a.masp, a.madonggoi
    ) A INNER JOIN tr_sanpham B ON A.masp = B.masp
) A
    RIGHT JOIN tr_material B ON A.mact = B.mavt
WHERE B.xoa = 'N' 



