-- PARAMS:
-- @OrderNumber nvarchar

CREATE PROC [dbo].[TR_ORDER_EXAMPLE_GET2](@OrderNumber NVARCHAR(200))
AS
SELECT * 
FROM tr_order_example 
WHERE order_number = @OrderNumber --AND f_cancelled = 'N'
