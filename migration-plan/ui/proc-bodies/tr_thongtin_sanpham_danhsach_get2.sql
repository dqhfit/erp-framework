-- PARAMS:
-- @HEHANG nvarchar

CREATE PROC TR_THONGTIN_SANPHAM_DANHSACH_GET2(@HEHANG NVARCHAR(200))
AS
--DECLARE @HEHANG NVARCHAR(200) = 'Valencia'

--DECLARE @IDBoSanPham uniqueidentifier = '0BE37016-E6FD-42B9-8514-53C080D950FE'
--SELECT @IDBoSanPham = id
--FROM tr_bosanpham WITH(NOLOCK)
--WHERE bosanpham = @HEHANG

DECLARE @SANPHAM TABLE
(
  masp nvarchar(100),
  masp_khachhang nvarchar(100),
  tensp nvarchar(200),
  hehang nvarchar(200),
  mausac nvarchar(100),
  ketcau nvarchar(200),
  hinhanh varbinary(max)
)

INSERT INTO @SANPHAM(masp, masp_khachhang, tensp, hehang, mausac, ketcau, hinhanh)
SELECT A.masp, A.masp_khachhang, A.tensp, A.hehang, A.mausac, A.ketcau, A.thumbnail
FROM tr_sanpham A
WHERE hehang = @HEHANG AND active = 1

SELECT A.IDBoSanPham, 
  MaSP = CASE WHEN ISNULL(A.MaSP, '') = '' THEN B.masp ELSE A.MaSP END,
  MaSP_KH = B.masp_khachhang,
  TenSP = B.tensp,
  HinhAnh = B.hinhanh,
  KetCau = CASE WHEN ISNULL(A.KetCau, '') = '' THEN B.ketcau ELSE A.KetCau END,
  MauSon = CASE WHEN ISNULL(A.MauSon, '') = '' THEN B.mausac ELSE A.MauSon END,
  A.YeuCauKhac
FROM tr_thongtin_sanpham_danhsach A
  RIGHT JOIN @SANPHAM B ON A.MaSP = B.masp
