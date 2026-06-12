-- PARAMS:
-- @hehang nvarchar

CREATE PROC [dbo].[TR_THONGTIN_SANPHAM_YEUCAUKHAC_GET2](@hehang nvarchar(50))
AS
DECLARE @IDBoSanPham uniqueidentifier

SELECT @IDBoSanPham = id FROM tr_bosanpham
WHERE bosanpham = @hehang

SELECT * 
FROM tr_thongtin_sanpham_yeucaukhac 
WHERE IDBoSanPham = @IDBoSanPham
