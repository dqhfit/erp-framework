-- PARAMS:
-- @IDBoSanPham uniqueidentifier


CREATE PROC TR_THONGTIN_SANPHAM_TEM_DELETEALL(@IDBoSanPham uniqueidentifier)
AS
DELETE tr_thongtin_sanpham_tem
WHERE IDBoSanPham = @IDBoSanPham


