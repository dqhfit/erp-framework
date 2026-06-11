-- PARAMS:
-- @SoPX nvarchar
-- @Active bit


CREATE PROC [dbo].[TR_PHIEUXUAT_UPDATESTATUS](@SoPX NVARCHAR(50), @Active BIT)
AS
UPDATE tr_phieuxuat
SET active = @Active
WHERE sopx = @SoPX
