-- PARAMS:
-- @SoPN nvarchar
-- @Active bit


CREATE PROC [dbo].[TR_PHIEUNHAP_UPDATESTATUS](@SoPN NVARCHAR(50), @Active BIT)
AS
UPDATE tr_phieunhap
SET active = @Active
WHERE sopn = @SoPN


