-- PARAMS:
-- @MACT nvarchar
-- @SOLUONG_NHAP decimal

CREATE PROC [dbo].[TR_TONKHO_SUM_NHAP](@MACT NVARCHAR(200), @SOLUONG_NHAP DECIMAL(18, 3))
AS
IF EXISTS (SELECT mavt FROM tr_material WHERE mavt = @MACT AND ISNULL(xoa,'N') = 'N')
BEGIN
    --LẤY RA VẬT TƯ THUỘC KHO NÀO
    DECLARE @MAKHO NVARCHAR(50)
    DECLARE @TENKHO NVARCHAR(50)
    SELECT @TENKHO = kho FROM tr_material WHERE mavt = @MACT
    
    SELECT @MAKHO = [name] FROM tr_site WHERE [description] = @TENKHO
    IF @MAKHO IS NULL
      SET @MAKHO = 'OTHER'
--    SELECT @MAKHO = CASE 
--				    WHEN kho = N'VẬT TƯ KHÁC' THEN 'OTHER'
--				    WHEN kho = N'HÀNG TRẮNG' THEN 'HTR'
--				    WHEN kho = N'HÓA CHẤT' THEN 'SON'
--				    WHEN kho = N'GỖ VÁN' THEN 'GVA'
--				    WHEN kho = N'NGŨ KIM' THEN 'NKI'
--				    WHEN kho = N'THÀNH PHẨM' THEN 'GWHS'
--				    WHEN kho = N'BAO BÌ' THEN 'DGO'
--			    END
--    FROM tr_material WITH(NOLOCK)
--    WHERE mavt = @MACT
    
    

    --LẤY SỐ LƯỢNG TỒN KHO HIỆN TẠI
    DECLARE @ID INT
    DECLARE @SOLUONG_TON DECIMAL(18, 3)
    SELECT @ID = id, @SOLUONG_TON = ISNULL(soluong,0)
    FROM tr_tonkho_sum WITH(NOLOCK)
    WHERE mavt = @MACT AND makho = @MAKHO

    IF @SOLUONG_TON IS NULL
	   SET @SOLUONG_TON = 0

    IF @ID IS NOT NULL --NẾU VẬT TƯ ĐÃ CÓ TỒN KHO
    BEGIN
	   UPDATE tr_tonkho_sum
	   SET soluong = @SOLUONG_TON + @SOLUONG_NHAP
	   WHERE id = @ID
    END
    ELSE --NẾU VẬT TƯ CHƯA CÓ TỒN KHO
    BEGIN
	   INSERT INTO tr_tonkho_sum(mavt, makho, soluong, soluong_toithieu)
	   VALUES (@MACT, @MAKHO, @SOLUONG_NHAP, 0)
    END

END
