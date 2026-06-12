-- PARAMS:
-- @mavt nvarchar
-- @hinhanh nvarchar


CREATE   PROC [dbo].[TR_MATERIAL_UPLOAD_IMAGE]
(
	@mavt nvarchar(200),
	@hinhanh nvarchar(max)
)
AS
BEGIN
	DECLARE @urlImage nvarchar(max);
	SET @urlImage = CASE 
						WHEN @hinhanh LIKE 'http%' THEN @hinhanh 
						WHEN LEN(@hinhanh) > 0 THEN 'https://dongquochung.com' + REPLACE(@hinhanh, 'wwwroot', '')
						ELSE NULL
					END;

	UPDATE tr_material
	SET hinhanh = @urlImage
	WHERE mavt = @mavt
END

