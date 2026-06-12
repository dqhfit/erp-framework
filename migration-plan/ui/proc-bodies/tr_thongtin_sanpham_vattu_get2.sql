-- PARAMS:
-- @hehang nvarchar

CREATE PROC [dbo].[TR_THONGTIN_SANPHAM_VATTU_GET2](@hehang nvarchar(50))
AS

DECLARE @IDBoSanPham uniqueidentifier
SELECT @IDBoSanPham = id FROM tr_bosanpham WHERE bosanpham = @hehang

SELECT * 
FROM tr_thongtin_sanpham_vattu 
WHERE IDBoSanPham = @IDBoSanPham
