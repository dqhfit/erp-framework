-- PARAMS:
-- (khong co tham so)


CREATE PROC [dbo].[TR_MATERIAL_GETALL3]
AS
SELECT 
      b.nhom
    , b.mavt
    , b.mota
    , b.quycach
    , b.mausac
    , b.dvt, b.tenncc, b.ghichu, b.kho, b.seg8
	, b.van_tieuchuan, b.van_mat1, b.van_mat2
    , ISNULL(b.soluong1kg, 0) AS soluong1kg
    , b.tenvt_en, b.id, B.duongkinhtrong, B.duongkinhngoai, B.heren
	, B.duongkinh
	, B.xacnhan
	, B.nguoixacnhan
	, B.ngayxacnhan
    , B.mavt_ncc
	, B.create_by, B.create_date
	, B.update_by, B.update_date
FROM tr_material B 
WHERE B.xoa = 'N' and  ISNULL(B.xacnhan,0) = 0



