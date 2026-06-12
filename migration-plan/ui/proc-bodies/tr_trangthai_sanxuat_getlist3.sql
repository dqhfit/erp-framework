-- PARAMS:
-- @madonhang nvarchar
-- @masp nvarchar


CREATE PROC [dbo].[TR_TRANGTHAI_SANXUAT_GETLIST3] (@madonhang   NVARCHAR (100),
                                           @masp        NVARCHAR (50))
AS

DECLARE @MASP1 NVARCHAR(200)
SET @MASP1 = dbo.ufn_MaHTR_To_MaSP(@MASP)

SELECT a.madonhang,
       C.mact,
       ISNULL(a.tenct, C.chitiet) AS tenct,
       a.masp,
       ISNULL(a.masp1, C.masp) AS masp1,
       a.ViTriMay,
       a.TenViTri,
	   a.NguoiLam,
       ISNULL(a.dayy, C.dayy_tc) dayy,
       ISNULL(a.rong, C.rong_tc) rong,
       ISNULL(a.dai, C.dai_tc) dai,
       B.VITRIHIENTAI,
       MIN (A.NGAYBATDAU) NGAYBATDAU,
       MAX (A.NGAYHOANTHANH) NGAYHOANTHANH,
       SUM (SOLUONG_BATDAU) SOLUONG_BATDAU,
       SUM (SOKHOI_BATDAU) SOKHOI_BATDAU,
       SUM (SOLUONG_HOANTHANH) SOLUONG_HOANTHANH,
       SUM (SOKHOI_HOANTHANH) SOKHOI_HOANTHANH
FROM (SELECT a.madonhang,
             a.mact,
             a.tenct,
             a.masp,
             a.masp1,
             a.ViTriMay,
             a.TenViTri,
             a.thoidiem,
             B.Name AS tenthoidien,
			 a.NguoiLam,
             a.dayy,
             a.rong,
             a.dai,
             a.soluong AS SOLUONG_BATDAU,
             a.sokhoi AS SOKHOI_BATDAU,
             0  AS SOLUONG_HOANTHANH,
             0  AS SOKHOI_HOANTHANH,
             MIN (A.ngaytao) NGAYBATDAU,
             MAX (A.ngaytao) NGAYHOANTHANH
      FROM DQHF.dbo.tr_trangthai_sanxuat a
           INNER JOIN tr_trangthai_sanxuat_thoidiem B ON A.thoidiem = B.Id
      WHERE thoidiem = 'BDA' AND madonhang = @madonhang AND masp = @masp
      GROUP BY a.madonhang,
               a.mact,
               a.tenct,
               a.masp,
               a.masp1,
               a.ViTriMay,
               a.TenViTri,
               a.thoidiem,
               B.Name,
			   a.NguoiLam,
               a.dayy,
               a.rong,
               a.dai,
               A.sokhoi,
               A.soluong
      UNION ALL
      SELECT a.madonhang,
             a.mact,
             a.tenct,
             a.masp,
             a.masp1,
             a.ViTriMay,
             a.TenViTri,
             a.thoidiem,
             B.Name AS tenthoidien,
			 a.NguoiLam,
             a.dayy,
             a.rong,
             a.dai,
             0,
             0,
             a.soluong,
             a.sokhoi,
             MIN (A.ngaytao) NGAYBATDAU,
             MAX (A.ngaytao) NGAYHOANTHANH
      FROM DQHF.dbo.tr_trangthai_sanxuat a
           INNER JOIN tr_trangthai_sanxuat_thoidiem B ON A.thoidiem = B.Id
      WHERE thoidiem = 'HTH' AND madonhang = @madonhang AND masp = @masp
      GROUP BY a.madonhang,
               a.mact,
               a.tenct,
               a.masp,
               a.masp1,
               a.ViTriMay,
               a.TenViTri,
               a.thoidiem,
               B.Name,
			   a.NguoiLam,
               a.dayy,
               a.rong,
               a.dai,
               a.soluong,
               a.sokhoi) A
     INNER JOIN (SELECT mact, tenct, MAX (ngaytao) AS VITRIHIENTAI
                 FROM tr_trangthai_sanxuat
                 WHERE thoidiem IS NOT NULL --ISNULL(TenViTri, '') <> ''
                 GROUP BY mact, tenct) B ON A.mact = B.mact
	RIGHT JOIN (SELECT * FROM tr_dinhmuc_govan WHERE masp = @MASP1) C ON A.mact = C.mact AND A.masp1 = C.masp
GROUP BY a.madonhang,
       C.mact,
       ISNULL(a.tenct, C.chitiet),
       a.masp,
       ISNULL(a.masp1, C.masp) ,
       a.ViTriMay,
       a.TenViTri,
	   a.NguoiLam,
       ISNULL(a.dayy, C.dayy_tc) ,
       ISNULL(a.rong, C.rong_tc) ,
       ISNULL(a.dai, C.dai_tc) ,
       B.VITRIHIENTAI
--ORDER BY C.mact


