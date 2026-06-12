-- PARAMS:
-- @LenhCapPhatID nvarchar


CREATE PROC [dbo].[TR_LENHCAPPHAT_HEAD_GET2]
(
	@LenhCapPhatID nvarchar(50)
)
AS
BEGIN
	SELECT * FROM tr_lenhcapphat_head
	WHERE LenhCapPhatID = @LenhCapPhatID
END
