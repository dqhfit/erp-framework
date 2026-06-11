-- PARAMS:
-- @id int OUTPUT
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

CREATE   PROCEDURE [dbo].[TR_KHACHHANG_INSERT3]
(
	@id int out,
	@customer_id nvarchar(100),
	@customer_name nvarchar(MAX),
	@address nvarchar(MAX),
	@area nvarchar(50),
	@phone nvarchar(50),
	@fax nvarchar(50),
	@email nvarchar(50),
	@website nvarchar(MAX),
	@director nvarchar(50),
	@merchandiser nvarchar(50),
	@merchandiser_phone nvarchar(50),
	@merchandiser_mail nvarchar(50),
	@ngaylamviec date,
	@create_by nvarchar(50),
	@create_date datetime,
	@bank_id uniqueidentifier,
	@taxcode nvarchar(50),
	@active bit,
	@customer_type nvarchar(200) = null,
	@customer_type_name nvarchar(200) = null
)
AS
BEGIN
	IF NOT EXISTS (SELECT 1 FROM tr_khachhang WHERE customer_id = @customer_id)
	BEGIN
		INSERT INTO tr_khachhang
		(
			customer_id,
			customer_name,
			[address],
			area,
			phone,
			fax,
			email,
			website,
			director,
			merchandiser,
			merchandiser_phone,
			merchandiser_mail,
			ngaylamviec,
			create_by,
			create_date,
			bank_id,
			taxcode,
			active,
			customer_type,
			customer_type_name
		)
		VALUES
		(
			@customer_id,
			@customer_name,
			@address,
			@area,
			@phone,
			@fax,
			@email,
			@website,
			@director,
			@merchandiser,
			@merchandiser_phone,
			@merchandiser_mail,
			@ngaylamviec,
			@create_by,
			@create_date,
			@bank_id,
			@taxcode,
			@active,
			@customer_type,
			@customer_type_name
		)
		SET @id = SCOPE_IDENTITY();
	END
	ELSE
	BEGIN
		SELECT @id = id FROM tr_khachhang WHERE customer_id = @customer_id;
	END
END
