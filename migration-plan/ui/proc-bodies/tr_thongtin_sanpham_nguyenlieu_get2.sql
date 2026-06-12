-- PARAMS:
-- @IDBoSanPham uniqueidentifier
-- @PhanLoai nvarchar

CREATE PROC [dbo].[TR_THONGTIN_SANPHAM_NGUYENLIEU_GET2](@IDBoSanPham uniqueidentifier, @PhanLoai nvarchar(50))
AS
SELECT * 
FROM tr_thongtin_sanpham_nguyenlieu
WHERE IDBoSanPham = @IDBoSanPham
     AND PhanLoai = @PhanLoai

