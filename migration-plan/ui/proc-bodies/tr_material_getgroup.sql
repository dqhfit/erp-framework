-- PARAMS:
-- @GROUP nvarchar

CREATE PROC [dbo].[TR_MATERIAL_GETGROUP](@GROUP NVARCHAR(200))
AS
SELECT *
FROM tr_material WITH(NOLOCK)
WHERE seg8 = @GROUP
	AND ISNULL(xoa, 'N') = 'N' --and ISNULL(xacnhan,0) <> 1
ORDER BY mavt


