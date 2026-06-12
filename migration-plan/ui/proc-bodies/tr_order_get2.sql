-- PARAMS:
-- @OrderNumber nvarchar

CREATE PROC [dbo].[TR_ORDER_GET2](@OrderNumber NVARCHAR(200))
AS
BEGIN
	SELECT * FROM tr_order 
	WHERE order_number = @OrderNumber --AND f_cancelled = 'N'
END
