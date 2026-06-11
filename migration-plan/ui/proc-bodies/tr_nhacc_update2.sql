-- PARAMS:
-- @id int
-- @vendor_id nvarchar
-- @vendor_name nvarchar
-- @address nvarchar
-- @area nvarchar
-- @phone nvarchar
-- @email nvarchar
-- @website nvarchar
-- @loaincc int
-- @sotaikhoan nvarchar
-- @tentaikhoan nvarchar
-- @tennganhang nvarchar

CREATE PROC [dbo].[TR_NHACC_UPDATE2]
(
	@id int,
	@vendor_id nvarchar(50),
	@vendor_name nvarchar(MAX),
	@address nvarchar(MAX),
	@area nvarchar(50),
	@phone nvarchar(50),
	@email nvarchar(MAX),
	@website nvarchar(MAX),
	@loaincc int,
  @sotaikhoan nvarchar(50) = NULL,
  @tentaikhoan nvarchar(200) = NULL,
  @tennganhang nvarchar(200) = NULL
)
AS
UPDATE tr_nhacc
SET
	vendor_id = @vendor_id,
	vendor_name = @vendor_name,
	[address] = @address,
	area = @area,
	phone = @phone,
	email = @email,
	website = @website,
	loaincc = @loaincc,
  sotaikhoan = @sotaikhoan,
  tentaikhoan = @tentaikhoan,
  tennganhang = @tennganhang
WHERE id = @id
