-- PARAMS:
-- @vendor_id nvarchar
-- @vendor_name nvarchar
-- @address nvarchar
-- @area nvarchar
-- @phone nvarchar
-- @email nvarchar
-- @website nvarchar
-- @loaincc int
-- @create_by nvarchar
-- @create_date datetime
-- @sotaikhoan nvarchar
-- @tentaikhoan nvarchar
-- @tennganhang nvarchar

CREATE PROC [dbo].[TR_NHACC_INSERT2]
(
	@vendor_id nvarchar(50),
	@vendor_name nvarchar(MAX),
	@address nvarchar(MAX),
	@area nvarchar(50) = '',
	@phone nvarchar(50),
	@email nvarchar(MAX),
	@website nvarchar(MAX),
	@loaincc int,
	@create_by nvarchar(50),
	@create_date datetime,
  @sotaikhoan nvarchar(50) = NULL,
  @tentaikhoan nvarchar(200) = NULL,
  @tennganhang nvarchar(200) = NULL
)
AS
INSERT INTO tr_nhacc
(
	vendor_id,
	vendor_name,
	[address],
	area,
	phone,
	email,
	website,
	loaincc,
	create_by,
	create_date,
  sotaikhoan,
  tentaikhoan,
  tennganhang
)
VALUES
(
	@vendor_id,
	@vendor_name,
	@address,
	@area,
	@phone,
	@email,
	@website,
	@loaincc,
	@create_by,
	@create_date,
  @sotaikhoan,
  @tentaikhoan,
  @tennganhang
)
