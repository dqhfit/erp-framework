-- PARAMS:
-- @DetailId uniqueidentifier

CREATE PROCEDURE [dbo].[TR_COMMERCIAL_INVOICE_DETAIL_DELETEBYID]
(
	@DetailId uniqueidentifier
)
AS
BEGIN
	UPDATE tr_commercial_invoice_detail
	SET Actived = 0
	WHERE DetailId = @DetailId
END

