-- PARAMS:
-- @id int

CREATE   PROCEDURE [dbo].[TR_QUYTRINH_YEUCAU_CHATLUONG_DELETEBYID]
(
	@id int
)
AS
BEGIN
	UPDATE tr_quytrinh_yeucau_chatluong 
	SET active = 0
	WHERE id = @id
END

