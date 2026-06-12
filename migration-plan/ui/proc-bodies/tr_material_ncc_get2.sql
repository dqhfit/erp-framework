-- PARAMS:
-- @Ma_NVL nvarchar
-- @Ma_NCC nvarchar

CREATE   PROCEDURE TR_MATERIAL_NCC_GET2
(	@Ma_NVL nvarchar(200),	@Ma_NCC nvarchar(50)
)
AS
SELECT TOP 1 * FROM tr_material_ncc
WHERE Ma_NVL = @Ma_NVL AND Ma_NCC = @Ma_NCC
ORDER BY TuNgay DESC

