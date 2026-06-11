-- PARAMS:
-- @MaterialCode nvarchar
-- @Price decimal
-- @LoaiTien nvarchar
-- @VendorCode nvarchar
-- @VendorName nvarchar

CREATE PROC [dbo].[UpdateMaterialPrice]
(
	@MaterialCode NVARCHAR(MAX),
	@Price DECIMAL(18, 2),
	@LoaiTien NVARCHAR(MAX),
	@VendorCode NVARCHAR(MAX),
	@VendorName NVARCHAR(MAX)
)
AS

UPDATE tr_material
SET dongia = @Price,
	mancc = @VendorCode,
	tenncc = @VendorName,
	loaitien = CASE WHEN @LoaiTien IS NULL OR @LoaiTien = '' THEN loaitien ELSE @LoaiTien END 
WHERE ISNULL(idxuong, mavt) = @MaterialCode

