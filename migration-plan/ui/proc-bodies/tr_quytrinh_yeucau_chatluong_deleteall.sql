-- PARAMS:
-- @macongdoan nvarchar

CREATE PROC TR_QUYTRINH_YEUCAU_CHATLUONG_DELETEALL(@macongdoan nvarchar(50))
AS
BEGIN
	UPDATE tr_quytrinh_yeucau_chatluong
	SET active = 0
	WHERE macongdoan = @macongdoan
END

