-- PARAMS:
-- @hehang nvarchar

CREATE PROC [dbo].[TR_THONGTIN_SANPHAM_MAUSON_GET2](@hehang nvarchar(200))
AS
--DECLARE @hehang nvarchar(200) = 'Argento Bedroom'
DECLARE @IDBoSanPham uniqueidentifier

SELECT @IDBoSanPham = id FROM tr_bosanpham
WHERE bosanpham = @hehang

DECLARE @SANPHAM table
(
  MaMau nvarchar(50),
  TenMau nvarchar(200),
  HieuUng nvarchar(200),
  PhanLoai nvarchar(200)
)

INSERT INTO @SANPHAM(MaMau, TenMau, HieuUng,PhanLoai)
SELECT mausac, B.[name], NULL ,phanloai
FROM tr_sanpham A INNER JOIN tr_color B ON A.mausac = B.code 
WHERE hehang = @hehang AND a.active = 1
GROUP BY mausac, B.[name] ,b.phanloai

INSERT INTO @SANPHAM(MaMau, TenMau, HieuUng,PhanLoai)
SELECT mauuv, B.ten, NULL ,'UV'
FROM tr_sanpham A INNER JOIN TR_BANGMAU B ON A.mauuv = B.ma 
WHERE a.hehang = @hehang AND a.active = 1
GROUP BY mauuv, B.ten 

SELECT a.IDBoSanPham,
       MaMau = CASE WHEN ISNULL(A.MaMau, '') = '' THEN B.MaMau ELSE A.MaMau END,
       TenMau = CASE WHEN ISNULL(A.TenMau, '') = '' THEN B.TenMau ELSE A.TenMau END,
       a.MaNCC,
       HieuUng = CASE WHEN ISNULL(A.HieuUng, '') = '' 
	   THEN ISNULL(B.HieuUng,(SELECT hieuung FROM tr_color WHERE code = B.MaMau))
	   ELSE A.HieuUng END,

       HinhAnh =ISNULL(A.HinhAnh,(SELECT hinhanh FROM tr_color WHERE code = B.MaMau)),

       a.GhiChu,
       a.ID,
       a.DoBong,
	   PhanLoai = CASE WHEN ISNULL(A.PhanLoai, '') = '' THEN 
	   ISNULL(B.PhanLoai,(SELECT phanloai FROM tr_color WHERE code = A.MaMau)) 
	   ELSE ISNULL(A.PhanLoai,'') END
FROM (SELECT * FROM tr_thongtin_sanpham_mauson WHERE IDBoSanPham = @IDBoSanPham) a
  FULL JOIN @SANPHAM B ON A.MaMau = b.MaMau

