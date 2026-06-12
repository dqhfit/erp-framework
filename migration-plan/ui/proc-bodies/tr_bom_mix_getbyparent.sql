-- PARAMS:
-- @mact_mix nvarchar
-- @metvuong decimal


CREATE PROC [dbo].[TR_BOM_MIX_GETBYPARENT](@mact_mix nvarchar(100), @metvuong DECIMAL(18, 5) = 0)
AS
SELECT A.*, (A.soluong * @metvuong) as soluong_can
FROM tr_bom_mix A
WHERE A.mact_mix = @mact_mix


