-- PARAMS:
-- @customer_id nvarchar
-- @customer_name nvarchar
-- @address nvarchar
-- @area nvarchar
-- @phone nvarchar
-- @fax nvarchar
-- @email nvarchar
-- @website nvarchar
-- @director nvarchar
-- @merchandiser nvarchar
-- @merchandiser_phone nvarchar
-- @merchandiser_mail nvarchar
-- @ngaylamviec date
-- @create_by nvarchar
-- @create_date datetime
-- @bank_id uniqueidentifier
-- @taxcode nvarchar
-- @active bit
-- @customer_type nvarchar
-- @customer_type_name nvarchar

CREATE   PROCEDURE [dbo].[TR_KHACHHANG_UPDATE3]
(	@customer_id nvarchar(100),	@customer_name nvarchar(MAX),	@address nvarchar(MAX),	@area nvarchar(50),	@phone nvarchar(50),	@fax nvarchar(50),	@email nvarchar(50),	@website nvarchar(MAX),	@director nvarchar(50),	@merchandiser nvarchar(50),	@merchandiser_phone nvarchar(50),	@merchandiser_mail nvarchar(50),	@ngaylamviec date,	@create_by nvarchar(50),	@create_date datetime,	@bank_id uniqueidentifier,	@taxcode nvarchar(50),	@active bit,
	@customer_type nvarchar(200) = null,
	@customer_type_name nvarchar(200) = null
)
AS
UPDATE tr_khachhang
SET	customer_name = @customer_name,	[address] = @address,	area = @area,	phone = @phone,	fax = @fax,	email = @email,	website = @website,	director = @director,	merchandiser = @merchandiser,	merchandiser_phone = @merchandiser_phone,	merchandiser_mail = @merchandiser_mail,	ngaylamviec = @ngaylamviec,	bank_id = @bank_id,	taxcode = @taxcode,	active = @active,	customer_type = @customer_type,	customer_type_name = @customer_type_nameWHERE customer_id = @customer_id
