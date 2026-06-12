-- PARAMS:
-- @mact nvarchar


CREATE PROC [dbo].[TR_DINHMUC_GOVAN_GETBYMACT]
(
    @mact nvarchar(50)
)
AS
SELECT TOP 1 a.*, dbo.GetNameBySTT( a.masp, LEFT(a.stt, 1) ) AS cumchitiet
FROM tr_dinhmuc_govan a
WHERE mact = @mact
