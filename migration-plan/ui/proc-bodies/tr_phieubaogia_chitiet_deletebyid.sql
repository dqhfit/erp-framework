-- PARAMS:
-- @ID uniqueidentifier



CREATE PROC [dbo].[TR_PHIEUBAOGIA_CHITIET_DELETEBYID]
(
	@ID uniqueidentifier
)
AS
DELETE tr_phieubaogia_chitiet
WHERE ID = @ID


