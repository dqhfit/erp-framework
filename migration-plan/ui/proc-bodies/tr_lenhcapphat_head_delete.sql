-- PARAMS:
-- @LenhCapPhatID nvarchar


CREATE PROC TR_LENHCAPPHAT_HEAD_DELETE
(
	@LenhCapPhatID nvarchar(50)
)
AS

UPDATE tr_lenhcapphat
SET active = 0
WHERE LenhCapPhatID = @LenhCapPhatID

UPDATE tr_lenhcapphat_head
SET active = 0
WHERE LenhCapPhatID = @LenhCapPhatID
