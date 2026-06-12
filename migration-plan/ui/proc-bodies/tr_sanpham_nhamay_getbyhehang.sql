-- PARAMS:
-- @hehang nvarchar

CREATE PROCEDURE [dbo].[TR_SANPHAM_NHAMAY_GETBYHEHANG](@hehang nvarchar(50))
AS
BEGIN
	SELECT * 
	FROM tr_sanpham_nhamay
	WHERE active = 1
	--WHERE ISNULL(hehang, '') IN (@hehang, '')
END

