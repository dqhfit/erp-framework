-- PARAMS:
-- @MAKHO nvarchar

CREATE PROC [dbo].[TR_LISTMATERIAL_ONHAND]
( 
	@MAKHO nvarchar(50)
)
AS
BEGIN

    DECLARE @STR nvarchar(200);

--    SELECT 
--		 @STR = CASE
--				WHEN @MAKHO = 'DGO' THEN N'BAO BÌ'
--				WHEN @MAKHO = 'NKI' THEN N'NGŨ KIM'
--				WHEN @MAKHO = 'SON' THEN N'HÓA CHẨT'
--				WHEN @MAKHO = 'GVA' THEN N'GỖ VÁN'
--				WHEN @MAKHO = 'HTR' THEN N'HÀNG TRẮNG'
--			   END

    SELECT @STR = UPPER([description]) FROM tr_site WHERE [name] = @MAKHO

    SELECT A.mavt, A.mota
	   , A.quycach, A.mausac, A.dvt
	   , ISNULL(B.soluong, 0) soluong
	   , A.kho, B.makho 
    FROM tr_material A WITH(NOLOCK)
	   LEFT JOIN tr_tonkho_sum B WITH(NOLOCK)
	   ON A.idxuong = B.mavt
    WHERE A.xoa = 'N'
	   AND ISNULL(A.kho, ISNULL(B.makho, '')) IN (@STR, @MAKHO, '', N'VẬT TƯ KHÁC')
	   --OR ISNULL(B.makho, '') IN (@MAKHO, '')
    ORDER BY A.idxuong

END
