-- PARAMS:
-- @nguyenlieu nvarchar



CREATE   PROCEDURE [dbo].[TR_BAOGIA3_GIAPHOI_GETALL2](@nguyenlieu nvarchar(max))
AS
SELECT * FROM tr_baogia3_giaphoi
WHERE nguyenlieu = @nguyenlieu


