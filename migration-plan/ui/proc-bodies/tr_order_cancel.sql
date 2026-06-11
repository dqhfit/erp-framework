-- PARAMS:
-- @OrderNumber nvarchar

CREATE PROC TR_ORDER_CANCEL(@OrderNumber NVARCHAR(200))
AS
UPDATE tr_order
SET choduyet = -1,
    f_cancelled = 'Y'
WHERE order_number = @OrderNumber

UPDATE tr_order_detail
SET choduyet = -1,
    f_cancelled = 'Y'
WHERE order_number = @OrderNumber
