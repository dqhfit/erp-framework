-- PARAMS:
-- (khong co tham so)


CREATE PROC ListOrderNumber
AS
SELECT DISTINCT order_number
FROM tr_order_detail WITH(NOLOCK)
WHERE Finished = 0
	AND f_cancelled = 'N'
	AND choduyet = 1
ORDER BY order_number

