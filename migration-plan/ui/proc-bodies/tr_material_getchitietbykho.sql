-- PARAMS:
-- @MACT nvarchar
-- @KHO nvarchar

CREATE PROC [dbo].[TR_MATERIAL_GETCHITIETBYKHO](@MACT NVARCHAR(200), @KHO NVARCHAR(50))
AS

DECLARE @tenkho nvarchar(50)
SELECT @tenkho = [description] FROM tr_site WHERE [name] = @KHO

SELECT a.*, ISNULL(b.soluong,0) as soluongton
FROM tr_material a
LEFT JOIN tr_tonkho_sum b on  a.mavt = b.mavt
WHERE ISNULL(a.xoa, 'N') = 'N'
	AND a.mavt = @MACT --AND a.kho = @tenkho
