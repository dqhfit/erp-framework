-- PARAMS:
-- @Type nvarchar


CREATE PROC [dbo].[TR_MATERIAL_GETLISTBYTYPE]
(
    @Type NVARCHAR(10)
)
AS
BEGIN
	IF @Type = 'HTR'
	BEGIN
		SELECT * FROM tr_material WITH(NOLOCK)
		WHERE xoa = 'N'
		   AND mavt LIKE N'W%'
		   OR kho = N'HÀNG TRẮNG'
	END
	ELSE IF @Type = 'GVA'
	BEGIN
		SELECT * FROM tr_material WITH(NOLOCK)
		WHERE xoa = 'N'
		   AND kho = N'GỖ VÁN'
		   OR kho = N'VẬT TƯ KHÁC'
	END
	ELSE IF @Type = 'DGO'
	BEGIN
		SELECT * FROM tr_material WITH(NOLOCK)
		WHERE xoa = 'N'
		   AND kho = N'BAO BÌ'
		   OR kho = N'VẬT TƯ KHÁC'
	END
	ELSE IF @Type = 'NKI'
	BEGIN
		SELECT * FROM tr_material WITH(NOLOCK)
		WHERE xoa = 'N'
		   AND kho = N'NGŨ KIM'
		   OR kho = N'VẬT TƯ KHÁC'
	END
	ELSE IF @Type = 'SON'
	BEGIN
		SELECT * FROM tr_material WITH(NOLOCK)
		WHERE xoa = 'N'
		   AND kho = N'HÓA CHẤT'
		   OR kho = N'VẬT TƯ KHÁC'
	END
	ELSE IF @Type = 'OTHER'
	BEGIN
		SELECT * FROM tr_material WITH(NOLOCK)
		WHERE xoa = 'N'
	END

END
