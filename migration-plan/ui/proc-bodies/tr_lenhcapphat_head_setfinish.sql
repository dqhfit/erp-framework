-- PARAMS:
-- @LenhCapPhatID nvarchar
-- @hoanthanh bit


CREATE   PROCEDURE [dbo].[TR_LENHCAPPHAT_HEAD_SETFINISH]
(
	@LenhCapPhatID nvarchar(50),
	@hoanthanh bit
)
AS
BEGIN
	UPDATE tr_lenhcapphat_head
	SET hoanthanh = @hoanthanh
	WHERE LenhCapPhatID = @LenhCapPhatID
END

