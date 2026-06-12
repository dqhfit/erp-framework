-- PARAMS:
-- @masp nvarchar
-- @mact nvarchar


CREATE PROC [dbo].[TR_DINHMUC_GOVAN_GETBYMACT2]
(
	@masp nvarchar(200),
    @mact nvarchar(50)
)
AS
SELECT a.*, dbo.GetNameBySTT( @masp, LEFT(a.stt, 1) ) AS cumchitiet
FROM tr_dinhmuc_govan a with(nolock)
WHERE mact = @mact AND masp = @masp
