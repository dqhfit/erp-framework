-- PARAMS:
-- @customer nvarchar

CREATE PROCEDURE TR_ORDER_GETALLBYCUSTOMER(@customer nvarchar(50))
AS
SELECT * FROM tr_order
WHERE f_cancelled = 'N'
  AND choduyet = 1
  AND Finished = 0
  AND IsExample = 0 AND IsPhoi = 0 AND IsUV = 0
  AND customer = @customer
