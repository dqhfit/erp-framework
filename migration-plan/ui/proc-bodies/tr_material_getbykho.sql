-- PARAMS:
-- @KHO nvarchar

CREATE PROC [dbo].[TR_MATERIAL_GETBYKHO](@KHO NVARCHAR(50))
AS
BEGIN
DECLARE @tenkho nvarchar(50)
SELECT @tenkho = [description] FROM tr_site WHERE [name] = @KHO

SELECT A.*, B.soluong 
FROM tr_material A WITH(NOLOCK)
	LEFT JOIN tr_tonkho_sum B ON A.mavt = B.mavt
WHERE ISNULL(xoa, 'N') = 'N'
	AND (kho = @tenkho OR kho = N'VẬT TƯ KHÁC') 
	AND ISNULL(xacnhan,0) <> 0
    --AND COALESCE(ngayhethan, '9999/12/31') > GETDATE()

--	IF(@KHO <> 'BT' AND @KHO <> 'CNTT')
--	BEGIN
----		SELECT * 
----		FROM tr_material WITH(NOLOCK)
----		WHERE ISNULL(xoa, 'N') = 'N'
----			AND kho = CASE 
----					 --WHEN @KHO = 'OTHER' THEN N'VẬT TƯ KHÁC'
----					 WHEN @KHO = 'HTR' THEN N'HÀNG TRẮNG'
----					 WHEN @KHO = 'SON' THEN N'HÓA CHẤT'
----					 WHEN @KHO = 'GVA' THEN N'GỖ VÁN'
----					 WHEN @KHO = 'NKI' THEN N'NGŨ KIM'
----					 WHEN @KHO = 'GWHS' THEN N'THÀNH PHẨM'
----					 WHEN @KHO = 'DGO' THEN N'BAO BÌ'
----					END
----			OR kho = N'VẬT TƯ KHÁC'
--		SELECT * 
--		FROM tr_material WITH(NOLOCK)
--		WHERE ISNULL(xoa, 'N') = 'N'
--			AND kho IN (SELECT [description] FROM tr_site WHERE [name] = @KHO)
--			OR kho = N'VẬT TƯ KHÁC'
--	END
--	ELSE IF(@KHO = N'BT')
--	BEGIN
--		select * from tr_tonkho_baotri WHERE soluong > 0 AND toncntt = 0
--	END
--	ELSE IF(@KHO = N'CNTT')
--	BEGIN
--		select * from tr_tonkho_baotri WHERE soluong > 0 AND toncntt = 1
--	END
END
