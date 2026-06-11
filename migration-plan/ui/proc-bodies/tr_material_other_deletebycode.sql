-- PARAMS:
-- @mact nvarchar

--------------------------------------------------
CREATE PROCEDURE [dbo].[TR_MATERIAL_OTHER_DELETEBYCODE](@mact nvarchar(50))
AS
--DELETE tr_material WHERE mavt = @mact

UPDATE tr_material
SET xoa = 'N'
 WHERE mavt = @mact

DELETE tr_material_other
WHERE mact = @mact

DELETE tr_tonkho_sum
WHERE mavt = @mact

DELETE tr_tonkho_chitiet
WHERE mavt = @mact
