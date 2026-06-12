-- PARAMS:
-- @hehang nvarchar
-- @phanloai nvarchar

CREATE PROC [dbo].[TR_THONGTIN_SANPHAM_NGUYENLIEU_GET3]
(
  @hehang nvarchar(50),
  @phanloai nvarchar(50)
)
AS
--DECLARE @phanloai nvarchar(50) = 'BAN'
--DECLARE @hehang nvarchar(50) = 'VALENCIA'

DECLARE @SANPHAM table
(
  MaSP nvarchar(200),
  TenSP nvarchar(200),
  PhanLoai nvarchar(50),
  TenLoaiSP nvarchar(100),
  NguyenLieu nvarchar(200),
  bemat_sanpham nvarchar(max)
)

IF UPPER(@phanloai) = 'GIUONG'
BEGIN
  INSERT INTO @SANPHAM(MaSP, TenSP, PhanLoai, TenLoaiSP, NguyenLieu, bemat_sanpham)
  SELECT A.masp, A.tensp, A.loaisp, B.tenloaisp, A.nguyenlieu, A.bemat_sanpham
  FROM tr_sanpham A LEFT JOIN tr_loaisp B ON A.loaisp = B.maloaisp
  WHERE hehang = @hehang AND loaisp IN ('GIUONG', 'VAIGIUONG', 'DUOIGIUONG', 'DAUGIUONG')
    AND A.active = 1
END
ELSE IF UPPER(@phanloai) = 'KHAC'
BEGIN
  INSERT INTO @SANPHAM(MaSP, TenSP, PhanLoai, TenLoaiSP, NguyenLieu, bemat_sanpham)
  SELECT A.masp, A.tensp, A.loaisp, B.tenloaisp, A.nguyenlieu, A.bemat_sanpham
  FROM tr_sanpham A LEFT JOIN tr_loaisp B ON A.loaisp = B.maloaisp
  WHERE hehang = @hehang AND loaisp IN ('KHAC', 'RUONG', 'NOI', 'KHAY', 'LANCAN')
    AND A.active = 1
END
ELSE
BEGIN
  INSERT INTO @SANPHAM(MaSP, TenSP, PhanLoai, TenLoaiSP, NguyenLieu, bemat_sanpham)
  SELECT A.masp, A.tensp, A.loaisp, B.tenloaisp, A.nguyenlieu, A.bemat_sanpham
  FROM tr_sanpham A LEFT JOIN tr_loaisp B ON A.loaisp = B.maloaisp
  WHERE hehang = @hehang AND loaisp = @phanloai
    AND A.active = 1
END

SELECT A.IDBoSanPham,
       A.ChiTiet,
       --NguyenLieu = CASE WHEN ISNULL(A.NguyenLieu, '') = '' THEN B.NguyenLieu ELSE A.NguyenLieu END,
	   B.NguyenLieu,
       A.HinhAnh,
       A.LoaiNguyenLieu,
       A.GhiChu,
       PhanLoai = CASE WHEN ISNULL(A.PhanLoai, '') = '' THEN B.PhanLoai ELSE A.PhanLoai END,
       B.TenLoaiSP,
       B.MaSP,
       B.TenSP,
       A.ID,
       A.tieuchuan,
       A.tieuchuan_veneer,
       bemat_sanpham = CASE WHEN ISNULL(A.bemat_sanpham, '') = '' THEN B.bemat_sanpham ELSE A.bemat_sanpham END
FROM (SELECT * FROM tr_thongtin_sanpham_nguyenlieu WHERE PhanLoai = @phanloai) A
  RIGHT JOIN @SANPHAM B ON A.MaSP = B.MaSP



 exec TR_THONGTIN_SANPHAM_NGUYENLIEU_GET3 'Charlotte','TU'



 select * from tr_thongtin_sanpham_vattu
